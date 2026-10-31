"""Task workflows. Every write runs inside `masar_service()` after explicit authorization."""

import base64
import json
import re

import frappe
from frappe import _
from frappe.query_builder import Order
from frappe.query_builder.functions import Coalesce, Count
from frappe.utils import add_days, cint, getdate, nowdate

from masar.exceptions import MasarConflictError, MasarRequestReuseError
from masar.masar.doctype.masar_task.masar_task import (
	FINISHED_STATUSES,
	MANUAL_STATUSES,
	STATUSES,
	effective_estimate,
	set_estimate,
)
from masar.permissions import (
	batch_visible,
	can_delete_task,
	can_write_tasks,
	get_space_role,
	get_space_status,
	get_user_spaces,
	not_found,
	require_masar_user,
	require_space_access,
	require_task_access,
	require_task_write,
)
from masar.services.batch_service import batch_refs, move_tasks
from masar.services.personal.my_day_service import my_day_subquery, my_day_tasks, set_my_day
from masar.services.planning_service import planning_refs
from masar.services.serializers import iso_datetime, task_row, user_refs
from masar.utils.context import concurrent_duplicate, masar_service

CLIENT_REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
PRIORITIES = ("Lowest", "Low", "Medium", "High", "Highest")
SORT_STEP = 1024.0
MAX_PAGE = 500

# API field name -> DocType field name for inline-editable fields.
EDITABLE_FIELDS = {
	"title": "title",
	"description": "description",
	"status": "status",
	"priority": "priority",
	"dueDate": "due_date",
	"isImportant": "is_important",
	"remainingMinutes": "remaining_minutes",
	"feature": "feature",
	"release": "target_release",
}
LIST_FIELDS = (
	"name",
	"title",
	"space",
	"priority",
	"due_date",
	"status",
	"is_completed",
	"is_important",
	"task_owner",
	"action_count",
	"action_done_count",
	"comment_count",
	"sort_order",
	"modified",
	"client_request_id",
	"feature",
	"target_release",
)


# --------------------------------------------------------------------------- reads


def _encode_cursor(values: list) -> str:
	return base64.urlsafe_b64encode(json.dumps(values, default=str).encode()).decode()


def _decode_cursor(cursor: str) -> list:
	try:
		values = json.loads(base64.urlsafe_b64decode(cursor.encode()))
		if isinstance(values, list) and len(values) == 2:
			return values
	except ValueError:
		pass
	frappe.throw(_("Invalid cursor."))


def _assignees_by_task(task_names: list[str]) -> dict[str, list[str]]:
	if not task_names:
		return {}
	row = frappe.qb.DocType("Masar Task Assignee")
	result: dict[str, list[str]] = {}
	for parent, user in (
		frappe.qb.from_(row)
		.select(row.parent, row.user)
		.where((row.parent.isin(task_names)) & (row.parenttype == "Masar Task"))
		.orderby(row.parent)
		.orderby(row.idx)
		.run()
	):
		result.setdefault(parent, []).append(user)
	return result


DUE_FILTERS = ("overdue", "today", "week", "none")
SORTS = ("manual", "recently_updated", "due_date")
FAR_FUTURE = "9999-12-31"


def _labels_by_task(task_names: list[str]) -> dict[str, list[dict]]:
	if not task_names:
		return {}
	row = frappe.qb.DocType("Masar Task Label")
	label = frappe.qb.DocType("Masar Label")
	result: dict[str, list[dict]] = {}
	for parent, name, title, color in (
		frappe.qb.from_(row)
		.join(label)
		.on(label.name == row.label)
		.select(row.parent, label.name, label.label_name, label.color)
		.where(row.parent.isin(task_names) & (row.parenttype == "Masar Task"))
		.orderby(row.parent)
		.orderby(label.label_name)
		.run()
	):
		result.setdefault(parent, []).append({"name": name, "title": title, "color": color})
	return result


def _attachment_counts(task_names: list[str]) -> dict[str, int]:
	"""Files shown in Task details: Task files and files of live comments (as list_attachments), so
	pending composer uploads never mark a Task (client revision 5, attachment indicator)."""
	if not task_names:
		return {}
	att = frappe.qb.DocType("Masar Attachment")
	rows = (
		frappe.qb.from_(att)
		.select(att.task, Count("*"))
		.where(att.task.isin(task_names) & ((att.purpose == "Task") | att.comment.isnotnull()))
		.groupby(att.task)
		.run()
	)
	return dict(rows)


