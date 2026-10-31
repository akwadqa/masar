"""Batches: cross-Space, time-boxed plans (ADR-043 … ADR-050).

Authority and visibility:
- A Batch is managed by its owner while the owner is a Manager of every Space whose Tasks are in it.
- A Batch is visible to its owner and to members of any Space that has (or had) Tasks in it. Everything
  task-derived (rows, counts, progress, history) is computed only from the viewer's own Spaces.

Membership: a `Masar Batch Item` row per participation. `current_task` is set while the Task is in a
Planned or Active Batch and is unique, so a Task can never be in two current Batches.
"""

import re

import frappe
from frappe import _
from frappe.query_builder.functions import Count, Sum
from frappe.utils import add_days, cint, getdate, now_datetime

from masar.exceptions import MasarConflictError, MasarRequestReuseError
from masar.masar.doctype.masar_batch.masar_batch import STATUSES
from masar.permissions import (
	CLOSED,
	MANAGER,
	batch_scope,
	batch_visible,
	can_create_batches,
	can_manage_batch,
	get_space_status,
	get_user_spaces,
	has_full_scope,
	not_found,
	require_masar_user,
	require_task_write,
)
from masar.services.activity import record_activity
from masar.services.serializers import iso_date, iso_datetime, user_refs
from masar.utils.context import concurrent_duplicate, masar_service

PRESETS = {"one_week": 7, "two_weeks": 14}  # inclusive calendar days (ADR-047)
MOVE_MAX = 200
REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
# Outcomes that count as participation at finish (Removed rows left the Batch before it ended).
FINISH_OUTCOMES = ("Completed", "Carried Over", "Returned")


# --------------------------------------------------------------------------- helpers


def _request_id(value: str | None, required: bool = False) -> str | None:
	if not value:
		if required:
			frappe.throw(_("A valid request id is required."))
		return None
	if not REQUEST_ID.match(value):
		frappe.throw(_("A valid request id is required."))
	return value


def end_for_preset(start_date, preset: str) -> str:
	"""One Week = 7 inclusive calendar days (Mon → Sun), Two Weeks = 14. Pure date arithmetic, no
	timezone conversion, so a calendar day can never shift."""
	if preset not in PRESETS:
		frappe.throw(_("Unknown duration preset."))
	return str(add_days(getdate(start_date), PRESETS[preset] - 1))


def _visible_batch(batch: str):
	"""Load a Batch the caller may see, or 404 (also for Batches that do not exist)."""
	require_masar_user()
	owner = frappe.db.get_value("Masar Batch", batch, "batch_owner") if batch else None
	if not owner or not batch_visible(batch, owner):
		not_found("Batch")
	return frappe.get_doc("Masar Batch", batch)


def _managed_batch(batch: str, *, lock: bool = True):
	"""A Batch the caller may plan: visible (else 404) and managed by them (else 403)."""
	doc = _visible_batch(batch)
	if lock:
		doc = frappe.get_doc("Masar Batch", batch, for_update=True)
	if doc.status == "Finished":
		frappe.throw(
			_("A finished Batch is a historical record and cannot be changed."), frappe.PermissionError
		)
	if not can_manage_batch(doc):
		frappe.throw(
			_("Only the Batch owner can plan it, and only while they manage every Space in it."),
			frappe.PermissionError,
		)
	return doc


