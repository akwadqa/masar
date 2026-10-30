from frappe.model.document import Document


class MasarCommentNotification(Document):
	"""Per-recipient notification state: Queued → Sent / Failed, or Skipped (ADR-056)."""


def on_doctype_update():
	import frappe

	frappe.db.add_unique(
		"Masar Comment Notification", ["comment", "recipient"], constraint_name="unique_comment_notification"
	)
