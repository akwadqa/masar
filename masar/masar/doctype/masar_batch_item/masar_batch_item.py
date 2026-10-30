import frappe
from frappe import _
from frappe.model.document import Document


class MasarBatchItem(Document):
	"""Participation of one Task in one Batch (ADR-044). Written only by batch_service."""

	def validate(self):
		before = self.get_doc_before_save()
		if before and frappe.db.get_value("Masar Batch", self.batch, "status") == "Finished":
			frappe.throw(_("Participation records of a finished Sprint cannot be changed."))
		if self.task and not before:
			space = frappe.db.get_value("Masar Task", self.task, "space")
			if space != self.space:
				frappe.throw(_("The participation record must use the Task's own Space."))
		if self.current_task and self.current_task != self.task:
			frappe.throw(_("Inconsistent current Sprint reference."))


def on_doctype_update():
	frappe.db.add_index("Masar Batch Item", ["batch", "space", "current_task"])
	frappe.db.add_index("Masar Batch Item", ["space", "batch"])
	frappe.db.add_index("Masar Batch Item", ["task", "batch"])
