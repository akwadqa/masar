"""Task Actions (ADR-004, ADR-029): lightweight checklist items under a Task.

Every operation authorises through the parent Task (Space membership + lifecycle) and keeps the
Task's cached action counters consistent inside the same transaction."""

import frappe
from frappe import _
from frappe.query_builder import Order
from frappe.query_builder.functions import Count, Sum
from frappe.utils import now_datetime

from masar.exceptions import MasarConflictError
from masar.permissions import (
	MANAGER,
	get_space_role,
	not_found,
	require_masar_user,
	require_task_access,
	require_task_write,
)
from masar.services.activity import record_activity
from masar.services.serializers import iso_datetime, user_refs
from masar.utils.context import concurrent_duplicate, masar_service

SORT_STEP = 1024.0
CLIENT_REQUEST_ID_MAX = 64


def _row(action, refs: dict | None = None) -> dict:
	refs = refs or {}
	return {
		"name": action.name,
		"task": action.task,
		"title": action.title,
		"isDone": bool(action.is_done),
		"doneBy": refs.get(action.done_by) if action.done_by else None,
		"doneAt": iso_datetime(action.done_at),
		"sortOrder": float(action.sort_order or 0),
		"promotedTask": action.promoted_task,
		"promotedAt": iso_datetime(action.promoted_at),
		"createdBy": action.owner,
		"modified": iso_datetime(action.modified),
		"clientRequestId": action.client_request_id,
	}


def _refresh_counters(task_name: str):
	"""Recompute (never increment) the cached counters shown in the Task List."""
	action = frappe.qb.DocType("Masar Task Action")
	total, done = (
		frappe.qb.from_(action)
		.select(Count(action.name), Sum(action.is_done))
		.where(action.task == task_name)
		.run()[0]
	)
	frappe.db.set_value(
		"Masar Task",
		task_name,
		{"action_count": total or 0, "action_done_count": int(done or 0)},
		update_modified=False,
	)


def _writable_parent(task_name: str):
	task = require_task_access(task_name, for_update=True)
	require_task_write(task.space, get_space_role(task.space))
	return task


def _locked_action(action_name: str):
	"""Load an Action the user may read (via its Space) or raise 404, locking the row."""
	require_masar_user()
	space = frappe.db.get_value("Masar Task Action", action_name, "space")
	if not space or get_space_role(space) is None:
		not_found("Action")
	return frappe.get_doc("Masar Task Action", action_name, for_update=True)


def list_actions(task_name: str) -> list[dict]:
	require_task_access(task_name)
	action = frappe.qb.DocType("Masar Task Action")
	rows = (
		frappe.qb.from_(action)
		.select("*")
		.where(action.task == task_name)
		.orderby(action.sort_order, order=Order.asc)
		.orderby(action.creation, order=Order.asc)
		.run(as_dict=True)
	)
	refs = user_refs([r.done_by for r in rows if r.done_by])
	promoted = [r.promoted_task for r in rows if r.promoted_task]
	completed = (
		dict(
			frappe.db.get_all(  # promoted Tasks live in the same Space as their parent (already authorised)
				"Masar Task",
				filters={"name": ["in", promoted]},
				fields=["name", "is_completed"],
				as_list=True,
			)
		)
		if promoted
		else {}
	)
	items = []
	for r in rows:
		item = _row(r, refs)
		item["promotedTaskCompleted"] = bool(completed.get(r.promoted_task)) if r.promoted_task else None
		items.append(item)
	return items


def add(task_name: str, title: str, client_request_id: str | None = None) -> dict:
	"""Idempotent per (user, client_request_id), like inline Task creation (ADR-011)."""
	task = _writable_parent(task_name)
	if client_request_id:
		if len(client_request_id) > CLIENT_REQUEST_ID_MAX:
			frappe.throw(_("Invalid client request id."))
		existing = frappe.db.get_value(
			"Masar Task Action",
			{"owner": frappe.session.user, "client_request_id": client_request_id},
			["name", "task"],
			as_dict=True,
		)
		if existing:
			# Only replay within the authorised parent Task; never return another Task's Action.
			if existing.task != task.name:
				frappe.throw(_("This request id was already used for another task."))
			return {"action": _row(frappe.get_doc("Masar Task Action", existing.name)), "created": False}
	action = frappe.qb.DocType("Masar Task Action")
	last = (
		frappe.qb.from_(action)
		.select(action.sort_order)
		.where(action.task == task.name)
		.orderby(action.sort_order, order=Order.desc)
		.limit(1)
		.run()
	)
	doc = frappe.get_doc(
		{
			"doctype": "Masar Task Action",
			"task": task.name,
			"space": task.space,
			"title": title,
			"client_request_id": client_request_id,
			"sort_order": (float(last[0][0] or 0) if last else 0.0) + SORT_STEP,
		}
	)
	with masar_service():
		doc.insert()
	_refresh_counters(task.name)
	return {"action": _row(doc), "created": True}