def _space_titles(spaces) -> dict[str, str]:
	spaces = sorted(set(spaces))
	if not spaces:
		return {}
	space = frappe.qb.DocType("Masar Space")
	return dict(frappe.qb.from_(space).select(space.name, space.title).where(space.name.isin(spaces)).run())


def _serialise_rows(rows) -> list[dict]:
	"""Fixed number of queries per page: assignees, users, labels, Space titles, Features, Releases,
	attachments."""
	names = [r.name for r in rows]
	assignees = _assignees_by_task(names)
	refs = user_refs([u for users in assignees.values() for u in users] + [r.get("task_owner") for r in rows])
	labels = _labels_by_task(names)
	titles = _space_titles(r.space for r in rows)
	features, releases = planning_refs(
		[r.get("feature") for r in rows], [r.get("target_release") for r in rows]
	)
	batches = batch_refs(names)
	my_day = my_day_tasks(names)
	attachments = _attachment_counts(names)
	items = []
	for r in rows:
		item = task_row(r, assignees.get(r.name, []), refs)
		item["isMyDay"] = r.name in my_day
		item["labels"] = labels.get(r.name, [])
		item["spaceTitle"] = titles.get(r.space)
		item["feature"] = features.get(r.get("feature"))
		item["release"] = releases.get(r.get("target_release"))
		item["batch"] = batches.get(r.name)
		item["attachmentCount"] = attachments.get(r.name, 0)
		items.append(item)
	return items


def _assigned_to(users: list[str]):
	"""Subquery of the Tasks assigned to any of these users."""
	assignee = frappe.qb.DocType("Masar Task Assignee")
	return (
		frappe.qb.from_(assignee)
		.select(assignee.parent)
		.where(assignee.user.isin(users) & (assignee.parenttype == "Masar Task"))
	)


