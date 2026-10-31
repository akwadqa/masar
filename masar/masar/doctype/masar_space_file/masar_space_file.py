from frappe.model.document import Document


class MasarSpaceFile(Document):
	"""A private Space file. Storage is the Frappe File attached to the Masar Space; written only by
	space_file_service, which authorises (Managers add and remove, members read)."""


def on_doctype_update():
	import frappe

	frappe.db.add_index("Masar Space File", ["space", "creation"])