def _progress(batches: list, spaces: list[str]) -> dict[str, dict]:
	"""Viewer-scoped progress (ADR-048): only Tasks of `spaces` are counted, so a partial viewer can
	never infer how much work hidden Spaces contribute. Two grouped queries for any number of Batches."""
	result = {b.name: {"total": 0, "completed": 0, "addedAfterStart": 0, "removed": 0} for b in batches}
	if not batches or not spaces:
		return result
	item = frappe.qb.DocType("Masar Batch Item")
	task = frappe.qb.DocType("Masar Task")
	live = [b.name for b in batches if b.status != "Finished"]
	done = [b.name for b in batches if b.status == "Finished"]
	if live:
		rows = (
			frappe.qb.from_(item)
			.join(task)
			.on(task.name == item.current_task)
			.select(item.batch, Count(item.name), Sum(task.is_completed), Sum(item.added_after_start))
			.where(item.batch.isin(live) & item.space.isin(spaces) & item.current_task.isnotnull())
			.groupby(item.batch)
			.run()
		)
		for batch, total, completed, added in rows:
			result[batch].update(total=cint(total), completed=cint(completed), addedAfterStart=cint(added))
	if done:
		rows = (
			frappe.qb.from_(item)
			.select(item.batch, Count(item.name), Sum(item.completed_at_finish), Sum(item.added_after_start))
			.where(item.batch.isin(done) & item.space.isin(spaces) & item.outcome.isin(FINISH_OUTCOMES))
			.groupby(item.batch)
			.run()
		)
		for batch, total, completed, added in rows:
			result[batch].update(total=cint(total), completed=cint(completed), addedAfterStart=cint(added))
	rows = (
		frappe.qb.from_(item)
		.select(item.batch, Count(item.name))
		.where(
			item.batch.isin([b.name for b in batches]) & item.space.isin(spaces) & (item.outcome == "Removed")
		)
		.groupby(item.batch)
		.run()
	)
	for batch, removed in rows:
		result[batch]["removed"] = cint(removed)
	for value in result.values():
		value["open"] = value["total"] - value["completed"]
		value["percent"] = round(value["completed"] * 100 / value["total"]) if value["total"] else None
	return result


def _row(doc, progress: dict, refs: dict, manageable: set[str]) -> dict:
	user = frappe.session.user
	return {
		"name": doc.name,
		"batchName": doc.batch_name,
		"startDate": iso_date(doc.start_date),
		"endDate": iso_date(doc.end_date),
		"durationDays": (getdate(doc.end_date) - getdate(doc.start_date)).days + 1,
		"status": doc.status,
		"owner": refs.get(doc.batch_owner),
		"isOwner": doc.batch_owner == user,
		"startedAt": iso_datetime(doc.started_at),
		"finishedAt": iso_datetime(doc.finished_at),
		"progress": progress,
		"canManage": doc.name in manageable,
	}


def _manageable(batches) -> set[str]:
	return {b.name for b in batches if can_manage_batch(b)}


BATCH_FIELDS = (
	"name",
	"batch_name",
	"start_date",
	"end_date",
	"status",
	"batch_owner",
	"started_at",
	"finished_at",
)


def _set_internal(doc, **values):
	"""Request ids and the finish destination are permlevel-1 fields: hidden from generic document
	reads (they would let other viewers replay or learn about Batches they cannot see). Frappe resets
	such fields on save for users without access, so they are written directly after the authorised
	save, inside the same transaction."""
	for field, value in values.items():
		doc.db_set(field, value, update_modified=False)


# --------------------------------------------------------------------------- reads


def list_batches(
	status: str | None = None, q: str | None = None, space: str | None = None, manageable: bool = False
) -> dict:
	"""Batches the caller may see. With `space`, only Batches holding that Space's Tasks, with progress
	counted for that Space only (Space "Active Batches" tab). `manageable` lists planning targets."""
	require_masar_user()
	user = frappe.session.user
	spaces = list(get_user_spaces())
	if space:
		if space not in spaces:
			not_found("Space")
		spaces = [space]
	if status and status not in STATUSES:
		frappe.throw(_("Unknown Batch status."))
	batch = frappe.qb.DocType("Masar Batch")
	item = frappe.qb.DocType("Masar Batch Item")
	query = frappe.qb.from_(batch).select(*[batch[f] for f in BATCH_FIELDS])
	containing = frappe.qb.from_(item).select(item.batch).where(item.space.isin(spaces or [""]))
	if space:
		query = query.where(batch.name.isin(containing))
	elif manageable:
		query = query.where((batch.batch_owner == user) & (batch.status != "Finished"))
	else:
		query = query.where((batch.batch_owner == user) | batch.name.isin(containing))
	if status:
		query = query.where(batch.status == status)
	term = " ".join((q or "").split())
	if term:
		query = query.where(batch.batch_name.like(f"%{term}%"))
	rows = query.run(as_dict=True)
	if space and status in (None, "Planned", "Active"):
		# Planned/Active: only Batches that currently hold this Space's Tasks.
		current = {
			name
			for (name,) in frappe.qb.from_(item)
			.select(item.batch)
			.distinct()
			.where((item.space == space) & item.current_task.isnotnull())
			.run()
		}
		rows = [r for r in rows if r.status == "Finished" or r.name in current]
	can_manage = _manageable(rows)
	if manageable:
		rows = [r for r in rows if r.name in can_manage]
	order = {"Active": 0, "Planned": 1, "Finished": 2}
	rows.sort(
		key=lambda r: (
			order[r.status],
			-(getdate(r.finished_at or r.end_date).toordinal())
			if r.status == "Finished"
			else getdate(r.start_date),
			r.batch_name.casefold(),
		)
	)
	progress = _progress(rows, spaces)
	refs = user_refs([r.batch_owner for r in rows])
	return {
		"items": [_row(r, progress[r.name], refs, can_manage) for r in rows],
		"permissions": {"canCreate": can_create_batches()},
	}


