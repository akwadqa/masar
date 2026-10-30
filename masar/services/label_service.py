"""Space-scoped shared labels (ADR-006, ADR-030)."""

import frappe
from frappe import _

from masar.masar.doctype.masar_label.masar_label import label_key
from masar.permissions import (
	MANAGER,
	get_space_role,
	not_found,
	require_masar_user,
	require_space_access,
	require_task_write,
)
from masar.utils.context import concurrent_duplicate, masar_service

COLORS = ("neutral", "primary", "secondary", "success", "info", "warning", "error")


def _row(label) -> dict:
	return {"name": label.name, "space": label.space, "title": label.label_name, "color": label.color}


def list_labels(space: str) -> list[dict]:
	require_space_access(space)
	rows = frappe.get_list(
		"Masar Label",
		filters={"space": space},
		fields=["name", "space", "label_name", "color"],
		order_by="label_name asc",
		limit_page_length=0,
	)
	return [_row(r) for r in rows]


def create(space: str, title: str, color: str = "neutral") -> dict:
	"""Create a label, or return the existing one with the same normalised name (idempotent)."""
	role = require_space_access(space)
	require_task_write(space, role)
	if color not in COLORS:
		frappe.throw(_("Unknown label colour."))
	key = label_key(title)
	existing = frappe.db.get_value("Masar Label", {"space": space, "label_key": key}, "name")
	if existing:
		return {"label": _row(frappe.get_doc("Masar Label", existing)), "created": False}
	doc = frappe.get_doc({"doctype": "Masar Label", "space": space, "label_name": title, "color": color})
	frappe.db.savepoint("masar_label_create")
	try:
		with masar_service():
			doc.insert()
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		# A concurrent request created the same label first.
		frappe.db.rollback(save_point="masar_label_create")
		existing = frappe.db.get_value("Masar Label", {"space": space, "label_key": key}, "name")
		if not existing:
			concurrent_duplicate()
		return {"label": _row(frappe.get_doc("Masar Label", existing)), "created": False}
	return {"label": _row(doc), "created": True}


def _managed_label(label_name: str):
	require_masar_user()
	space = frappe.db.get_value("Masar Label", label_name, "space")
	role = get_space_role(space) if space else None
	if role is None:
		not_found("Label")
	if role != MANAGER:
		frappe.throw(_("Only Space Managers can rename, recolour or delete labels."), frappe.PermissionError)
	require_task_write(space, role)
	return frappe.get_doc("Masar Label", label_name, for_update=True)


def update(label_name: str, title: str | None = None, color: str | None = None) -> dict:
	doc = _managed_label(label_name)
	if title is not None:
		doc.label_name = title
	if color is not None:
		if color not in COLORS:
			frappe.throw(_("Unknown label colour."))
		doc.color = color
	with masar_service():
		doc.save()
	return _row(doc)


def delete(label_name: str) -> dict:
	"""Deleting a shared label removes it from every Task of the Space in the same transaction."""
	doc = _managed_label(label_name)
	parents = frappe.get_all("Masar Task Label", filters={"label": doc.name}, pluck="parent")  # after auth
	with masar_service():
		for task_name in sorted(set(parents)):
			task = frappe.get_doc("Masar Task", task_name, for_update=True)
			task.set("labels", [row for row in task.labels if row.label != doc.name])
			task.save()
		frappe.delete_doc("Masar Label", doc.name)
	return {"name": label_name, "deleted": True, "tasksUpdated": len(set(parents))}
