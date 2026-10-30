import frappe
from frappe import _
from frappe.model.document import Document

LABEL_MAX_LENGTH = 60
# Built-in shared attributes are Task fields (ADR-006); labels must not imitate them.
RESERVED_KEYS = {"important", "my day", "myday"}


def normalise_label_name(value: str | None) -> str:
	return " ".join((value or "").split())


def label_key(value: str | None) -> str:
	return normalise_label_name(value).casefold()


class MasarLabel(Document):
	def validate(self):
		self.label_name = normalise_label_name(self.label_name)
		if not self.label_name:
			frappe.throw(_("A label needs a name."))
		if len(self.label_name) > LABEL_MAX_LENGTH:
			frappe.throw(_("Label names are limited to {0} characters.").format(LABEL_MAX_LENGTH))
		self.label_key = label_key(self.label_name)
		if self.label_key in RESERVED_KEYS:
			frappe.throw(
				_("{0} is a built-in attribute. Use the star or sun toggle instead.").format(self.label_name)
			)
		duplicate = frappe.db.get_value(
			"Masar Label",
			{"space": self.space, "label_key": self.label_key, "name": ["!=", self.name]},
			"name",
		)
		if duplicate:
			frappe.throw(
				_("A label named {0} already exists in this Space.").format(self.label_name),
				frappe.DuplicateEntryError,
			)


def on_doctype_update():
	# Durable guard against concurrent duplicates (case/whitespace-insensitive per Space).
	frappe.db.add_unique("Masar Label", ["space", "label_key"], constraint_name="unique_space_label_key")