def _writable_action(action_name: str):
	doc = _locked_action(action_name)
	require_task_write(doc.space, get_space_role(doc.space))
	return doc


def update(action_name: str, title: str, base_title: str | None = None) -> dict:
	doc = _writable_action(action_name)
	if base_title is not None and " ".join(base_title.split()) != doc.title:
		frappe.local.response["conflicts"] = [{"field": "title", "current": doc.title, "yours": title}]
		frappe.throw(_("This Action was changed by someone else."), MasarConflictError)
	doc.title = title
	with masar_service():
		doc.save()
	return _row(doc)


def set_done(action_name: str, done: bool) -> dict:
	doc = _writable_action(action_name)
	doc.is_done = 1 if done else 0
	with masar_service():
		doc.save()
	_refresh_counters(doc.task)
	return _row(doc, user_refs([doc.done_by]) if doc.done_by else None)


def move(action_name: str, before: str | None = None, after: str | None = None) -> dict:
	"""Reorder by placing the Action between two neighbours (fractional sort order: one row updated)."""
	doc = _writable_action(action_name)

	def order_of(name):
		if not name:
			return None
		row = frappe.db.get_value("Masar Task Action", name, ["task", "sort_order"], as_dict=True)
		if not row or row.task != doc.task:
			frappe.throw(_("Actions can only be reordered within their task."))
		return float(row.sort_order or 0)

	low, high = order_of(after), order_of(before)
	if low is None and high is None:
		return _row(doc)
	if low is None:
		doc.sort_order = high - SORT_STEP
	elif high is None:
		doc.sort_order = low + SORT_STEP
	else:
		doc.sort_order = (low + high) / 2
	with masar_service():
		doc.save()
	return _row(doc)


def delete(action_name: str) -> dict:
	"""The Action's creator or a Space Manager may delete it. A promoted Task stays."""
	doc = _writable_action(action_name)
	if doc.owner != frappe.session.user and get_space_role(doc.space) != MANAGER:
		frappe.throw(
			_("Only the creator of this Action or a Space Manager can delete it."), frappe.PermissionError
		)
	task_name = doc.task
	if doc.promoted_task:
		frappe.db.set_value("Masar Task", doc.promoted_task, "source_action", None, update_modified=False)
	with masar_service():
		frappe.delete_doc("Masar Task Action", doc.name)
	_refresh_counters(task_name)
	return {"name": action_name, "deleted": True}


def promote(action_name: str) -> dict:
	"""Promote an Action to a standalone Task exactly once (ADR-029).

	- The Action row is locked, so concurrent requests serialise; the second sees `promoted_task`.
	- `Masar Task.source_action` is unique: a durable guard even outside the lock.
	- A repeated request (e.g. after a timeout) returns the existing Task with `created: false`.
	- Everything happens in the request transaction: on failure nothing is persisted.
	"""
	from masar.services import task_service

	action = _writable_action(action_name)
	if action.promoted_task and frappe.db.exists("Masar Task", action.promoted_task):
		return {
			"action": _row(action),
			"task": task_service.get_detail(action.promoted_task),
			"created": False,
		}
	parent = frappe.get_doc("Masar Task", action.task, for_update=True)
	new_task = frappe.get_doc(
		{
			"doctype": "Masar Task",
			"space": parent.space,
			"title": action.title,
			"priority": parent.priority,
			# The parent's owner, but no assignees: people assign Tasks themselves (2026-10-31).
			"task_owner": parent.task_owner,
			"source_task": parent.name,
			"source_action": action.name,
			"client_request_id": f"promote:{action.name}"[:CLIENT_REQUEST_ID_MAX],
			"sort_order": task_service._top_sort_order(parent.space),
		}
	)
	frappe.db.savepoint("masar_action_promote")
	try:
		with masar_service():
			new_task.insert()
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		frappe.db.rollback(save_point="masar_action_promote")
		existing = frappe.db.get_value("Masar Task", {"source_action": action.name}, "name")
		if not existing:
			concurrent_duplicate()
		return {"action": _row(action), "task": task_service.get_detail(existing), "created": False}

	action.promoted_task = new_task.name
	action.promoted_at = now_datetime()
	action.promoted_by = frappe.session.user
	with masar_service():
		action.save()
	record_activity(
		parent, "action_promoted", {"action": action.name, "task": new_task.name, "title": action.title}
	)
	record_activity(new_task, "promoted_from_action", {"action": action.name, "task": parent.name})
	return {"action": _row(action), "task": task_service.get_detail(new_task.name), "created": True}