def _detail(doc) -> dict:
	spaces = list(get_user_spaces())
	refs = user_refs([doc.batch_owner, doc.started_by, doc.finished_by])
	row = _row(doc, _progress([doc], spaces)[doc.name], refs, _manageable([doc]))
	destination = None
	if doc.finish_destination:
		dest = frappe.db.get_value(
			"Masar Batch", doc.finish_destination, ["name", "batch_name", "batch_owner"], as_dict=True
		)
		if dest and batch_visible(dest.name, dest.batch_owner):
			destination = {"name": dest.name, "batchName": dest.batch_name}
	is_owner = doc.batch_owner == frappe.session.user
	scope = batch_scope(doc.name) if is_owner and doc.status != "Finished" else set()
	row.update(
		{
			"startedBy": refs.get(doc.started_by) if doc.started_by else None,
			"finishedBy": refs.get(doc.finished_by) if doc.finished_by else None,
			"finishCarry": doc.finish_carry or None,
			"finishDestination": destination,
			# Only the owner learns that some planned work is outside their current access (no counts),
			# so they know to transfer the Batch; partial viewers are told nothing (ADR-045).
			"ownerLacksAccess": bool(scope - set(spaces)) if is_owner else False,
			"ownerLacksAuthority": (not has_full_scope(doc.name))
			if is_owner and doc.status != "Finished"
			else False,
			"canClaim": _can_claim(doc),
		}
	)
	return row


def get_batch(batch: str) -> dict:
	return _detail(_visible_batch(batch))


def batch_tasks(batch: str, **filters) -> dict:
	"""Current Tasks of a Planned/Active Batch, limited to the caller's Spaces (shared Task query)."""
	from masar.services import task_service

	doc = _visible_batch(batch)
	if doc.status == "Finished":
		return {"items": [], "nextCursor": None}
	filters["batch"] = doc.name
	return task_service._query_tasks(list(get_user_spaces()), **filters)


def batch_history(batch: str) -> list[dict]:
	"""Participation records of the caller's Spaces, with the outcome frozen at finish (ADR-049)."""
	from masar.services import task_service

	doc = _visible_batch(batch)
	spaces = list(get_user_spaces())
	if not spaces:
		return []
	items = frappe.get_all(  # restricted to the caller's Spaces below
		"Masar Batch Item",
		filters={"batch": doc.name, "space": ["in", spaces]},
		fields=[
			"name",
			"task",
			"space",
			"outcome",
			"completed_at_finish",
			"added_after_start",
			"added_at",
			"removed_at",
			"carried_to",
			"carried_from",
		],
		order_by="added_at asc, name asc",
	)
	task = frappe.qb.DocType("Masar Task")
	names = [i.task for i in items if i.task]
	rows = (
		frappe.qb.from_(task)
		.select(*[task[f] for f in task_service.LIST_FIELDS])
		.where(task.name.isin(names or [""]))
		.run(as_dict=True)
	)
	by_name = {r["name"]: r for r in task_service._serialise_rows(rows)}
	titles = {}
	linked = {i.carried_to for i in items if i.carried_to} | {i.carried_from for i in items if i.carried_from}
	for name in linked:
		owner, title = frappe.db.get_value("Masar Batch", name, ["batch_owner", "batch_name"]) or (None, None)
		if owner and batch_visible(name, owner):
			titles[name] = {"name": name, "batchName": title}
	return [
		{
			"name": i.name,
			"task": by_name.get(i.task),
			"outcome": i.outcome,
			"completedAtFinish": bool(i.completed_at_finish) if doc.status == "Finished" else None,
			"addedAfterStart": bool(i.added_after_start),
			"addedAt": iso_datetime(i.added_at),
			"removedAt": iso_datetime(i.removed_at),
			"carriedTo": titles.get(i.carried_to),
			"carriedFrom": titles.get(i.carried_from),
		}
		for i in items
	]


