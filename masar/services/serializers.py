"""Response shapes shared by the API (mirrored in frontend/app/types/api.ts)."""

from zoneinfo import ZoneInfo

import frappe
from frappe.utils import get_datetime, get_system_timezone


def iso_datetime(value) -> str | None:
	"""Frappe stores naive datetimes in the site timezone; emit them with an explicit offset so
	browsers in any timezone render the correct instant."""
	if not value:
		return None
	moment = get_datetime(value)
	if moment.tzinfo is None:
		moment = moment.replace(tzinfo=ZoneInfo(get_system_timezone()))
	return moment.isoformat()


def iso_date(value) -> str | None:
	return str(value) if value else None


def user_refs(users: list[str]) -> dict[str, dict]:
	"""Resolve users to {name, fullName, image} with one query."""
	users = sorted({u for u in users if u})
	if not users:
		return {}
	user = frappe.qb.DocType("User")
	rows = (
		frappe.qb.from_(user)
		.select(user.name, user.full_name, user.user_image)
		.where(user.name.isin(users))
		.run()
	)
	refs = {
		name: {"name": name, "fullName": full_name or name, "image": image} for name, full_name, image in rows
	}
	for name in users:
		refs.setdefault(name, {"name": name, "fullName": name, "image": None})
	return refs


def task_row(task: dict, assignees: list[str], refs: dict[str, dict]) -> dict:
	return {
		"name": task["name"],
		"title": task["title"],
		"space": task["space"],
		"priority": task["priority"],
		"dueDate": iso_date(task.get("due_date")),
		"status": task.get("status") or "Open",
		"isCompleted": bool(task.get("is_completed")),
		"isImportant": bool(task.get("is_important")),
		# Personal: the caller fills it from Masar My Day for the session user.
		"isMyDay": False,
		"assignees": [refs[u] for u in assignees if u in refs],
		"taskOwner": task.get("task_owner"),
		# The owner may be outside the assignees (Tasks imported from ERPNext keep their creator).
		"taskOwnerRef": refs.get(task.get("task_owner")) if task.get("task_owner") else None,
		"actionCount": task.get("action_count") or 0,
		"actionDoneCount": task.get("action_done_count") or 0,
		"commentCount": task.get("comment_count") or 0,
		"sortOrder": float(task.get("sort_order") or 0),
		"modified": iso_datetime(task.get("modified")),
		"clientRequestId": task.get("client_request_id"),
	}
