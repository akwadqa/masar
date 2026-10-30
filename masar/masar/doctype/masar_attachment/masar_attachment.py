from frappe.model.document import Document


class MasarAttachment(Document):
	"""A private Task file (ADR-054). Storage is the Frappe File; the Task is the security boundary."""


def on_doctype_update():
	import frappe

	frappe.db.add_index("Masar Attachment", ["task", "creation"])
	frappe.db.add_index("Masar Attachment", ["comment"])