def batch_refs(task_names: list[str]) -> dict[str, dict]:
	"""Current Batch of each Task (callers pass already-authorised Task names). A Batch holding one of
	the caller's Tasks is visible to them, so its name is not hidden information."""
	if not task_names:
		return {}
	item = frappe.qb.DocType("Masar Batch Item")
	batch = frappe.qb.DocType("Masar Batch")
	rows = (
		frappe.qb.from_(item)
		.join(batch)
		.on(batch.name == item.batch)
		.select(item.current_task, batch.name, batch.batch_name, batch.status)
		.where(item.current_task.isin(task_names))
		.run()
	)
	return {task: {"name": name, "title": title, "status": status} for task, name, title, status in rows}


# --------------------------------------------------------------------------- planning metadata


def _find_created(client_request_id: str):
	return frappe.db.get_value(
		"Masar Batch",
		{"owner": frappe.session.user, "client_request_id": client_request_id},
		["name", "batch_name", "start_date"],
		as_dict=True,
	)


def create_batch(
	batch_name: str,
	start_date: str,
	end_date: str | None = None,
	preset: str | None = None,
	client_request_id: str | None = None,
) -> dict:
	"""Any Space Manager may create a Batch and becomes its owner. Idempotent per request id."""
	require_masar_user()
	if not can_create_batches():
		frappe.throw(_("Only Space Managers can create Batches."), frappe.PermissionError)
	key = _request_id(client_request_id)
	if not start_date:
		frappe.throw(_("A Batch needs a start date."))
	if preset:
		end_date = end_for_preset(start_date, preset)
	if not end_date:
		frappe.throw(_("A Batch needs an end date or a duration preset."))
	if key:
		existing = _find_created(key)
		if existing:
			if existing.batch_name != " ".join((batch_name or "").split()) or getdate(
				existing.start_date
			) != getdate(start_date):
				frappe.throw(
					_("This request id was already used for a different Batch."), MasarRequestReuseError
				)
			return {"batch": _detail(frappe.get_doc("Masar Batch", existing.name)), "created": False}
	doc = frappe.get_doc(
		{
			"doctype": "Masar Batch",
			"batch_name": batch_name,
			"start_date": getdate(start_date),
			"end_date": getdate(end_date),
			"status": "Planned",
			"batch_owner": frappe.session.user,
		}
	)
	frappe.db.savepoint("masar_batch_create")
	try:
		with masar_service():
			doc.insert()
			_set_internal(doc, client_request_id=key)
			record_activity(doc, "batch_created", {"batchName": doc.batch_name})
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		frappe.db.rollback(save_point="masar_batch_create")
		existing = key and _find_created(key)
		if not existing:
			concurrent_duplicate()
		return {"batch": _detail(frappe.get_doc("Masar Batch", existing.name)), "created": False}
	return {"batch": _detail(doc), "created": True}


EDITABLE = {"batchName": "batch_name", "startDate": "start_date", "endDate": "end_date"}


def _normalise(field: str, value):
	if field == "batchName":
		return " ".join((value or "").split()) or None
	return str(getdate(value)) if value else None


