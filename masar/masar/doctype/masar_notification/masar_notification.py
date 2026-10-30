import frappe
from frappe.model.document import Document


class MasarNotification(Document):
	"""One entry of a person's notification list (client revision 5). Written only by
	inbox_service; read only by its recipient (permissions.inbox_has_permission)."""


def on_doctype_update():
	frappe.db.add_index("Masar Notification", ["recipient", "is_read", "creation"])
	frappe.db.add_index("Masar Notification", ["task"])
