"""My Day (client revision 4): each person picks their own Tasks for today. A row in Masar My Day
belongs to one person; nobody else sees it, and it never changes the Task or its history. Finished
Tasks leave every My Day automatically.

My Day lasts one day (owner decision of 2026-10-31): `start_new_day` clears every My Day shortly after
midnight (Asia/Qatar) and adds the unfinished Tasks due today. A Task that becomes due today during the
day joins the My Day of its people at once. "Its people" are the assignees, or the owner when nobody is
assigned; only current Space members qualify."""

import frappe
from frappe import _
from frappe.utils import getdate, nowdate

from masar.permissions import require_task_access
from masar.utils.context import masar_service


def my_day_tasks(task_names: list[str], user: str | None = None) -> set[str]:
	"""Which of these Tasks are in the person's My Day (one query)."""
	if not task_names:
		return set()
	row = frappe.qb.DocType("Masar My Day")
	return {
		name
		for (name,) in frappe.qb.from_(row)
		.select(row.task)
		.where((row.user == (user or frappe.session.user)) & row.task.isin(task_names))
		.run()
	}


def my_day_subquery(user: str | None = None):
	row = frappe.qb.DocType("Masar My Day")
	return frappe.qb.from_(row).select(row.task).where(row.user == (user or frappe.session.user))


def set_my_day(task_name: str, value: bool) -> None:
	"""Reading a Task is enough: My Day is personal and changes nothing on the Task."""
	doc = require_task_access(task_name)
	user = frappe.session.user
	existing = frappe.db.get_value("Masar My Day", {"user": user, "task": doc.name})
	if value and not existing:
		if doc.is_completed:
			frappe.throw(_("Finished tasks cannot be added to My Day."))
		frappe.db.savepoint("masar_my_day")
		try:
			with masar_service():
				frappe.get_doc({"doctype": "Masar My Day", "user": user, "task": doc.name}).insert(
					ignore_permissions=True
				)
		except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
			# A concurrent request added it first: the result is the same.
			frappe.db.rollback(save_point="masar_my_day")
	elif not value and existing:
		frappe.db.delete("Masar My Day", {"name": existing})


def clear_task(task_name: str) -> None:
	"""Removes the Task from everyone's My Day (finished or deleted Task)."""
	frappe.db.delete("Masar My Day", {"task": task_name})


def is_due_today(task) -> bool:
	return bool(task.get("due_date")) and not task.get("is_completed") and getdate(task.due_date) == getdate(nowdate())


def due_task_people(task, assignees: list[str]) -> list[str]:
	"""Whose My Day a Task due today joins: its assignees, or its owner when nobody is assigned."""
	return assignees or ([task.task_owner] if task.get("task_owner") else [])


def add_to_my_day(task, users) -> None:
	"""Add a Task to these people's My Day, skipping people who are not current, enabled members of its
	Space and rows that already exist. System-made: no history entry, no notification."""
	users = set(users) - {None, ""}
	if not users:
		return
	member = frappe.qb.DocType("Masar Space Member")
	account = frappe.qb.DocType("User")
	members = {
		u
		for (u,) in frappe.qb.from_(member)
		.join(account)
		.on(account.name == member.user)
		.select(member.user)
		.where(
			(member.parent == task.space)
			& (member.parenttype == "Masar Space")
			& (account.enabled == 1)
			& member.user.isin(list(users))
		)
		.run()
	}
	present = set(my_day_users(task.name))
	for user in sorted(members - present):
		frappe.db.savepoint("masar_my_day_auto")
		try:
			with masar_service():
				frappe.get_doc({"doctype": "Masar My Day", "user": user, "task": task.name}).insert(
					ignore_permissions=True
				)
		except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
			frappe.db.rollback(save_point="masar_my_day_auto")


def my_day_users(task_name: str) -> list[str]:
	return frappe.get_all("Masar My Day", filters={"task": task_name}, pluck="user")


def start_new_day() -> int:
	"""Daily (Asia/Qatar, cron in hooks.py): yesterday's My Day ends, and each person's new My Day starts
	with the unfinished Tasks due today. Returns the number of Tasks added; the scheduler commits."""
	frappe.db.delete("Masar My Day")
	tasks = frappe.get_all(
		"Masar Task",
		filters={"due_date": getdate(nowdate()), "is_completed": 0},
		fields=["name", "space", "task_owner"],
	)
	assignees: dict[str, list[str]] = {}
	for row in frappe.get_all(
		"Masar Task Assignee",
		filters={"parenttype": "Masar Task", "parent": ["in", [t.name for t in tasks] or [""]]},
		fields=["parent", "user"],
		order_by="idx asc",
	):
		assignees.setdefault(row.parent, []).append(row.user)
	for task in tasks:
		add_to_my_day(task, due_task_people(task, assignees.get(task.name, [])))
	return len(tasks)