def update_batch(batch: str, changes: dict, base: dict | None = None) -> dict:
	"""Name and dates are planning metadata: editable while Planned (ADR-046)."""
	if not isinstance(changes, dict) or not changes:
		frappe.throw(_("Nothing to update."))
	unknown = set(changes) - set(EDITABLE)
	if unknown:
		frappe.throw(_("These fields cannot be edited here: {0}").format(", ".join(sorted(unknown))))
	doc = _managed_batch(batch)
	if doc.status != "Planned":
		frappe.throw(_("Name and dates can only be changed before the Batch starts."), frappe.PermissionError)
	conflicts = []
	for field, value in changes.items():
		if (
			base
			and field in base
			and _normalise(field, doc.get(EDITABLE[field])) != _normalise(field, base[field])
		):
			conflicts.append(
				{"field": field, "current": _normalise(field, doc.get(EDITABLE[field])), "yours": value}
			)
	if conflicts:
		frappe.local.response["conflicts"] = conflicts
		frappe.throw(
			_("This Batch was changed by someone else. Review the latest values."), MasarConflictError
		)
	for field, value in changes.items():
		doc.set(EDITABLE[field], _normalise(field, value))
	with masar_service():
		doc.save()
		record_activity(doc, "batch_updated", {"fields": sorted(changes)})
	return _detail(doc)


def delete_batch(batch: str) -> dict:
	"""Delete a Planned Batch (client revision 3). Its Tasks first return to the Backlog through
	`move_tasks`, so the same authorisation, locking and history apply; Active and Finished Batches
	are history and cannot be deleted."""
	doc = _managed_batch(batch)
	if doc.status != "Planned":
		frappe.throw(_("Only a planned Batch can be deleted. Active and finished Batches are kept as history."))
	planned = frappe.get_all(
		"Masar Batch Item", filters={"batch": doc.name, "current_task": ["is", "set"]}, pluck="current_task"
	)
	if planned:
		move_tasks(planned, None)
	if frappe.db.exists("Masar Batch Item", {"batch": doc.name}):
		frappe.throw(_("This Batch still holds tasks you cannot move. Nothing was deleted."))
	with masar_service():
		frappe.db.delete("Masar Activity", {"reference_doctype": "Masar Batch", "reference_name": doc.name})
		frappe.delete_doc("Masar Batch", doc.name)
	return {"name": batch, "deleted": True}


def _can_claim(doc) -> bool:
	"""Recovery: when the owner no longer manages every participating Space, a user who does (and who
	can see the Batch) may take it over. Scope must be non-empty; finished Batches are history."""
	user = frappe.session.user
	if doc.status == "Finished" or doc.batch_owner == user:
		return False
	scope = batch_scope(doc.name)
	if not scope or not has_full_scope(doc.name, user):
		return False
	return not has_full_scope(doc.name, doc.batch_owner) or not frappe.db.get_value(
		"User", doc.batch_owner, "enabled"
	)


def transfer_ownership(batch: str, new_owner: str, expected_owner: str | None = None) -> dict:
	"""The owner hands the Batch to a Manager of every participating Space; or, if the owner lost that
	authority, such a Manager claims it (`new_owner` = themselves). No global Planner role (ADR-043)."""
	doc = _visible_batch(batch)
	doc = frappe.get_doc("Masar Batch", batch, for_update=True)
	if doc.status == "Finished":
		frappe.throw(
			_("A finished Batch is a historical record and cannot be changed."), frappe.PermissionError
		)
	if expected_owner and expected_owner != doc.batch_owner:
		frappe.local.response["conflicts"] = [{"field": "owner", "current": doc.batch_owner}]
		frappe.throw(_("The Batch owner changed meanwhile. Review the latest state."), MasarConflictError)
	user = frappe.session.user
	claiming = new_owner == user and _can_claim(doc)
	if not claiming and not can_manage_batch(doc):
		frappe.throw(_("Only the Batch owner can transfer it."), frappe.PermissionError)
	spaces = get_user_spaces(new_owner)
	if not frappe.db.get_value("User", new_owner, "enabled") or not any(
		r == MANAGER for r in spaces.values()
	):
		frappe.throw(_("The new owner must be an active Space Manager."))
	if not has_full_scope(doc.name, new_owner):
		frappe.throw(_("The new owner must manage every Space whose tasks are in this Batch."))
	previous = doc.batch_owner
	doc.batch_owner = new_owner
	with masar_service():
		doc.save()
		record_activity(doc, "batch_owner_changed", {"from": previous, "to": new_owner, "claimed": claiming})
	return _detail(doc)


