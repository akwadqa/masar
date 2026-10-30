import frappe
from frappe.utils import nowdate

from masar.masar.doctype.masar_task.masar_task import clean_markdown


def execute():
	"""Client revision 2. Statuses: finished Tasks become Completed, the rest Open, and open Tasks
	whose due date has passed become Overdue (once for that due date). Descriptions, stored as HTML
	until now, are converted to Markdown. `modified` is not changed: this is a format migration."""
	frappe.db.sql("update `tabMasar Task` set status = 'Completed' where is_completed = 1")
	frappe.db.sql(
		"update `tabMasar Task` set status = 'Open' where is_completed = 0 and ifnull(status, '') in ('', 'Open')"
	)
	frappe.db.sql(
		"""update `tabMasar Task` set status = 'Overdue', overdue_for = due_date
		where is_completed = 0 and status = 'Open' and due_date is not null and due_date < %s""",
		nowdate(),
	)

	from markdownify import markdownify

	for name, description in frappe.db.sql(
		"select name, description from `tabMasar Task` where description like '%%<%%'"
	):
		markdown = clean_markdown(markdownify(description, heading_style="ATX", bullets="-"))
		frappe.db.sql("update `tabMasar Task` set description = %s where name = %s", (markdown, name))
