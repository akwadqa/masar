import frappe
from frappe import _
from frappe.model.document import Document


class MasarMyDay(Document):
	"""A Task one person added to their own My Day (client revision 4). Written only by
	my_day_service; one row per person and Task, enforced by a unique index."""

	def validate(self):
		self.space = frappe.db.get_value("Masar Task", self.task, "space")
		if not self.space:
			frappe.throw(_("Task not found."))


def on_doctype_update():
	frappe.db.add_unique("Masar My Day", ["user", "task"], constraint_name="unique_user_task")
	frappe.db.add_index("Masar My Day", ["task"])