def owner_candidates(batch: str) -> list[dict]:
	"""Possible new owners: active Managers of every Space whose Tasks are in the Batch (for an empty
	Batch: Managers of the caller's Spaces). Only the managing owner may ask; the names returned are
	members of Spaces the caller already manages."""
	doc = _managed_batch(batch, lock=False)
	scope = batch_scope(doc.name) or {s for s, role in get_user_spaces().items() if role == MANAGER}
	member = frappe.qb.DocType("Masar Space Member")
	user = frappe.qb.DocType("User")
	rows = (
		frappe.qb.from_(member)
		.join(user)
		.on(user.name == member.user)
		.select(member.user, member.parent)
		.where(member.parent.isin(list(scope)) & (member.role == MANAGER) & (user.enabled == 1))
		.where(member.parenttype == "Masar Space")
		.run()
	)
	spaces_of: dict[str, set] = {}
	for name, space in rows:
		spaces_of.setdefault(name, set()).add(space)
	required = batch_scope(doc.name)
	names = [u for u, spaces in spaces_of.items() if spaces >= required and u != doc.batch_owner]
	refs = user_refs(names)
	return sorted((refs[n] for n in names), key=lambda r: r["fullName"].casefold())


# --------------------------------------------------------------------------- membership


def _leave(item, batch_status: str):
	"""A Task leaves a Batch. Leaving a Planned Batch is a planning edit (no history kept); leaving an
	Active Batch is a scope change recorded on the participation row (ADR-048)."""
	if batch_status == "Planned" and not item.carried_from:
		frappe.delete_doc("Masar Batch Item", item.name)
		return
	doc = frappe.get_doc("Masar Batch Item", item.name)
	doc.current_task = None
	doc.outcome = "Removed"
	doc.removed_at = now_datetime()
	doc.removed_by = frappe.session.user
	doc.save()


def _insert_item(batch: str, task: str, space: str, *, after_start: bool, carried_from: str | None = None):
	frappe.get_doc(
		{
			"doctype": "Masar Batch Item",
			"batch": batch,
			"task": task,
			"space": space,
			"current_task": task,
			"outcome": "Open",
			"added_at": now_datetime(),
			"added_by": frappe.session.user,
			"added_after_start": 1 if after_start else 0,
			"carried_from": carried_from,
		}
	).insert()


def _task_activity(task: str, space: str, event: str, data: dict):
	record_activity(frappe._dict(doctype="Masar Task", name=task, space=space), event, data, space=space)


