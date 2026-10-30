import frappe
from frappe import _
from frappe.model.document import Document


class MasarActivity(Document):
	"""Append-only history entry written by Masar services and controllers."""

	def validate(self):
		if not self.is_new():
			frappe.throw(_("Activity entries cannot be modified."))


def on_doctype_update():
	frappe.db.add_index("Masar Activity", ["reference_doctype", "reference_name", "creation"])
