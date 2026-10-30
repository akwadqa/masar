import frappe


def execute():
	"""Client revision 4: My Day is personal. Until now it was one flag shared by everyone on the Task.
	Each open flagged Task goes to the My Day of the people assigned to it, the people who work on it.
	Tasks without assignees have nobody to give it to. The old column is kept (hidden), so no value is
	lost."""
	rows = frappe.db.sql(
		"""select t.name, t.space, a.user from `tabMasar Task` t
		join `tabMasar Task Assignee` a on a.parent = t.name and a.parenttype = 'Masar Task'
		where t.is_my_day = 1 and t.is_completed = 0""",
		as_dict=True,
	)
	for row in rows:
		if frappe.db.exists("Masar My Day", {"user": row.user, "task": row.name}):
			continue
		frappe.get_doc({"doctype": "Masar My Day", "user": row.user, "task": row.name}).insert(
			ignore_permissions=True
		)