def move_tasks(task_names: list[str], batch: str | None, expected: dict | None = None) -> dict:
	"""Put Tasks into `batch`, or take them out of their current Batch (`batch` = None).

	All or nothing (ADR-046): every Task must be visible (else 404 for the whole request), in a Space the
	caller manages and may write, and both the source and target Batches must be managed by the caller.
	Tasks may come from several Spaces. Task rows are locked, so concurrent moves of one Task serialise;
	the unique `current_task` index is the final guard against two current Batches."""
	names = list(dict.fromkeys(n for n in (task_names or []) if isinstance(n, str)))
	if not names:
		frappe.throw(_("Select at least one task."))
	if len(names) > MOVE_MAX:
		frappe.throw(_("Batch changes are limited to {0} tasks at a time.").format(MOVE_MAX))
	require_masar_user()
	spaces = get_user_spaces()
	rows = frappe.get_all(  # authorised below against the caller's memberships
		"Masar Task", filters={"name": ["in", names]}, fields=["name", "space"], limit_page_length=0
	)
	space_of = {r.name: r.space for r in rows}
	if len(space_of) != len(names) or any(space_of[n] not in spaces for n in names):
		not_found("Task")
	for space in set(space_of.values()):
		if spaces[space] != MANAGER:
			frappe.throw(_("Only Space Managers can plan tasks into Batches."), frappe.PermissionError)
		require_task_write(space, MANAGER)
	target = _managed_batch(batch) if batch else None
	frappe.db.sql("select name from `tabMasar Task` where name in %s for update", (names,))
	current = {
		r.current_task: r
		for r in frappe.get_all(
			"Masar Batch Item",
			filters={"current_task": ["in", names]},
			fields=["name", "batch", "current_task", "carried_from"],
		)
	}
	sources = {}
	for item in current.values():
		if target and item.batch == target.name:
			continue
		if item.batch not in sources:
			sources[item.batch] = frappe.get_doc("Masar Batch", item.batch, for_update=True)
			if not can_manage_batch(sources[item.batch]):
				frappe.throw(
					_("A selected task is in a Batch you do not manage. Ask its owner to move it."),
					frappe.PermissionError,
				)
	conflicts = [
		{"task": n, "field": "batch", "current": current[n].batch if n in current else None}
		for n in names
		if expected
		and n in expected
		and (expected[n] or None) != (current[n].batch if n in current else None)
	]
	if conflicts:
		frappe.local.response["conflicts"] = conflicts
		frappe.throw(
			_("Some selected tasks changed Batch meanwhile. Refresh and try again."), MasarConflictError
		)

	changed = []
	with masar_service():
		for name in names:
			item = current.get(name)
			if item and target and item.batch == target.name:
				continue
			if not item and not target:
				continue
			if item:
				_leave(item, sources[item.batch].status)
				_task_activity(name, space_of[name], "batch_removed", {"batch": item.batch})
			if target:
				try:
					_insert_item(target.name, name, space_of[name], after_start=target.status == "Active")
				except (frappe.UniqueValidationError, frappe.DuplicateEntryError):
					frappe.throw(
						_("A selected task was just planned into another Batch. Refresh and try again."),
						MasarConflictError,
					)
				_task_activity(name, space_of[name], "batch_added", {"batch": target.name})
			changed.append(name)
	return {"changed": changed, "unchanged": [n for n in names if n not in changed]}


# --------------------------------------------------------------------------- lifecycle (ADR-046, ADR-049)


def start_batch(batch: str, request_id: str | None = None) -> dict:
	"""Planned → Active, explicitly. Repeating the same request returns the same result without new
	history; a different start of an already Active Batch is a conflict."""
	key = _request_id(request_id)
	doc = _visible_batch(batch)
	doc = frappe.get_doc("Masar Batch", batch, for_update=True)
	if doc.status != "Finished" and not can_manage_batch(doc):
		_managed_batch(batch)  # raises the authority error before any state is revealed
	if doc.status != "Planned":
		if doc.status == "Active" and key and doc.start_request_id == key:
			return _detail(doc)
		frappe.local.response["conflicts"] = [{"field": "status", "current": doc.status}]
		frappe.throw(_("This Batch was already started or finished."), MasarConflictError)
	doc = _managed_batch(batch)
	doc.status = "Active"
	doc.started_at = now_datetime()
	doc.started_by = frappe.session.user
	with masar_service():
		doc.save()
		_set_internal(doc, start_request_id=key)
		record_activity(doc, "batch_started", {})
	return _detail(doc)


def _current_items(batch: str, lock: bool = False) -> list:
	item = frappe.qb.DocType("Masar Batch Item")
	task = frappe.qb.DocType("Masar Task")
	query = (
		frappe.qb.from_(item)
		.join(task)
		.on(task.name == item.current_task)
		.select(item.name, item.task, item.space, item.carried_from, task.is_completed)
		.where((item.batch == batch) & item.current_task.isnotnull())
		.orderby(item.name)
	)
	if lock:
		query = query.for_update()
	return query.run(as_dict=True)


