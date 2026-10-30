import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils.html_utils import sanitize_html

ROADMAP = ("Now", "Next", "Later", "Done")


class MasarFeature(Document):
	def validate(self):
		self.title = " ".join((self.title or "").split())
		if not self.title:
			frappe.throw(_("A Feature needs a title."))
		if len(self.title) > 240:
			frappe.throw(_("Feature titles are limited to 240 characters."))
		if self.roadmap not in ROADMAP:
			frappe.throw(_("Roadmap must be one of Now, Next, Later or Done."))
		if self.description:
			self.description = sanitize_html(self.description, always_sanitize=True)

	def on_trash(self):
		if frappe.db.exists("Masar Task", {"feature": self.name}):
			frappe.throw(_("This Feature still has tasks. Remove them from the Feature before deleting it."))


def on_doctype_update():
	frappe.db.add_index("Masar Feature", ["space", "roadmap", "sort_order"])
	frappe.db.add_unique(
		"Masar Feature", ["owner", "client_request_id"], constraint_name="unique_feature_owner_request"
	)
