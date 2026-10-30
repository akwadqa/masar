"""Features roadmap and Releases (ADR-034 … ADR-040).

Features and Releases belong to exactly one Space. Their definitions and lifecycle are managed by
Space Managers; Members associate Tasks through the ordinary task-edit capability. Every write runs
inside `masar_service()` after explicit authorization.
"""

import re

import frappe
from frappe import _
from frappe.query_builder import Order
from frappe.query_builder.functions import Count, Sum
from frappe.utils import cint, getdate, now_datetime

from masar.exceptions import MasarConflictError, MasarRequestReuseError
from masar.masar.doctype.masar_feature.masar_feature import ROADMAP
from masar.masar.doctype.masar_release.masar_release import STATUSES
from masar.permissions import (
	MANAGER,
	can_write_tasks,
	get_space_role,
	get_space_status,
	get_user_spaces,
	not_found,
	require_masar_user,
	require_planning_manager,
	require_space_access,
)
from masar.services.activity import record_activity
from masar.services.serializers import iso_date, iso_datetime, user_refs
from masar.utils.context import concurrent_duplicate, masar_service

SORT_STEP = 1024.0
RELEASE_TRANSITIONS = {
	"Planned": ("Released", "Archived"),
	"Released": ("Planned", "Archived"),
	"Archived": ("Planned", "Released"),
}


# --------------------------------------------------------------------------- shared helpers


def _progress(field: str, names: list[str]) -> dict[str, dict]:
	"""{name: {total, completed}} for Features or Releases in one grouped query."""
	if not names:
		return {}
	task = frappe.qb.DocType("Masar Task")
	rows = (
		frappe.qb.from_(task)
		.select(task[field], Count(task.name), Sum(task.is_completed))
		.where(task[field].isin(names))
		.groupby(task[field])
		.run()
	)
	return {name: {"total": cint(total), "completed": cint(done)} for name, total, done in rows}


def _progress_payload(counts: dict | None) -> dict:
	total = (counts or {}).get("total", 0)
	completed = (counts or {}).get("completed", 0)
	return {
		"total": total,
		"completed": completed,
		"open": total - completed,
		# None (not 0) when there are no tasks: the UI shows an empty state, not "0 %" (ADR-035).
		"percent": round(completed * 100 / total) if total else None,
	}


def _planning_permissions(space: str) -> dict:
	role = get_space_role(space)
	can_manage = role == MANAGER and can_write_tasks(get_space_status(space), role)
	return {"canManage": can_manage, "canLinkTasks": can_write_tasks(get_space_status(space), role)}


def _load(doctype: str, name: str, *, manage: bool):
	"""Readable record of the caller's Spaces (404 otherwise); `manage` also requires a Manager
	in a writable Space and locks the row."""
	require_masar_user()
	space = frappe.db.get_value(doctype, name, "space") if name else None
	if not space or get_space_role(space) is None:
		not_found(doctype.replace("Masar ", ""))
	if manage:
		require_planning_manager(space)
	return frappe.get_doc(doctype, name, for_update=manage)


def _check_base(doc, base: dict | None, fields: dict, changes: dict, normalise) -> None:
	"""Field-scoped optimistic concurrency, as for Tasks (ADR-018)."""
	conflicts = []
	for api_field in changes:
		if base and api_field in base:
			current = normalise(api_field, doc.get(fields[api_field]))
			if current != normalise(api_field, base[api_field]):
				conflicts.append({"field": api_field, "current": current, "yours": changes[api_field]})
	if conflicts:
		frappe.local.response["conflicts"] = conflicts
		frappe.throw(
			_("This record was changed by someone else. Review the latest values."), MasarConflictError
		)


def _linked_tasks(field: str, name: str) -> list[str]:
	return frappe.get_all(
		"Masar Task", filters={field: name}, pluck="name", order_by="name asc"
	)  # after auth


