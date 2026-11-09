"""Realtime events for the Workspace (ADR-017; specs/realtime.md; client decision 2026-11-09).

This is the only module that calls `frappe.publish_realtime`, so every room and payload rule lives here:
- Events go to the personal rooms (`user:<email>`) of the people allowed to see the change, or to the
  document room of one Task (`doc:Masar Task/<name>`), which the Workspace joins with Frappe's
  `doc_subscribe`; Frappe admits a browser there only if Masar's has_permission hook allows reading that
  Task. Frappe's DocType rooms and its automatic `list_update` are never used for Masar data: joining a
  DocType room checks DocType-level read only, which would tell every Masar User about every Space.
- Payloads carry ids only. The Workspace refetches through the permission-checked API, so a person who
  lost access between the change and the refetch learns nothing.
- Changes are collected per transaction and published once per target after commit. A rollback (also
  `masar_write` retrying a deadlock) drops them, so nothing is announced that did not happen. Recipients
  are computed after commit, from membership as it then stands.
The module name avoids `masar/realtime/`, the folder Frappe's socket server searches for app handlers.
"""

import frappe
from frappe.realtime import get_doc_room, get_user_room

SPACE_CHANGED = "masar_space_changed"
BATCH_CHANGED = "masar_batch_changed"
NOTIFICATION = "masar_notification"
TIMELINE = "masar_timeline"
TYPING = "masar_typing"
EDITING = "masar_editing"
TASK = "Masar Task"


def space_changed(space: str | None):
	"""Something in this Space changed: its members refresh what they show of it."""
	if space:
		_pending()["spaces"].add(space)


def batch_changed(batch: str | None):
	"""The Batch itself changed (name, dates, status, owner): everyone who can see it refreshes it."""
	if batch:
		_pending()["batches"].add(batch)


def task_changed(task: str | None):
	"""The Task, its comments, reactions, files, time or history changed: its open viewers refresh it."""
	if task:
		_pending()["tasks"].add(task)


def task_activity(task: str, event: str, data: dict | None = None):
	"""Someone is typing or editing in an open Task (phase 5). Nothing is written, so there is no commit to
	wait for: the event goes out at once to the Task's room, naming the person by id."""
	_emit(event, {"task": task, "user": frappe.session.user, **(data or {})}, get_doc_room(TASK, task))


def users_notified(users):
	"""These people have new notifications: their bell refreshes and shows a toast."""
	_pending()["users"].update(user for user in users if user)


def _pending() -> dict:
	state = getattr(frappe.local, "masar_realtime", None)
	if state is None:
		state = frappe.local.masar_realtime = {
			"spaces": set(),
			"batches": set(),
			"tasks": set(),
			"users": set(),
		}
		frappe.db.after_commit.add(_flush)
		frappe.db.after_rollback.add(_forget)
	return state


def _forget():
	frappe.local.masar_realtime = None


def _flush():
	state = getattr(frappe.local, "masar_realtime", None)
	frappe.local.masar_realtime = None
	if not state:
		return
	for space in sorted(state["spaces"]):
		_publish(SPACE_CHANGED, {"space": space}, _space_members(space))
	for batch in sorted(state["batches"]):
		_publish(BATCH_CHANGED, {"batch": batch}, batch_viewers(batch))
	for task in sorted(state["tasks"]):
		_emit(TIMELINE, {"task": task}, get_doc_room(TASK, task))
	_publish(NOTIFICATION, {}, state["users"])


def _publish(event: str, message: dict, users):
	for user in sorted(users):
		_emit(event, message, get_user_room(user))


def _emit(event: str, message: dict, room: str):
	# The room is always explicit: inside a background job Frappe would otherwise send a user or document
	# event to the job's progress room. Already after commit (or nothing to commit): publish at once.
	frappe.publish_realtime(event, message, room=room)


def _space_members(space: str) -> set[str]:
	from masar.services.comment_service import space_members  # comment_service imports activity → here

	return space_members(space)


def batch_viewers(batch: str) -> set[str]:
	"""The owner and the members of every Space that has, or had, Tasks in the Batch: the people
	`permissions.batch_visible` lets see it."""
	owner = frappe.db.get_value("Masar Batch", batch, "batch_owner")
	spaces = frappe.get_all("Masar Batch Item", filters={"batch": batch}, pluck="space", distinct=True)
	viewers = {owner} if owner else set()
	for space in spaces:
		viewers |= _space_members(space)
	return viewers
