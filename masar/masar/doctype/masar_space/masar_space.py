import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime
from frappe.utils.html_utils import sanitize_html

from masar.permissions import MANAGER, clear_membership_cache


class MasarSpace(Document):
	def validate(self):
		self.title = (self.title or "").strip()
		if not self.title:
			frappe.throw(_("Title is required."))
		self._validate_gameplan_url()
		if self.details:
			self.details = sanitize_html(self.details, always_sanitize=True)
		self._validate_members()

	def _validate_gameplan_url(self):
		url = (self.gameplan_url or "").strip()
		self.gameplan_url = url or None
		if url and not url.startswith("https://"):
			frappe.throw(_("The Gameplan link must be an https:// URL."))

	def _validate_members(self):
		if not self.members:
			frappe.throw(_("A Space needs at least one member."))

		seen = set()
		for row in self.members:
			if row.user in seen:
				frappe.throw(_("{0} is listed more than once.").format(row.user))
			seen.add(row.user)
			if not row.added_at:
				row.added_at = now_datetime()
			if not frappe.db.get_value("User", row.user, "enabled"):
				frappe.throw(_("{0} is not an active user.").format(row.user))
			if not {"Masar User", "Masar Admin"}.intersection(frappe.get_roles(row.user)):
				frappe.throw(_("{0} does not have the Masar User role.").format(row.user))

		if not any(row.role == MANAGER for row in self.members):
			frappe.throw(_("A Space needs at least one Manager."))

		owner_row = next((row for row in self.members if row.user == self.space_owner), None)
		if not owner_row or owner_row.role != MANAGER:
			frappe.throw(_("The Space owner must be a Manager of the Space."))

	def on_update(self):
		clear_membership_cache()

	def on_trash(self):
		if frappe.db.exists("Masar Task", {"space": self.name}):
			frappe.throw(_("This Space still contains tasks. Change its status instead of deleting it."))
		clear_membership_cache()