def _detach(field: str, name: str) -> int:
	"""Clear the link on every Task of the record (history is written per Task)."""
	tasks = _linked_tasks(field, name)
	for task_name in tasks:
		task = frappe.get_doc("Masar Task", task_name, for_update=True)
		task.set(field, None)
		task.save()
	return len(tasks)


# --------------------------------------------------------------------------- Features

FEATURE_FIELDS = {"title": "title", "description": "description"}


def _feature_row(doc, counts: dict | None) -> dict:
	return {
		"name": doc.name,
		"space": doc.space,
		"title": doc.title,
		"roadmap": doc.roadmap,
		"sortOrder": float(doc.sort_order or 0),
		"progress": _progress_payload(counts),
		"modified": iso_datetime(doc.modified),
	}


FEATURE_PEOPLE_LIMIT = 4


def _feature_people(names: list[str]) -> dict[str, list[dict]]:
	"""{feature: [user refs]}: up to four people assigned to the Feature's open Tasks (roadmap cards).
	Features belong to one Space and the caller already has access to it, so nothing hidden is exposed."""
	if not names:
		return {}
	task = frappe.qb.DocType("Masar Task")
	assignee = frappe.qb.DocType("Masar Task Assignee")
	rows = (
		frappe.qb.from_(assignee)
		.join(task)
		.on(task.name == assignee.parent)
		.select(task.feature, assignee.user, Count(assignee.name))
		.where((task.feature.isin(names)) & (task.is_completed == 0) & (assignee.parenttype == "Masar Task"))
		.groupby(task.feature, assignee.user)
		.run()
	)
	ranked: dict[str, list[tuple[int, str]]] = {}
	for feature, user, count in rows:
		ranked.setdefault(feature, []).append((-cint(count), user))
	refs = user_refs([user for _feature, user, _count in rows])
	return {
		feature: [refs[user] for _count, user in sorted(people)[:FEATURE_PEOPLE_LIMIT] if user in refs]
		for feature, people in ranked.items()
	}


def _feature_detail(doc) -> dict:
	row = _feature_row(doc, _progress("feature", [doc.name]).get(doc.name))
	refs = user_refs([doc.owner])
	row.update(
		{
			"description": doc.description,
			"createdBy": refs.get(doc.owner),
			"creation": iso_datetime(doc.creation),
			"spaceTitle": frappe.db.get_value("Masar Space", doc.space, "title"),
			"permissions": _planning_permissions(doc.space),
		}
	)
	return row


def list_features(space: str) -> dict:
	"""All Features of a Space in roadmap order (Now, Next, Later, Done; then display order)."""
	require_space_access(space)
	feature = frappe.qb.DocType("Masar Feature")
	rows = (
		frappe.qb.from_(feature)
		.select(
			feature.name, feature.space, feature.title, feature.roadmap, feature.sort_order, feature.modified
		)
		.where(feature.space == space)
		.orderby(feature.sort_order, order=Order.asc)
		.orderby(feature.name)
		.run(as_dict=True)
	)
	counts = _progress("feature", [r.name for r in rows])
	people = _feature_people([r.name for r in rows])
	rows.sort(key=lambda r: ROADMAP.index(r.roadmap))  # stable: keeps display order within a column
	return {
		"items": [{**_feature_row(r, counts.get(r.name)), "people": people.get(r.name, [])} for r in rows],
		"permissions": _planning_permissions(space),
	}


def _member_spaces(spaces_filter: list[str] | None) -> list[str]:
	"""The caller's Spaces, or the requested subset of them (404 for any other Space)."""
	require_masar_user()
	allowed = list(get_user_spaces())
	if spaces_filter:
		if any(name not in allowed for name in spaces_filter):
			not_found("Space")
		allowed = list(dict.fromkeys(spaces_filter))
	return allowed


