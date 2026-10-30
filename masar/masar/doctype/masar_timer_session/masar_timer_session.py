import frappe
from frappe import _
from frappe.model.document import Document

ACTIVE_STATES = ("Running", "Paused")


class MasarTimerSession(Document):
	"""A running work timer (client revision). Written only by timer_service; at most one active
	session per employee, enforced by the unique `active_worker` column."""

	def validate(self):
		if frappe.db.get_value("Masar Task", self.task, "space") != self.space:
			frappe.throw(_("A timer must use its Task's Space."))
		# Unique column: the worker while active (so a second active timer cannot exist), otherwise the
		# session's own name (always unique), which avoids relying on NULL handling in the index.
		self.active_worker = self.worker if self.state in ACTIVE_STATES else self.name


def on_doctype_update():
	frappe.db.add_index("Masar Timer Session", ["worker", "state"])
