import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate

STATUSES = ("Planned", "Active", "Finished")


class MasarBatch(Document):
	def validate(self):
		self.batch_name = " ".join((self.batch_name or "").split())
		if not self.batch_name:
			frappe.throw(_("A Batch needs a name."))
		if len(self.batch_name) > 140:
			frappe.throw(_("Batch names are limited to 140 characters."))
		if self.status not in STATUSES:
			frappe.throw(_("Unknown Batch status."))
		if getdate(self.end_date) < getdate(self.start_date):
			frappe.throw(_("The end date cannot be before the start date."))
		before = self.get_doc_before_save()
		if before and before.status == "Finished":
			frappe.throw(_("A finished Batch is a historical record and cannot be changed."))

	def on_trash(self):
		if self.status != "Planned" or frappe.db.exists("Masar Batch Item", {"batch": self.name}):
			frappe.throw(_("Only an empty, planned Batch can be deleted."))


def on_doctype_update():
	frappe.db.add_unique(
		"Masar Batch", ["owner", "client_request_id"], constraint_name="unique_batch_owner_request"
	)
	frappe.db.add_index("Masar Batch", ["status", "start_date"])