def list_my_features(spaces_filter: list[str] | None = None) -> dict:
	"""Features of every Space the caller belongs to (or the given ones), for the Features box of
	All Tasks: roadmap order, Done last; each item names its Space."""
	allowed = _member_spaces(spaces_filter)
	if not allowed:
		return {"items": []}
	feature = frappe.qb.DocType("Masar Feature")
	space = frappe.qb.DocType("Masar Space")
	rows = (
		frappe.qb.from_(feature)
		.join(space)
		.on(space.name == feature.space)
		.select(
			feature.name,
			feature.space,
			space.title.as_("space_title"),
			feature.title,
			feature.roadmap,
			feature.sort_order,
			feature.modified,
		)
		.where(feature.space.isin(allowed))
		.orderby(feature.sort_order, order=Order.asc)
		.orderby(feature.name)
		.run(as_dict=True)
	)
	counts = _progress("feature", [r.name for r in rows])
	rows.sort(key=lambda r: ROADMAP.index(r.roadmap))
	return {
		"items": [{**_feature_row(r, counts.get(r.name)), "spaceTitle": r.space_title} for r in rows]
	}


def get_feature(feature: str) -> dict:
	return _feature_detail(_load("Masar Feature", feature, manage=False))


def _bottom_sort_order(space: str, roadmap: str) -> float:
	feature = frappe.qb.DocType("Masar Feature")
	current = (
		frappe.qb.from_(feature)
		.select(feature.sort_order)
		.where((feature.space == space) & (feature.roadmap == roadmap))
		.orderby(feature.sort_order, order=Order.desc)
		.limit(1)
		.run()
	)
	return (float(current[0][0] or 0) if current else 0.0) + SORT_STEP


REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")


def _created_feature(key: str, space: str, title: str):
	"""The Feature an earlier attempt of this request created (ADR-042). The same key with another
	Space or title is a different request and is rejected rather than answered with that Feature."""
	existing = frappe.db.get_value(
		"Masar Feature",
		{"owner": frappe.session.user, "client_request_id": key},
		["name", "space", "title"],
		as_dict=True,
	)
	if existing and (existing.space != space or existing.title != " ".join((title or "").split())):
		frappe.throw(_("This request id was already used for a different Feature."), MasarRequestReuseError)
	return existing.name if existing else None


def create_feature(
	space: str,
	title: str,
	roadmap: str = "Later",
	description: str | None = None,
	client_request_id: str | None = None,
) -> dict:
	"""Create a Feature. With `client_request_id`, repeating the request (e.g. after a lost response)
	returns the same Feature (`created: False`) instead of a duplicate."""
	require_planning_manager(space)
	if roadmap not in ROADMAP:
		frappe.throw(_("Roadmap must be one of Now, Next, Later or Done."))
	if client_request_id and not REQUEST_ID.match(client_request_id):
		frappe.throw(_("A valid client request id is required."))
	if client_request_id:
		existing = _created_feature(client_request_id, space, title)
		if existing:
			return {**_feature_detail(frappe.get_doc("Masar Feature", existing)), "created": False}
	doc = frappe.get_doc(
		{
			"doctype": "Masar Feature",
			"space": space,
			"title": title,
			"roadmap": roadmap,
			"description": description or None,
			"sort_order": _bottom_sort_order(space, roadmap),
			"client_request_id": client_request_id or None,
		}
	)
	frappe.db.savepoint("masar_feature_create")
	try:
		with masar_service():
			doc.insert()
			record_activity(doc, "feature_created", {"title": doc.title, "roadmap": doc.roadmap})
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		# A concurrent request with the same key won the race: answer with its Feature.
		frappe.db.rollback(save_point="masar_feature_create")
		existing = client_request_id and _created_feature(client_request_id, space, title)
		if not existing:
			concurrent_duplicate()
		return {**_feature_detail(frappe.get_doc("Masar Feature", existing)), "created": False}
	return {**_feature_detail(doc), "created": True}


def _normalise_feature(field: str, value):
	if field == "title":
		return " ".join((value or "").split()) or None
	return value or None


