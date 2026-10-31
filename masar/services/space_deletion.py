"""Deleting a Space with everything in it (client decision 2026-10-31).

This replaces the earlier rule "Spaces are retired with `status`, never cascaded" (docs/02 §8).
Only the Space owner or a Masar administrator may delete, and the caller must type the Space title.
Everything runs in the request transaction: a failure rolls back every row. Frappe File records are
deleted through Frappe, as Task deletion already does, so their bytes are removed too.
"""

import frappe
from frappe import _

from masar.masar.doctype.masar_task.masar_task import cascade_task_deletion
from masar.permissions import clear_membership_cache, is_space_admin, require_space_view
from masar.utils.context import masar_service

# Records with a `space` link that remain once the Space's Tasks and their records are gone.
# Batches span Spaces and stay; their rows for this Space (history included) go.
SPACE_RECORDS = (
	"Masar Activity",
	"Masar Batch Item",
	"Masar Comment Reaction",
	"Masar Comment Notification",
	"Masar Notification",
	"Masar Comment",
	"Masar My Day",
	"Masar Task Action",
	"Masar Timer Session",
	"Masar Time Entry",
	"Masar Feature",
	"Masar Release",
	"Masar Label",
)


def delete_space(space_name: str, confirm_title: str | None) -> dict:
	require_space_view(space_name)  # 404 for non-members who are not administrators
	doc = frappe.get_doc("Masar Space", space_name, for_update=True)
	if not (is_space_admin() or doc.space_owner == frappe.session.user):
		frappe.throw(
			_("Only the Space owner or a Masar administrator can delete this Space."), frappe.PermissionError
		)
	if " ".join((confirm_title or "").split()) != " ".join(doc.title.split()):
		frappe.throw(_("Type the Space title exactly to confirm the deletion."))
	tasks = frappe.get_all("Masar Task", filters={"space": space_name}, pluck="name")
	with masar_service():
		cascade_task_deletion(tasks)
		frappe.db.delete("Masar Task", {"space": space_name})
		_delete_attachments(space_name)
		for doctype in SPACE_RECORDS:
			frappe.db.delete(doctype, {"space": space_name})
		# Authorised above: Space owners are not Desk administrators, so Frappe's role check is skipped.
		# The controller still removes the Space files and members.
		frappe.delete_doc("Masar Space", space_name, ignore_permissions=True)
	clear_membership_cache()
	return {"name": space_name, "deleted": True, "tasksDeleted": len(tasks)}


def _delete_attachments(space_name: str) -> None:
	"""Attachments left after the Task cascade (none are expected), with their Frappe Files."""
	for file in frappe.get_all("Masar Attachment", filters={"space": space_name}, pluck="file"):
		if file and frappe.db.exists("File", file):
			frappe.delete_doc("File", file, ignore_permissions=True, force=True)
	frappe.db.delete("Masar Attachment", {"space": space_name})