def _query_tasks(
	spaces: list[str],
	*,
	assigned_to_me=False,
	owned_by_me=False,
	completed="all",
	important=False,
	my_day=False,
	statuses: list[str] | None = None,
	owners: list[str] | None = None,
	assignees: list[str] | None = None,
	priority: str | None = None,
	due: str | None = None,
	label: str | list[str] | None = None,
	feature: str | None = None,
	release: str | None = None,
	batch: str | None = None,
	q: str | None = None,
	sort="manual",
	cursor: str | None = None,
	limit=200,
) -> dict:
	"""Permission-aware keyset query. `spaces` must already be restricted to the caller's
	memberships; every filter is applied in SQL so pages and counts never include other Spaces."""
	limit = max(1, min(cint(limit) or 200, MAX_PAGE))
	if sort not in SORTS:
		frappe.throw(_("Unknown sort."))
	if not spaces:
		return {"items": [], "nextCursor": None}
	user = frappe.session.user
	task = frappe.qb.DocType("Masar Task")
	query = frappe.qb.from_(task).select(*[task[f] for f in LIST_FIELDS]).where(task.space.isin(spaces))

	if completed == "open":
		query = query.where(task.is_completed == 0)
	elif completed == "completed":
		query = query.where(task.is_completed == 1)
	if owned_by_me:
		query = query.where(task.task_owner == user)
	if assigned_to_me:
		query = query.where(task.name.isin(_assigned_to([user])))
	if statuses:
		if any(value not in STATUSES for value in statuses):
			frappe.throw(_("Unknown status."))
		query = query.where(task.status.isin(statuses))
	if owners:
		# Owners only narrow Tasks of Spaces already authorised above; no other user data is read.
		query = query.where(task.task_owner.isin([o for o in owners if isinstance(o, str)] or [""]))
	if assignees:
		# Like owners: Tasks with any of these assignees, within the Spaces authorised above.
		query = query.where(
			task.name.isin(_assigned_to([a for a in assignees if isinstance(a, str)] or [""]))
		)
	if important:
		query = query.where(task.is_important == 1)
	if my_day:
		query = query.where(task.name.isin(my_day_subquery(user)))
	if priority:
		if priority not in PRIORITIES:
			frappe.throw(_("Unknown priority."))
		query = query.where(task.priority == priority)
	if due:
		today = getdate(nowdate())
		if due == "overdue":
			query = query.where((task.due_date < today) & (task.is_completed == 0))
		elif due == "today":
			query = query.where(task.due_date == today)
		elif due == "week":
			query = query.where((task.due_date >= today) & (task.due_date <= add_days(today, 7)))
		elif due == "none":
			query = query.where(task.due_date.isnull())
		else:
			frappe.throw(_("Unknown due-date filter."))
	if label:
		task_label = frappe.qb.DocType("Masar Task Label")
		query = query.where(
			task.name.isin(
				frappe.qb.from_(task_label)
				.select(task_label.parent)
				.where(
					task_label.label.isin([label] if isinstance(label, str) else label)
					& (task_label.parenttype == "Masar Task")
				)
			)
		)
	# "none" selects Tasks without a Feature / Release; a name must already be validated for the Space.
	if feature:
		query = query.where(task.feature.isnull() if feature == "none" else task.feature == feature)
	if release:
		query = query.where(
			task.target_release.isnull() if release == "none" else task.target_release == release
		)
	if batch:
		# Current Batch membership lives only in Masar Batch Item (ADR-044): "none" = unbatched,
		# "any" = in some Planned/Active Batch, otherwise one Batch (already checked as visible).
		item = frappe.qb.DocType("Masar Batch Item")
		current = frappe.qb.from_(item).select(item.current_task).where(item.current_task.isnotnull())
		if batch == "none":
			query = query.where(task.name.notin(current))
		elif batch == "any":
			query = query.where(task.name.isin(current))
		else:
			query = query.where(task.name.isin(current.where(item.batch == batch)))
	term = " ".join((q or "").split())
	if term:
		# Title, description, live comments and Actions (client revision 5). The sub-queries only narrow
		# Tasks of the Spaces already authorised above.
		pattern = f"%{term}%"
		comment = frappe.qb.DocType("Masar Comment")
		action = frappe.qb.DocType("Masar Task Action")
		query = query.where(
			task.title.like(pattern)
			| task.description.like(pattern)
			| task.name.isin(
				frappe.qb.from_(comment)
				.select(comment.task)
				.where(comment.space.isin(spaces) & (comment.is_deleted == 0) & comment.content.like(pattern))
			)
			| task.name.isin(
				frappe.qb.from_(action)
				.select(action.task)
				.where(action.space.isin(spaces) & action.title.like(pattern))
			)
		)

	if sort == "recently_updated":
		key, order = task.modified, Order.desc
		cmp = lambda k, v: k < v  # noqa: E731
	elif sort == "due_date":
		key, order = Coalesce(task.due_date, FAR_FUTURE), Order.asc
		cmp = lambda k, v: k > v  # noqa: E731
	else:
		key, order = task.sort_order, Order.asc
		cmp = lambda k, v: k > v  # noqa: E731
	if cursor:
		last_key, last_name = _decode_cursor(cursor)
		name_cmp = (task.name < last_name) if order == Order.desc else (task.name > last_name)
		query = query.where(cmp(key, last_key) | ((key == last_key) & name_cmp))
	rows = (
		query.select(key.as_("_sort_key"))
		.orderby(key, order=order)
		.orderby(task.name, order=order)
		.limit(limit + 1)
		.run(as_dict=True)
	)
	next_cursor = None
	if len(rows) > limit:
		rows = rows[:limit]
		next_cursor = _encode_cursor([rows[-1]._sort_key, rows[-1].name])
	return {"items": _serialise_rows(rows), "nextCursor": next_cursor}


def list_tasks(space: str, **filters) -> dict:
	"""Task List of one Space (all filters server-side, keyset-paginated)."""
	require_space_access(space)
	_validate_space_filters(space, filters)
	return _query_tasks([space], **filters)


def _validate_space_filters(space: str, filters: dict):
	"""Label, Feature and Release filters must name records of the Space being listed."""
	for key, doctype, message in (
		("label", "Masar Label", _("This label belongs to another Space.")),
		("feature", "Masar Feature", _("This Feature belongs to another Space.")),
		("release", "Masar Release", _("This Release belongs to another Space.")),
	):
		value = filters.get(key)
		for name in value if isinstance(value, list) else [value]:
			if name and name != "none" and frappe.db.get_value(doctype, name, "space") != space:
				frappe.throw(message)
	_validate_batch_filter(filters)