def update_feature(feature: str, changes: dict, base: dict | None = None) -> dict:
	if not isinstance(changes, dict) or not changes:
		frappe.throw(_("Nothing to update."))
	unknown = set(changes) - set(FEATURE_FIELDS)
	if unknown:
		frappe.throw(_("These fields cannot be edited here: {0}").format(", ".join(sorted(unknown))))
	doc = _load("Masar Feature", feature, manage=True)
	_check_base(doc, base, FEATURE_FIELDS, changes, _normalise_feature)
	for api_field, value in changes.items():
		doc.set(FEATURE_FIELDS[api_field], _normalise_feature(api_field, value))
	with masar_service():
		doc.save()
		record_activity(doc, "feature_updated", {"fields": sorted(changes)})
	return _feature_detail(doc)


def _neighbour_order(name: str | None, space: str, roadmap: str) -> float | None:
	if not name:
		return None
	row = frappe.db.get_value("Masar Feature", name, ["space", "roadmap", "sort_order"], as_dict=True)
	if not row or row.space != space or row.roadmap != roadmap:
		frappe.throw(
			_("The roadmap changed while you were moving this Feature. Refresh and try again."),
			MasarConflictError,
		)
	return float(row.sort_order or 0)


def move_feature(
	feature: str,
	roadmap: str,
	before: str | None = None,
	after: str | None = None,
	expected_roadmap: str | None = None,
) -> dict:
	"""Move a Feature to a roadmap column and position (ADR-038).

	`before`/`after` are the neighbours the client dropped it between (the Feature placed directly
	above / below). `expected_roadmap` is the column the client saw it in: a different stored value
	means someone else moved it first (409). Moving to Done with open tasks is allowed; the response
	reports `openTasks` so the UI can say so (ADR-035).
	"""
	if roadmap not in ROADMAP:
		frappe.throw(_("Roadmap must be one of Now, Next, Later or Done."))
	doc = _load("Masar Feature", feature, manage=True)
	if expected_roadmap and expected_roadmap != doc.roadmap:
		frappe.local.response["conflicts"] = [{"field": "roadmap", "current": doc.roadmap, "yours": roadmap}]
		frappe.throw(_("Someone else moved this Feature. Review the latest roadmap."), MasarConflictError)
	if feature in (before, after):
		frappe.throw(_("A Feature cannot be placed next to itself."))
	# Serialise concurrent moves into the same column, so positions are computed from current rows.
	frappe.db.sql(
		"select name from `tabMasar Feature` where space = %s and roadmap = %s for update",
		(doc.space, roadmap),
	)
	upper = _neighbour_order(before, doc.space, roadmap)
	lower = _neighbour_order(after, doc.space, roadmap)
	if upper is not None and lower is not None:
		if upper >= lower:
			frappe.throw(
				_("The roadmap changed while you were moving this Feature. Refresh and try again."),
				MasarConflictError,
			)
		order = (upper + lower) / 2
		if order in (upper, lower):  # precision exhausted: renumber the column
			order = _renumber_column(doc.space, roadmap, feature, insert_after=before)
	elif upper is not None:
		order = upper + SORT_STEP
	elif lower is not None:
		order = lower - SORT_STEP
	else:
		order = doc.sort_order if roadmap == doc.roadmap else _bottom_sort_order(doc.space, roadmap)
	if frappe.db.exists(
		"Masar Feature",
		{"space": doc.space, "roadmap": roadmap, "sort_order": order, "name": ["!=", feature]},
	):
		# Another move took the same slot: renumber instead of keeping duplicate positions.
		order = _renumber_column(doc.space, roadmap, feature, insert_after=before)
	previous = doc.roadmap
	doc.roadmap = roadmap
	doc.sort_order = order
	with masar_service():
		doc.save()
		if previous != roadmap:
			record_activity(doc, "roadmap_changed", {"from": previous, "to": roadmap})
	result = _feature_detail(doc)
	result["openTasks"] = result["progress"]["open"]
	return result


