import frappe


def execute():
	"""Phase 7 (ADR-062): Tasks whose remaining_minutes is above 0 were given an estimate, so flag them.
	A stored 0 cannot be told apart from "never estimated" (Int columns are NOT NULL) and stays unset."""
	frappe.db.sql(
		"update `tabMasar Task` set has_remaining_estimate = 1 where ifnull(remaining_minutes, 0) > 0"
	)
