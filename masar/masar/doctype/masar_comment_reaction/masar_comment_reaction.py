from frappe.model.document import Document


class MasarCommentReaction(Document):
	"""One reaction per user, comment and emoji (ADR-053)."""


def on_doctype_update():
	import frappe

	frappe.db.add_unique(
		"Masar Comment Reaction", ["comment", "user", "emoji"], constraint_name="unique_comment_reaction"
	)
	frappe.db.add_index("Masar Comment Reaction", ["task", "comment"])