def _renumber_column(space: str, roadmap: str, moving: str, insert_after: str | None) -> float:
	"""Spread a column's sort orders evenly (without the Feature being moved) and return a free slot
	directly below `insert_after`, or at the top when there is none."""
	names = frappe.get_all(  # Manager already authorised for this Space
		"Masar Feature",
		filters={"space": space, "roadmap": roadmap, "name": ["!=", moving]},
		order_by="sort_order asc, name asc",
		pluck="name",
	)
	slot = SORT_STEP if insert_after is None else None
	position = SORT_STEP if insert_after is None else 0.0
	for name in names:
		position += SORT_STEP
		frappe.db.set_value("Masar Feature", name, "sort_order", position, update_modified=False)
		if name == insert_after:
			position += SORT_STEP
			slot = position
	return slot if slot is not None else position + SORT_STEP


def delete_feature(feature: str, detach: bool = False) -> dict:
	"""Deleting never cascades to Tasks (ADR-039). With linked Tasks the request is refused unless
	the Manager explicitly chose to detach them, which clears the link in the same transaction."""
	doc = _load("Masar Feature", feature, manage=True)
	linked = len(_linked_tasks("feature", doc.name))
	if linked and not detach:
		frappe.local.response["conflicts"] = [{"field": "tasks", "current": linked}]
		frappe.throw(
			_("This Feature has {0} task(s). Remove them from the Feature before deleting it.").format(
				linked
			),
			MasarConflictError,
		)
	space = frappe.get_doc("Masar Space", doc.space)
	with masar_service():
		detached = _detach("feature", doc.name)
		frappe.db.delete("Masar Activity", {"reference_doctype": "Masar Feature", "reference_name": doc.name})
		frappe.delete_doc("Masar Feature", doc.name)
		record_activity(space, "feature_deleted", {"title": doc.title, "tasksDetached": detached})
	return {"name": feature, "deleted": True, "tasksDetached": detached}


# --------------------------------------------------------------------------- Releases

RELEASE_FIELDS = {"releaseName": "release_name", "releaseDate": "release_date", "notes": "notes"}


def _release_row(doc, counts: dict | None, refs: dict) -> dict:
	return {
		"name": doc.name,
		"space": doc.space,
		"releaseName": doc.release_name,
		"releaseDate": iso_date(doc.release_date),
		"status": doc.status,
		"releasedAt": iso_datetime(doc.released_at),
		"releasedBy": refs.get(doc.released_by) if doc.released_by else None,
		"progress": _progress_payload(counts),
		"modified": iso_datetime(doc.modified),
	}


def _release_detail(doc) -> dict:
	refs = user_refs([doc.owner, doc.released_by])
	row = _release_row(doc, _progress("target_release", [doc.name]).get(doc.name), refs)
	permissions = _planning_permissions(doc.space)
	permissions["canLinkTasks"] = permissions["canLinkTasks"] and doc.status != "Archived"
	row.update(
		{
			"notes": doc.notes,
			"createdBy": refs.get(doc.owner),
			"creation": iso_datetime(doc.creation),
			"spaceTitle": frappe.db.get_value("Masar Space", doc.space, "title"),
			"allowedStatuses": list(RELEASE_TRANSITIONS[doc.status]) if permissions["canManage"] else [],
			"permissions": permissions,
		}
	)
	return row


def list_releases(space: str, status: str | None = None, q: str | None = None) -> dict:
	"""Releases of a Space: Planned first (by date, undated last), then Released, then Archived."""
	require_space_access(space)
	release = frappe.qb.DocType("Masar Release")
	query = (
		frappe.qb.from_(release)
		.select(
			release.name,
			release.space,
			release.release_name,
			release.release_date,
			release.status,
			release.released_at,
			release.released_by,
			release.modified,
		)
		.where(release.space == space)
	)
	if status:
		if status not in STATUSES:
			frappe.throw(_("Unknown Release status."))
		query = query.where(release.status == status)
	term = " ".join((q or "").split())
	if term:
		query = query.where(release.release_name.like(f"%{term}%"))
	rows = query.run(as_dict=True)
	far = getdate("9999-12-31")
	rows.sort(
		key=lambda r: (
			STATUSES.index(r.status),
			(getdate(r.release_date) if r.release_date else far)
			if r.status == "Planned"
			else -(getdate(r.release_date or r.released_at or "1970-01-01").toordinal()),
			r.release_name.casefold(),
		)
	)
	counts = _progress("target_release", [r.name for r in rows])
	refs = user_refs([r.released_by for r in rows])
	return {
		"items": [_release_row(r, counts.get(r.name), refs) for r in rows],
		"permissions": _planning_permissions(space),
	}


