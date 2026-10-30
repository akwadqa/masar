"""My Day (client revision 4): each person picks their own Tasks for today. A row in Masar My Day
belongs to one person; nobody else sees it, and it never changes the Task or its history. Finished
Tasks leave every My Day automatically."""

import frappe
from frappe import _

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
