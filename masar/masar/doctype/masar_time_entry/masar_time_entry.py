import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint

MAX_MINUTES = 24 * 60  # one entry records work on one calendar day (ADR-060)


class MasarTimeEntry(Document):
	"""Work logged on a Task (ADR-060). Written only by time_service; this is the last line of defence."""

	def validate(self):
		minutes = cint(self.minutes)
		if minutes < 1 or minutes > MAX_MINUTES:
			frappe.throw(_("A time entry must be between 1 minute and 24 hours."))
		self.minutes = minutes
		if frappe.db.get_value("Masar Task", self.task, "space") != self.space:
			frappe.throw(_("A time entry must use its Task's Space."))


def on_doctype_update():
	frappe.db.add_index("Masar Time Entry", ["task", "creation"])
	frappe.db.add_index("Masar Time Entry", ["task", "is_voided"])
	frappe.db.add_index("Masar Time Entry", ["worker", "work_date"])
	frappe.db.add_unique(
		"Masar Time Entry", ["owner", "client_request_id"], constraint_name="unique_time_entry_request"
	)