def list_my_releases(spaces_filter: list[str] | None = None) -> dict:
	"""Planned and Released Releases of every Space the caller belongs to (or the given ones), for the
	Versions box of All Tasks. Archived Releases are left out; each item names its Space."""
	allowed = _member_spaces(spaces_filter)
	if not allowed:
		return {"items": []}
	release = frappe.qb.DocType("Masar Release")
	space = frappe.qb.DocType("Masar Space")
	rows = (
		frappe.qb.from_(release)
		.join(space)
		.on(space.name == release.space)
		.select(
			release.name,
			release.space,
			space.title.as_("space_title"),
			release.release_name,
			release.release_date,
			release.status,
			release.released_at,
			release.released_by,
			release.modified,
		)
		.where(release.space.isin(allowed) & (release.status != "Archived"))
		.run(as_dict=True)
	)
	far = getdate("9999-12-31")
	rows.sort(
		key=lambda r: (
			STATUSES.index(r.status),
			getdate(r.release_date) if r.release_date else far,
			r.release_name.casefold(),
		)
	)
	counts = _progress("target_release", [r.name for r in rows])
	refs = user_refs([r.released_by for r in rows])
	items = []
	for r in rows:
		item = _release_row(r, counts.get(r.name), refs)
		item["spaceTitle"] = r.space_title
		items.append(item)
	return {"items": items}


def get_release(release: str) -> dict:
	return _release_detail(_load("Masar Release", release, manage=False))


def _insert_release(doc):
	"""Insert, turning a lost race on the (space, release_key) unique index into the same
	duplicate message the controller gives (ADR-040)."""
	frappe.db.savepoint("masar_release_write")
	try:
		doc.insert() if doc.is_new() else doc.save()
	except frappe.UniqueValidationError:
		frappe.db.rollback(save_point="masar_release_write")
		frappe.throw(
			_("A Release named {0} already exists in this Space.").format(doc.release_name),
			frappe.DuplicateEntryError,
		)


def create_release(
	space: str, release_name: str, release_date: str | None = None, notes: str | None = None
) -> dict:
	require_planning_manager(space)
	doc = frappe.get_doc(
		{
			"doctype": "Masar Release",
			"space": space,
			"release_name": release_name,
			"release_date": getdate(release_date) if release_date else None,
			"notes": notes or None,
			"status": "Planned",
		}
	)
	with masar_service():
		_insert_release(doc)
		record_activity(doc, "release_created", {"releaseName": doc.release_name})
	return _release_detail(doc)


def _normalise_release(field: str, value):
	if field == "releaseName":
		return " ".join((value or "").split()) or None
	if field == "releaseDate":
		return str(getdate(value)) if value else None
	return value or None


def update_release(release: str, changes: dict, base: dict | None = None) -> dict:
	if not isinstance(changes, dict) or not changes:
		frappe.throw(_("Nothing to update."))
	unknown = set(changes) - set(RELEASE_FIELDS)
	if unknown:
		frappe.throw(_("These fields cannot be edited here: {0}").format(", ".join(sorted(unknown))))
	doc = _load("Masar Release", release, manage=True)
	if doc.status == "Archived":
		frappe.throw(
			_("Archived Releases are read-only. Restore the Release to edit it."), frappe.PermissionError
		)
	_check_base(doc, base, RELEASE_FIELDS, changes, _normalise_release)
	for api_field, value in changes.items():
		doc.set(RELEASE_FIELDS[api_field], _normalise_release(api_field, value))
	with masar_service():
		_insert_release(doc)
		record_activity(doc, "release_updated", {"fields": sorted(changes)})
	return _release_detail(doc)