def _validate_batch_filter(filters: dict):
	value = filters.get("batch")
	if value and value not in ("none", "any"):
		owner = frappe.db.get_value("Masar Batch", value, "batch_owner")
		if not owner or not batch_visible(value, owner):
			not_found("Batch")


def my_work(space: str | None = None, spaces_filter: list[str] | None = None, **filters) -> dict:
	"""Cross-Space work of the session user, limited to Spaces they currently belong to.
	`spaces_filter` narrows the result to several of those Spaces (cross-Space planning)."""
	require_masar_user()
	spaces = list(get_user_spaces())
	if space:
		if space not in spaces:
			not_found("Space")
		spaces = [space]
	elif spaces_filter:
		if any(name not in spaces for name in spaces_filter):
			not_found("Space")
		spaces = list(dict.fromkeys(spaces_filter))
	# Labels belong to one Space: a label filter needs exactly one Space in scope (All Tasks shows it
	# once a single Space is chosen), and its labels must be that Space's.
	labels = [name for name in filters.get("label") or [] if name != "none"] if not isinstance(
		filters.get("label"), str
	) else [filters["label"]]
	if labels:
		if len(spaces) != 1:
			frappe.throw(_("Choose a Space before filtering by label."))
		if any(frappe.db.get_value("Masar Label", name, "space") != spaces[0] for name in labels):
			frappe.throw(_("This label belongs to another Space."))
	if not space:
		# A Feature or Release filter across Spaces (All Tasks) must name a record of a listed Space.
		for key, doctype in (("feature", "Masar Feature"), ("release", "Masar Release")):
			value = filters.get(key)
			if value and value != "none" and frappe.db.get_value(doctype, value, "space") not in spaces:
				not_found(doctype.removeprefix("Masar "))
	if space:
		_validate_space_filters(space, filters)
	else:
		_validate_batch_filter(filters)
	filters.setdefault("sort", "recently_updated")
	return _query_tasks(spaces, **filters)


def _filter_spaces(space: str | None, spaces_filter: list[str] | None) -> list[str]:
	"""The caller's Spaces, narrowed to the requested ones; a Space they don't belong to is a 404."""
	require_masar_user()
	allowed = list(get_user_spaces())
	if space:
		if space not in allowed:
			not_found("Space")
		return [space]
	if spaces_filter:
		if any(name not in allowed for name in spaces_filter):
			not_found("Space")
		return list(dict.fromkeys(spaces_filter))
	return allowed


def _sorted_refs(users: list[str]) -> list[dict]:
	refs = user_refs(users)
	return sorted((refs[u] for u in users), key=lambda r: (r["fullName"] or "").lower())


def owners(space: str | None = None, spaces_filter: list[str] | None = None) -> list[dict]:
	"""People who own Tasks in the caller's Spaces (or the given ones), for the owner filter.
	Only Spaces the caller currently belongs to are read."""
	allowed = _filter_spaces(space, spaces_filter)
	if not allowed:
		return []
	task = frappe.qb.DocType("Masar Task")
	users = [
		u
		for (u,) in frappe.qb.from_(task)
		.select(task.task_owner)
		.distinct()
		.where(task.space.isin(allowed) & task.task_owner.isnotnull())
		.run()
	]
	return _sorted_refs(users)


def assignees(space: str | None = None, spaces_filter: list[str] | None = None) -> list[dict]:
	"""People assigned to Tasks in the caller's Spaces (or the given ones), for the assignee filter.
	Only Spaces the caller currently belongs to are read."""
	allowed = _filter_spaces(space, spaces_filter)
	if not allowed:
		return []
	task = frappe.qb.DocType("Masar Task")
	assignee = frappe.qb.DocType("Masar Task Assignee")
	users = [
		u
		for (u,) in frappe.qb.from_(assignee)
		.join(task)
		.on(task.name == assignee.parent)
		.select(assignee.user)
		.distinct()
		.where(task.space.isin(allowed) & (assignee.parenttype == "Masar Task") & assignee.user.isnotnull())
		.run()
	]
	return _sorted_refs(users)


