"""Realtime events for the Workspace (ADR-017; specs/realtime.md; client decision 2026-11-09).

This is the only module that calls `frappe.publish_realtime`, so every room and payload rule lives here:
- Events go to the personal rooms (`user:<email>`) of the people allowed to see the change. Frappe's
  DocType rooms and its automatic `list_update` are never used for Masar data: joining a DocType room
  checks DocType-level read only, which would tell every Masar User about every Space.
- Payloads carry ids only. The Workspace refetches through the permission-checked API, so a person who
  lost access between the change and the refetch learns nothing.
- Changes are collected per transaction and published once per target after commit. A rollback (also
  `masar_write` retrying a deadlock) drops them, so nothing is announced that did not happen. Recipients
  are computed after commit, from membership as it then stands.
The module name avoids `masar/realtime/`, the folder Frappe's socket server searches for app handlers.
"""

import frappe

SPACE_CHANGED = "masar_space_changed"
BATCH_CHANGED = "masar_batch_changed"
NOTIFICATION = "masar_notification"


def space_changed(space: str | None):
	"""Something in this Space changed: its members refresh what they show of it."""
	if space:
		_pending()["spaces"].add(space)


def batch_changed(batch: str | None):
	"""The Batch itself changed (name, dates, status, owner): everyone who can see it refreshes it."""
	if batch:
		_pending()["batches"].add(batch)


def users_notified(users):
	"""These people have new notifications: their bell refreshes and shows a toast."""
	_pending()["users"].update(user for user in users if user)


def _pending() -> dict:
	state = getattr(frappe.local, "masar_realtime", None)
	if state is None:
		state = frappe.local.masar_realtime = {"spaces": set(), "batches": set(), "users": set()}
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
	_publish(NOTIFICATION, {}, state["users"])


def _publish(event: str, message: dict, users):
	# Already after commit: publish at once (after_commit=True here would wait for the next commit).
	for user in sorted(users):
		frappe.publish_realtime(event, message, user=user)


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
