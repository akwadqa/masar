from frappe.model.document import Document


class MasarComment(Document):
	"""A Task comment (ADR-051). Written only by comment_service, which authorises and sanitises."""


def on_doctype_update():
	import frappe

	frappe.db.add_index("Masar Comment", ["task", "creation"])
	frappe.db.add_unique(
		"Masar Comment", ["owner", "client_request_id"], constraint_name="unique_comment_owner_request"
	)