def search(q: str, limit: int = 20) -> list[dict]:
	"""Title search for the command palette. Only the caller's Spaces are searched, so titles of
	inaccessible Tasks can never appear."""
	if len(" ".join((q or "").split())) < 2:
		return []
	result = my_work(q=q, sort="recently_updated", limit=min(cint(limit) or 20, 50))
	return [_compact(item) for item in result["items"]]


def lookup(names: list[str]) -> list[dict]:
	"""Re-authorise remembered Task ids (e.g. "recent tasks"): returns only accessible ones."""
	require_masar_user()
	names = [n for n in (names or []) if isinstance(n, str)][:50]
	spaces = list(get_user_spaces())
	if not names or not spaces:
		return []
	task = frappe.qb.DocType("Masar Task")
	rows = (
		frappe.qb.from_(task)
		.select(*[task[f] for f in LIST_FIELDS])
		.where(task.name.isin(names) & task.space.isin(spaces))
		.run(as_dict=True)
	)
	by_name = {item["name"]: _compact(item) for item in _serialise_rows(rows)}
	return [by_name[n] for n in names if n in by_name]


def _compact(item: dict) -> dict:
	return {
		"name": item["name"],
		"title": item["title"],
		"space": item["space"],
		"spaceTitle": item.get("spaceTitle"),
		"status": item["status"],
		"isCompleted": item["isCompleted"],
	}


def _detail(doc) -> dict:
	assignees = [row.user for row in doc.assignees]
	refs = user_refs([*assignees, doc.owner, doc.completed_by, doc.task_owner])
	row = task_row(doc.as_dict(), assignees, refs)
	role = get_space_role(doc.space)
	features, releases = planning_refs([doc.feature], [doc.target_release])
	row.update(
		{
			"description": doc.description,
			"remainingMinutes": effective_estimate(doc),
			"loggedMinutes": doc.logged_minutes or 0,
			"createdBy": refs.get(doc.owner),
			"creation": iso_datetime(doc.creation),
			"completedBy": refs.get(doc.completed_by) if doc.completed_by else None,
			"completedAt": iso_datetime(doc.completed_at),
			"spaceTitle": frappe.db.get_value("Masar Space", doc.space, "title"),
			"labels": _labels_by_task([doc.name]).get(doc.name, []),
			"sourceTask": (
				{
					"name": doc.source_task,
					"title": frappe.db.get_value("Masar Task", doc.source_task, "title"),
				}
				if doc.source_task
				else None
			),
			"sourceAction": doc.source_action,
			"feature": features.get(doc.feature),
			"release": releases.get(doc.target_release),
			"batch": batch_refs([doc.name]).get(doc.name),
			"isMyDay": bool(my_day_tasks([doc.name])),
			"permissions": {
				"canEdit": can_write_tasks(get_space_status(doc.space), role),
				"canDelete": can_delete_task(doc),
			},
		}
	)
	return row


def get_detail(task_name: str) -> dict:
	return _detail(require_task_access(task_name))


# --------------------------------------------------------------------------- writes


def _top_sort_order(space: str) -> float:
	"""New tasks are placed above existing ones so inline-created tasks appear where the user typed."""
	task = frappe.qb.DocType("Masar Task")
	current = (
		frappe.qb.from_(task)
		.select(task.sort_order)
		.where(task.space == space)
		.orderby(task.sort_order, order=Order.asc)
		.limit(1)
		.run()
	)
	return (float(current[0][0] or 0) if current else 0.0) - SORT_STEP


def _find_by_request(client_request_id: str, space: str, title: str) -> str | None:
	"""The Task an earlier attempt of this request created, if any. A key reused for another Space or
	title is a different request: it is rejected rather than answered with an unrelated Task."""
	existing = frappe.db.get_value(
		"Masar Task",
		{"owner": frappe.session.user, "client_request_id": client_request_id},
		["name", "space", "title"],
		as_dict=True,
	)
	if not existing:
		return None
	if existing.space != space or existing.title != " ".join((title or "").split()):
		frappe.throw(_("This request id was already used for a different task."), MasarRequestReuseError)
	return existing.name


