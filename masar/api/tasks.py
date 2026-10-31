import builtins

import frappe
from frappe.utils import sbool

from masar.services import task_service
from masar.services.personal import my_day_service
from masar.utils.context import masar_write

OPERATOR_FILTERS = ("statuses", "owners", "assignees", "priority", "label")


def _list(value) -> list[str] | None:
	"""A JSON array or a comma-separated query value."""
	if not value:
		return None
	if isinstance(value, str) and not value.startswith("["):
		return [v for v in value.split(",") if v]
	parsed = frappe.parse_json(value)
	# `list` is this module's endpoint below, so the built-in type is reached through builtins.
	return [v for v in parsed if isinstance(v, str)] if isinstance(parsed, builtins.list) else None


def _filters(kwargs) -> dict:
	"""Shared query-string filters for Task lists (all applied server-side)."""
	return {
		"assigned_to_me": sbool(kwargs.get("assigned_to_me")),
		"owned_by_me": sbool(kwargs.get("owned_by_me")),
		"completed": kwargs.get("completed") or "all",
		"important": sbool(kwargs.get("important")),
		"my_day": sbool(kwargs.get("my_day")),
		"statuses": _list(kwargs.get("statuses")),
		"owners": _list(kwargs.get("owners")),
		"assignees": _list(kwargs.get("assignees")),
		"priority": _list(kwargs.get("priority")),
		"due": kwargs.get("due") or None,
		# Labels of one Space, or several of the same name from different Spaces (All Tasks).
		"label": _list(kwargs.get("label")),
		# Filter chip operators (is / not / empty / set), validated per field by the service.
		**{f"{key}_op": kwargs.get(f"{key}_op") or None for key in OPERATOR_FILTERS},
		"feature": kwargs.get("feature") or None,
		"release": kwargs.get("release") or None,
		"batch": kwargs.get("batch") or None,
		"q": kwargs.get("q") or None,
		"cursor": kwargs.get("cursor") or None,
		"limit": kwargs.get("limit") or 200,
	}


@frappe.whitelist(methods=["GET"])
def list(space: str, sort: str = "manual", **kwargs):
	return task_service.list_tasks(space, sort=sort, **_filters(kwargs))


@frappe.whitelist(methods=["GET"])
def my_work(space: str | None = None, sort: str = "recently_updated", spaces=None, **kwargs):
	spaces_filter = frappe.parse_json(spaces) if spaces else None
	return task_service.my_work(space or None, spaces_filter=spaces_filter or None, sort=sort, **_filters(kwargs))


@frappe.whitelist(methods=["GET"])
def owners(space: str | None = None, spaces=None):
	return task_service.owners(space or None, frappe.parse_json(spaces) if spaces else None)


@frappe.whitelist(methods=["GET"])
def assignees(space: str | None = None, spaces=None):
	return task_service.assignees(space or None, frappe.parse_json(spaces) if spaces else None)


@frappe.whitelist(methods=["GET"])
def search(q: str = "", limit: int = 20):
	return task_service.search(q, limit)


@frappe.whitelist(methods=["GET"])
def lookup(names):
	return task_service.lookup(frappe.parse_json(names) if isinstance(names, str) else names)


@frappe.whitelist(methods=["GET"])
def get(task: str):
	return task_service.get_detail(task)


@frappe.whitelist(methods=["POST"])
@masar_write
def create(space: str, title: str, client_request_id: str):
	return task_service.create(space, title, client_request_id)


@frappe.whitelist(methods=["POST"])
@masar_write
def update(task: str, changes, base=None):
	return task_service.update(task, frappe.parse_json(changes), frappe.parse_json(base) if base else None)


@frappe.whitelist(methods=["POST"])
@masar_write
def set_my_day(task: str, value):
	"""Adds the Task to, or removes it from, the session user's own My Day."""
	my_day_service.set_my_day(task, sbool(value))
	return task_service.get_detail(task)


@frappe.whitelist(methods=["POST"])
@masar_write
def set_completed(task: str, completed):
	return task_service.set_completed(task, sbool(completed))


@frappe.whitelist(methods=["POST"])
@masar_write
def add_assignee(task: str, user: str):
	return task_service.add_assignee(task, user)


@frappe.whitelist(methods=["POST"])
@masar_write
def remove_assignee(task: str, user: str):
	return task_service.remove_assignee(task, user)


@frappe.whitelist(methods=["POST"])
@masar_write
def set_owner(task: str, user: str):
	return task_service.set_owner(task, user)


@frappe.whitelist(methods=["POST"])
@masar_write
def delete(task: str):
	return task_service.delete(task)


@frappe.whitelist(methods=["POST"])
@masar_write
def add_label(task: str, label: str):
	return task_service.add_label(task, label)


@frappe.whitelist(methods=["POST"])
@masar_write
def remove_label(task: str, label: str):
	return task_service.remove_label(task, label)


@frappe.whitelist(methods=["POST"])
@masar_write
def bulk_update(tasks, operation: str, value=None, expected=None):
	return task_service.bulk_update(
		frappe.parse_json(tasks), operation, value, frappe.parse_json(expected) if expected else None
	)