def finish_preview(batch: str) -> dict:
	"""What finishing would do. Only for someone who manages the whole Batch (full scope), so the counts
	reveal nothing beyond Spaces they already manage."""
	doc = _managed_batch(batch, lock=False)
	if doc.status != "Active":
		frappe.throw(_("Only an active Batch can be finished."))
	items = _current_items(doc.name)
	open_items = [i for i in items if not i.is_completed]
	closed = [i for i in open_items if get_space_status(i.space) == CLOSED]
	destinations = [
		b for b in list_batches(status="Planned", manageable=True)["items"] if b["name"] != doc.name
	]
	return {
		"completed": len(items) - len(open_items),
		"unfinished": len(open_items),
		"unfinishedInClosedSpaces": len(closed),
		"destinations": [
			{"name": b["name"], "batchName": b["batchName"], "startDate": b["startDate"]}
			for b in destinations
		],
	}


def _finish_result(doc) -> dict:
	"""Outcome counts for the caller's Spaces (the finisher manages them all, so for them this is the
	whole Batch; nobody else receives counts beyond their own Spaces)."""
	item = frappe.qb.DocType("Masar Batch Item")
	counts = dict(
		frappe.qb.from_(item)
		.select(item.outcome, Count(item.name))
		.where((item.batch == doc.name) & item.space.isin(list(get_user_spaces()) or [""]))
		.groupby(item.outcome)
		.run()
	)
	return {
		"batch": _detail(doc),
		"completed": cint(counts.get("Completed")),
		"carriedOver": cint(counts.get("Carried Over")),
		"returned": cint(counts.get("Returned")),
	}


def finish_batch(
	batch: str, carry: str, destination: str | None = None, request_id: str | None = None
) -> dict:
	"""Active → Finished in one transaction (ADR-049, ADR-050).

	1. Lock the Batch (and the destination); a replay of the same request returns the stored result.
	2. Freeze each current participation: `completed_at_finish` snapshot and outcome.
	3. Unfinished Tasks go to the chosen Planned Batch or back to unbatched work (Tasks of Closed
	   Spaces are read-only and always return to unbatched). Tasks are never duplicated or completed.
	4. Mark the Batch Finished with actor and time. Any failure rolls back everything.
	"""
	if carry not in ("Unbatched", "Batch"):
		frappe.throw(_("Choose what happens to unfinished tasks."))
	key = _request_id(request_id, required=True)
	doc = _visible_batch(batch)
	doc = frappe.get_doc("Masar Batch", batch, for_update=True)
	if doc.status == "Finished":
		# A lost-response replay is honoured only for the user who finished the Batch (ADR-049).
		if doc.finish_request_id == key and doc.finished_by == frappe.session.user:
			return _finish_result(doc)
		frappe.local.response["conflicts"] = [{"field": "status", "current": doc.status}]
		frappe.throw(_("This Batch was already finished."), MasarConflictError)
	doc = _managed_batch(batch)  # authority before state validation
	if doc.status != "Active":
		frappe.throw(_("Only an active Batch can be finished."))
	dest = None
	if carry == "Batch":
		if not destination or destination == doc.name:
			frappe.throw(_("Choose a planned Batch for the unfinished tasks."))
		dest = _managed_batch(destination)
		if dest.status != "Planned":
			frappe.throw(_("Unfinished tasks can only move to a planned Batch."))
	items = _current_items(doc.name, lock=True)
	carried = []
	now = now_datetime()
	with masar_service():
		for i in items:
			row = frappe.get_doc("Masar Batch Item", i.name)
			row.completed_at_finish = 1 if i.is_completed else 0
			row.current_task = None
			if i.is_completed:
				row.outcome = "Completed"
			elif dest and get_space_status(i.space) != CLOSED:
				row.outcome = "Carried Over"
				row.carried_to = dest.name
				carried.append(i)
			else:
				row.outcome = "Returned"
			row.save()
		for i in carried:
			_insert_item(dest.name, i.task, i.space, after_start=False, carried_from=doc.name)
			_task_activity(i.task, i.space, "batch_added", {"batch": dest.name, "carriedFrom": doc.name})
		doc.status = "Finished"
		doc.finished_at = now
		doc.finished_by = frappe.session.user
		doc.finish_carry = carry
		doc.save()
		_set_internal(doc, finish_request_id=key, finish_destination=dest.name if dest else None)
		record_activity(doc, "batch_finished", {"carry": carry})
	return _finish_result(doc)