def create(space: str, title: str, client_request_id: str) -> dict:
	"""Idempotent: the same (user, client_request_id) always yields the same single Task."""
	require_task_write(space, require_space_access(space))
	if not client_request_id or not CLIENT_REQUEST_ID.match(client_request_id):
		frappe.throw(_("A valid client request id is required."))
	if not " ".join((title or "").split()):
		frappe.throw(_("A task needs a title."))

	existing = _find_by_request(client_request_id, space, title)
	if existing:
		return {"task": get_detail(existing), "created": False}

	# The creator owns a new Task (I-TASK-2). Nobody is assigned automatically: people assign Tasks
	# themselves (owner decision of 2026-10-31).
	doc = frappe.get_doc(
		{
			"doctype": "Masar Task",
			"space": space,
			"title": title,
			"task_owner": frappe.session.user,
			"client_request_id": client_request_id,
			"sort_order": _top_sort_order(space),
		}
	)
	frappe.db.savepoint("masar_task_create")
	try:
		with masar_service():
			doc.insert()
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		# A concurrent request with the same id won the race; return its task.
		frappe.db.rollback(save_point="masar_task_create")
		existing = _find_by_request(client_request_id, space, title)
		if not existing:
			concurrent_duplicate()
		return {"task": get_detail(existing), "created": False}
	return {"task": _detail(doc), "created": True}


def _writable_task(task_name: str):
	"""Lock a readable Task and enforce the Space lifecycle rules for task writes (ADR-026)."""
	doc = require_task_access(task_name, for_update=True)
	require_task_write(doc.space, get_space_role(doc.space))
	return doc


def _normalise(fieldname: str, value):
	if fieldname == "is_important":
		return 1 if value in (True, 1, "1", "true") else 0
	if fieldname == "remaining_minutes":
		if value in (None, ""):
			return None
		if cint(value) < 0:
			frappe.throw(_("Remaining time cannot be negative."))
		return cint(value)
	if fieldname == "due_date":
		return str(getdate(value)) if value else None
	if fieldname == "title":
		return " ".join((value or "").split()) or None
	return value or None


def update(task_name: str, changes: dict, base: dict | None = None) -> dict:
	"""Field-scoped optimistic concurrency (ADR-018): a change conflicts only when the stored
	value of that same field differs from the value the client based its edit on."""
	if not isinstance(changes, dict) or not changes:
		frappe.throw(_("Nothing to update."))
	if "isMyDay" in changes:
		# Older Workspace builds sent My Day as a Task field; it is personal now (client revision 4).
		changes = dict(changes)
		set_my_day(task_name, bool(_normalise("is_important", changes.pop("isMyDay"))))
		if not changes:
			return get_detail(task_name)
	unknown = set(changes) - set(EDITABLE_FIELDS)
	if unknown:
		frappe.throw(_("These fields cannot be edited here: {0}").format(", ".join(sorted(unknown))))
	base = base or {}

	doc = _writable_task(task_name)
	conflicts = []
	for api_field, value in changes.items():
		field = EDITABLE_FIELDS[api_field]
		if api_field == "priority" and value not in PRIORITIES:
			frappe.throw(_("Unknown priority."))
		if api_field == "status":
			_check_manual_status(value)
		if api_field in base:
			stored = effective_estimate(doc) if field == "remaining_minutes" else doc.get(field)
			current = _normalise(field, stored)
			if current != _normalise(field, base[api_field]):
				conflicts.append({"field": api_field, "current": current, "yours": value})
				continue
		if field == "remaining_minutes":
			set_estimate(doc, _normalise(field, value))
		else:
			doc.set(field, _normalise(field, value) if field != "description" else (value or None))
	if conflicts:
		frappe.local.response["conflicts"] = conflicts
		frappe.throw(
			_("This task was changed by someone else. Review the latest values."), MasarConflictError
		)

	with masar_service():
		doc.save()
	return _detail(doc)


def _check_manual_status(value):
	if value == "Overdue":
		frappe.throw(_("Overdue is set automatically when the due date has passed."))
	if value not in MANUAL_STATUSES:
		frappe.throw(_("Unknown status."))


def set_completed(task_name: str, completed: bool) -> dict:
	doc = _writable_task(task_name)
	doc.is_completed = 1 if completed else 0
	with masar_service():
		doc.save()
	return _detail(doc)


