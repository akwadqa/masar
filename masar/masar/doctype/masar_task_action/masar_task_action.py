import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime

ACTION_MAX_LENGTH = 240


class MasarTaskAction(Document):
	def before_insert(self):
		if not self.client_request_id:
			self.client_request_id = f"server:{frappe.generate_hash(length=20)}"

	def validate(self):
		self.title = " ".join((self.title or "").split())
		if not self.title:
			frappe.throw(_("An Action needs some text."))
		if len(self.title) > ACTION_MAX_LENGTH:
			frappe.throw(_("Actions are limited to {0} characters.").format(ACTION_MAX_LENGTH))
		# Space is derived from the parent Task and drives permissions.
		self.space = frappe.db.get_value("Masar Task", self.task, "space")
		if not self.space:
			frappe.throw(_("The parent task does not exist."))
		before = self.get_doc_before_save()
		if before and before.promoted_task and (before.title != self.title or before.is_done != self.is_done):
			frappe.throw(_("A promoted Action can no longer be edited. Update the promoted task instead."))
		was_done = bool(before.is_done) if before else False
		if self.is_done and not was_done:
			self.done_at = now_datetime()
			self.done_by = frappe.session.user
		elif not self.is_done:
			self.done_at = None
			self.done_by = None


def on_doctype_update():
	frappe.db.add_index("Masar Task Action", ["task", "sort_order"])
	frappe.db.add_unique(
		"Masar Task Action", ["owner", "client_request_id"], constraint_name="unique_action_client_request"
	)