def set_release_status(release: str, status: str, expected_status: str | None = None) -> dict:
	"""Planned ⇄ Released → Archived, with restore from Archived (ADR-036). Releasing with open
	tasks is allowed; the response reports `openTasks` so the UI can warn first."""
	if status not in STATUSES:
		frappe.throw(_("Unknown Release status."))
	doc = _load("Masar Release", release, manage=True)
	if expected_status and expected_status != doc.status:
		frappe.local.response["conflicts"] = [{"field": "status", "current": doc.status, "yours": status}]
		frappe.throw(
			_("Someone else changed this Release's status. Review the latest value."), MasarConflictError
		)
	if status == doc.status:
		result = _release_detail(doc)
		result["openTasks"] = result["progress"]["open"]
		return result
	if status not in RELEASE_TRANSITIONS[doc.status]:
		frappe.throw(_("A Release cannot move from {0} to {1}.").format(_(doc.status), _(status)))
	previous = doc.status
	doc.status = status
	if status == "Released":
		doc.released_at = now_datetime()
		doc.released_by = frappe.session.user
	elif status == "Planned":
		doc.released_at = None
		doc.released_by = None
	with masar_service():
		doc.save()
		record_activity(doc, "release_status_changed", {"from": previous, "to": status})
	result = _release_detail(doc)
	result["openTasks"] = result["progress"]["open"]
	return result


def delete_release(release: str, detach: bool = False) -> dict:
	"""No cascade to Tasks (ADR-039). Linked Tasks block deletion unless detached explicitly;
	Archived Releases keep their links frozen and must be restored before deletion."""
	doc = _load("Masar Release", release, manage=True)
	if doc.status == "Archived":
		frappe.throw(
			_("Archived Releases cannot be deleted. Restore the Release first."), frappe.PermissionError
		)
	linked = len(_linked_tasks("target_release", doc.name))
	if linked and not detach:
		frappe.local.response["conflicts"] = [{"field": "tasks", "current": linked}]
		frappe.throw(
			_("This Release has {0} task(s). Remove them from the Release, or archive it instead.").format(
				linked
			),
			MasarConflictError,
		)
	space = frappe.get_doc("Masar Space", doc.space)
	with masar_service():
		detached = _detach("target_release", doc.name)
		frappe.db.delete("Masar Activity", {"reference_doctype": "Masar Release", "reference_name": doc.name})
		frappe.delete_doc("Masar Release", doc.name)
		record_activity(
			space, "release_deleted", {"releaseName": doc.release_name, "tasksDetached": detached}
		)
	return {"name": release, "deleted": True, "tasksDetached": detached}


# --------------------------------------------------------------------------- Task-side helpers


def planning_refs(features: list[str], releases: list[str]) -> tuple[dict, dict]:
	"""Compact {name: ref} maps for Task rows; callers pass names from already-authorised Tasks."""
	feature_refs, release_refs = {}, {}
	features = sorted({f for f in features if f})
	releases = sorted({r for r in releases if r})
	if features:
		feature = frappe.qb.DocType("Masar Feature")
		for name, title, roadmap in (
			frappe.qb.from_(feature)
			.select(feature.name, feature.title, feature.roadmap)
			.where(feature.name.isin(features))
			.run()
		):
			feature_refs[name] = {"name": name, "title": title, "roadmap": roadmap}
	if releases:
		rel = frappe.qb.DocType("Masar Release")
		for name, title, status in (
			frappe.qb.from_(rel)
			.select(rel.name, rel.release_name, rel.status)
			.where(rel.name.isin(releases))
			.run()
		):
			release_refs[name] = {"name": name, "title": title, "status": status}
	return feature_refs, release_refs