def add_assignee(task_name: str, user: str) -> dict:
	"""Set-style operation applied to the locked latest row, so concurrent additions merge."""
	doc = _writable_task(task_name)
	if user not in {row.user for row in doc.assignees}:
		doc.append("assignees", {"user": user})
		with masar_service():
			doc.save()
	return _detail(doc)


def remove_assignee(task_name: str, user: str) -> dict:
	doc = _writable_task(task_name)
	remaining = [row for row in doc.assignees if row.user != user]
	if len(remaining) != len(doc.assignees):
		doc.set("assignees", remaining)
		with masar_service():
			doc.save()
	return _detail(doc)


def set_owner(task_name: str, user: str) -> dict:
	doc = _writable_task(task_name)
	if user not in {row.user for row in doc.assignees}:
		frappe.throw(_("The task owner must be one of the assignees."))
	doc.task_owner = user
	with masar_service():
		doc.save()
	return _detail(doc)


def delete(task_name: str) -> dict:
	doc = _writable_task(task_name)
	if not can_delete_task(doc):
		frappe.throw(_("Only the creator or a Space Manager can delete this task."), frappe.PermissionError)
	with masar_service():
		frappe.delete_doc("Masar Task", doc.name)
	return {"name": task_name, "deleted": True}


def add_label(task_name: str, label: str) -> dict:
	doc = _writable_task(task_name)
	if frappe.db.get_value("Masar Label", label, "space") != doc.space:
		frappe.throw(_("This label belongs to another Space."))
	if label not in {row.label for row in doc.labels}:
		doc.append("labels", {"label": label})
		with masar_service():
			doc.save()
	return _detail(doc)


def remove_label(task_name: str, label: str) -> dict:
	doc = _writable_task(task_name)
	remaining = [row for row in doc.labels if row.label != label]
	if len(remaining) != len(doc.labels):
		doc.set("labels", remaining)
		with masar_service():
			doc.save()
	return _detail(doc)


# --------------------------------------------------------------------------- bulk (ADR-031)

BULK_MAX = 200
BULK_OPERATIONS = (
	"priority",
	"add_label",
	"remove_label",
	"add_assignee",
	"remove_assignee",
	"set_completed",
	"set_status",
	"set_feature",
	"set_release",
	"set_batch",
)


