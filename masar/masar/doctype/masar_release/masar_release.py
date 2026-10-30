import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils.html_utils import sanitize_html

STATUSES = ("Planned", "Released", "Archived")


def normalise_release_name(value: str | None) -> str:
	return " ".join((value or "").split())


def release_key(value: str | None) -> str:
	return normalise_release_name(value).casefold()


class MasarRelease(Document):
	def validate(self):
		self.release_name = normalise_release_name(self.release_name)
		if not self.release_name:
			frappe.throw(_("A Release needs a name or version."))
		if len(self.release_name) > 80:
			frappe.throw(_("Release names are limited to 80 characters."))
		if self.status not in STATUSES:
			frappe.throw(_("Unknown Release status."))
		self.release_key = release_key(self.release_name)
		duplicate = frappe.db.get_value(
			"Masar Release",
			{"space": self.space, "release_key": self.release_key, "name": ["!=", self.name]},
			"name",
		)
		if duplicate:
			frappe.throw(
				_("A Release named {0} already exists in this Space.").format(self.release_name),
				frappe.DuplicateEntryError,
			)
		if self.notes:
			self.notes = sanitize_html(self.notes, always_sanitize=True)

	def on_trash(self):
		if frappe.db.exists("Masar Task", {"target_release": self.name}):
			frappe.throw(_("This Release still has tasks. Archive it instead of deleting it."))


def on_doctype_update():
	frappe.db.add_unique(
		"Masar Release", ["space", "release_key"], constraint_name="unique_space_release_key"
	)