def bulk_update(task_names: list[str], operation: str, value=None, expected: dict | None = None) -> dict:
	"""All-or-nothing bulk change across one or more Spaces.

	1. Every Task is authorised first (404 for the whole request if any is inaccessible, without
	   saying which), lifecycle rules are checked, and every value is validated per Space.
	2. For explicit overwrites (priority, completion, status) `expected` maps task -> the value the client
	   saw; any difference is a 409 listing the conflicting tasks (no silent overwrite).
	3. Changes are applied in the request transaction; any failure rolls back every Task.
	"""
	if operation not in BULK_OPERATIONS:
		frappe.throw(_("Unknown bulk operation."))
	if operation == "set_batch":
		# Unlike labels, Features and Releases, Batches span Spaces (ADR-046).
		result = move_tasks(task_names, value or None, expected)
		refreshed = frappe.db.get_all(  # move_tasks authorised every Task
			"Masar Task",
			filters={"name": ["in", result["changed"] + result["unchanged"]]},
			fields=list(LIST_FIELDS),
		)
		return {**result, "items": _serialise_rows(refreshed)}
	names = list(dict.fromkeys(n for n in (task_names or []) if isinstance(n, str)))
	if not names:
		frappe.throw(_("Select at least one task."))
	if len(names) > BULK_MAX:
		frappe.throw(_("Bulk changes are limited to {0} tasks at a time.").format(BULK_MAX))
	require_masar_user()
	spaces = get_user_spaces()
	rows = frappe.db.get_all(  # authorised below against the caller's memberships
		"Masar Task", filters={"name": ["in", names]}, fields=["name", "space"], limit_page_length=0
	)
	by_name = {r.name: r.space for r in rows}
	if len(by_name) != len(names) or any(by_name[n] not in spaces for n in names):
		not_found("Task")
	for space in set(by_name.values()):
		require_task_write(space, spaces[space])

	if operation == "priority" and value not in PRIORITIES:
		frappe.throw(_("Unknown priority."))
	if operation == "set_status":
		_check_manual_status(value)
	if operation in ("add_label", "remove_label"):
		label_space = frappe.db.get_value("Masar Label", value, "space")
		if not label_space or label_space not in spaces or set(by_name.values()) != {label_space}:
			frappe.throw(_("Labels can only be applied to tasks of the label's Space."))
	if operation in ("set_feature", "set_release") and value:
		doctype = "Masar Feature" if operation == "set_feature" else "Masar Release"
		target_space = frappe.db.get_value(doctype, value, "space")
		if not target_space or target_space not in spaces or set(by_name.values()) != {target_space}:
			frappe.throw(_("Features and Releases can only be applied to tasks of their own Space."))
	if operation == "add_assignee":
		for space in set(by_name.values()):
			if get_space_role(space, value) is None:
				frappe.throw(_("{0} is not a member of every selected task's Space.").format(value))

	docs = [frappe.get_doc("Masar Task", n, for_update=True) for n in names]
	expected = expected or {}
	field = {
		"priority": "priority",
		"set_completed": "is_completed",
		"set_status": "status",
		"set_feature": "feature",
		"set_release": "target_release",
	}.get(operation)
	if field:
		conflicts = []
		for doc in docs:
			if doc.name in expected and _normalise(field, expected[doc.name]) != _normalise(
				field, doc.get(field)
			):
				conflicts.append({"task": doc.name, "field": field, "current": doc.get(field)})
		if conflicts:
			frappe.local.response["conflicts"] = conflicts
			frappe.throw(
				_("Some selected tasks were changed by someone else. Refresh and try again."),
				MasarConflictError,
			)

	changed = []
	with masar_service():
		for doc in docs:
			before = doc.as_dict()
			if operation == "priority":
				doc.priority = value
			elif operation == "set_completed":
				doc.is_completed = 1 if value in (True, 1, "1", "true") else 0
			elif operation == "set_status":
				doc.status = value
			elif operation == "add_label" and value not in {r.label for r in doc.labels}:
				doc.append("labels", {"label": value})
			elif operation == "remove_label":
				doc.set("labels", [r for r in doc.labels if r.label != value])
			elif operation == "add_assignee" and value not in {r.user for r in doc.assignees}:
				doc.append("assignees", {"user": value})
			elif operation == "remove_assignee":
				doc.set("assignees", [r for r in doc.assignees if r.user != value])
			elif operation in ("set_feature", "set_release"):
				doc.set(field, value or None)
			if doc.as_dict() != before:
				doc.save()
				changed.append(doc.name)
	refreshed = frappe.db.get_all(  # same authorised set
		"Masar Task", filters={"name": ["in", names]}, fields=list(LIST_FIELDS), limit_page_length=0
	)
	return {
		"changed": changed,
		"unchanged": [n for n in names if n not in changed],
		"items": _serialise_rows(refreshed),
	}


# --------------------------------------------------------------------------- scheduled


def mark_overdue() -> int:
	"""Daily (Asia/Qatar): Tasks that are not finished when their due date has passed become Overdue,
	once per due date. The change is written to each Task's history as a change made by Masar.
	`modified` is left unchanged, so "recently updated" lists keep reflecting people's edits."""
	from frappe.utils import getdate, nowdate

	from masar.services.activity import record_activity

	today = getdate(nowdate())
	task = frappe.qb.DocType("Masar Task")
	rows = (
		frappe.qb.from_(task)
		.select(task.name, task.space, task.status, task.due_date)
		.where(
			task.due_date.isnotnull()
			& (task.due_date < today)
			& task.status.notin([*FINISHED_STATUSES, "Overdue"])
			& (task.overdue_for.isnull() | (task.overdue_for != task.due_date))
		)
		.run(as_dict=True)
	)
	with masar_service():
		for row in rows:
			frappe.db.set_value(
				"Masar Task", row.name, {"status": "Overdue", "overdue_for": row.due_date}, update_modified=False
			)
			doc = frappe._dict(doctype="Masar Task", name=row.name, space=row.space)
			record_activity(doc, "field_changed", {"field": "status", "from": row.status, "to": "Overdue"})
	return len(rows)  # the scheduler commits the job's transaction
