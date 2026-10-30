"""One-off, owner-authorised reset of all Sprint (Batch) data (2026-10-29).

Removes every `Masar Batch` and `Masar Batch Item` record, and the Batches' own history (`Masar Activity`
rows whose reference is a `Masar Batch`). Nothing else is deleted:
- Tasks carry no Batch field: Sprint membership lives only in `Masar Batch Item.current_task` (ADR-044),
  so removing the items puts every Task back in the Backlog without writing to any Task.
- Task history entries about Sprints ("planned into …", "taken out of …") belong to the Tasks and stay;
  once their Sprint is gone they read "a Sprint". Frappe's own log of Sprint records deleted earlier
  (Comment rows of type "Deleted") is unrelated audit history and stays too.
- Spaces, Tasks, Features, Releases, Actions, Comments, Attachments, Time Entries, labels, users,
  memberships and permissions are untouched; the before/after counts prove it.

The Batch controller's `on_trash` guard (only an empty, planned Sprint may be deleted) protects history
from everyday deletion; this reset overrides it on purpose and therefore deletes with `frappe.db.delete`
inside one transaction instead of `frappe.delete_doc`. The normal delete service would also write a
"taken out of the Sprint" history entry for every Task, which a reset must not do. No "Deleted Document"
copies are made: the verified backup taken before the reset is the way back.

Dry run (default) does everything, checks it, and rolls back. Run inside the backend container:
    cd /home/frappe/frappe-bench/sites && ../env/bin/python <this file> <site>               # dry run
    cd /home/frappe/frappe-bench/sites && ../env/bin/python <this file> <site> --execute RESET-ALL-SPRINTS
"""

import json
import sys

import frappe

CONFIRMATION = "RESET-ALL-SPRINTS"
BATCH_DOCTYPES = ("Masar Batch", "Masar Batch Item")
# Business data that must not change.
PRESERVED = (
	"Masar Space",
	"Masar Space Member",
	"Masar Task",
	"Masar Task Assignee",
	"Masar Task Label",
	"Masar Task Action",
	"Masar Label",
	"Masar Feature",
	"Masar Release",
	"Masar Comment",
	"Masar Comment Reaction",
	"Masar Attachment",
	"Masar Time Entry",
	"Masar Timer Session",
	"Masar My Day",
	"User",
	"Has Role",
	"File",
)


def _count(doctype: str, filters=None) -> int | None:
	return frappe.db.count(doctype, filters) if frappe.db.table_exists(doctype) else None


def snapshot() -> dict:
	sql = frappe.db.sql
	return {
		"Masar Batch": _count("Masar Batch"),
		"Masar Batch by status": dict(sql("select status, count(*) from `tabMasar Batch` group by status")),
		"Masar Batch Item": _count("Masar Batch Item"),
		"Masar Batch Item by outcome": dict(sql("select outcome, count(*) from `tabMasar Batch Item` group by outcome")),
		"Tasks currently in a Sprint": sql(
			"select count(distinct current_task) from `tabMasar Batch Item` where current_task is not null"
		)[0][0],
		"Activity of Batches": _count("Masar Activity", {"reference_doctype": "Masar Batch"}),
		"Task history about Sprints": _count(
			"Masar Activity", {"reference_doctype": "Masar Task", "event": ["in", ["batch_added", "batch_removed"]]}
		),
		"Activity (other)": sql(
			"select count(*) from `tabMasar Activity` where reference_doctype <> 'Masar Batch'"
		)[0][0],
		"Frappe records of Batches": sql(
			"""select (select count(*) from `tabVersion` where ref_doctype in %(d)s)
			+ (select count(*) from `tabComment` where reference_doctype in %(d)s and comment_type <> 'Deleted')
			+ (select count(*) from `tabFile` where attached_to_doctype in %(d)s)
			+ (select count(*) from `tabDocShare` where share_doctype in %(d)s)""",
			{"d": BATCH_DOCTYPES},
		)[0][0],
		# Frappe's audit log of Sprint records deleted earlier: unrelated history, kept.
		"Frappe deletion log of Sprints": _count(
			"Comment", {"reference_doctype": ["in", BATCH_DOCTYPES], "comment_type": "Deleted"}
		),
		"preserved": {doctype: _count(doctype) for doctype in PRESERVED},
	}


def integrity() -> dict:
	"""Every check must be 0 after the reset."""
	sql = frappe.db.sql
	return {
		"Batch records": frappe.db.count("Masar Batch"),
		"Batch Item records": frappe.db.count("Masar Batch Item"),
		"Activity referencing a missing Batch": sql(
			"""select count(*) from `tabMasar Activity` a left join `tabMasar Batch` b on b.name = a.reference_name
			where a.reference_doctype = 'Masar Batch' and b.name is null"""
		)[0][0],
		"Frappe records of Batches": sql(
			"""select (select count(*) from `tabVersion` where ref_doctype in %(d)s)
			+ (select count(*) from `tabComment` where reference_doctype in %(d)s and comment_type <> 'Deleted')
			+ (select count(*) from `tabFile` where attached_to_doctype in %(d)s)
			+ (select count(*) from `tabDocShare` where share_doctype in %(d)s)""",
			{"d": BATCH_DOCTYPES},
		)[0][0],
		"Tasks without a valid Space": sql(
			"""select count(*) from `tabMasar Task` t left join `tabMasar Space` s on s.name = t.space
			where s.name is null"""
		)[0][0],
	}


def reset_batches(execute: bool = False, confirmation: str | None = None) -> dict:
	if execute and confirmation != CONFIRMATION:
		raise SystemExit(f"Refusing to delete: pass the confirmation {CONFIRMATION}.")
	before = snapshot()
	files = frappe.get_all("File", filters={"attached_to_doctype": ["in", BATCH_DOCTYPES]}, pluck="name")
	if files:
		raise SystemExit(f"{len(files)} files are attached to Sprint records; review them before resetting.")
	frappe.db.delete("Masar Activity", {"reference_doctype": "Masar Batch"})
	frappe.db.delete("Masar Batch Item")
	frappe.db.delete("Masar Batch")
	frappe.db.delete("Version", {"ref_doctype": ["in", BATCH_DOCTYPES]})
	frappe.db.delete("DocShare", {"share_doctype": ["in", BATCH_DOCTYPES]})
	frappe.db.delete("Comment", {"reference_doctype": ["in", BATCH_DOCTYPES], "comment_type": ["!=", "Deleted"]})
	after = snapshot()
	checks = integrity()
	problems = [name for name, value in checks.items() if value]
	if before["preserved"] != after["preserved"]:
		problems.append("preserved records changed")
	for kept in ("Task history about Sprints", "Activity (other)", "Frappe deletion log of Sprints"):
		if after[kept] != before[kept]:
			problems.append(f"{kept} changed")
	if problems or not execute:
		frappe.db.rollback()
	else:
		frappe.db.commit()
		frappe.clear_cache()
	return {
		"mode": "executed" if execute and not problems else "dry run (rolled back)",
		"problems": problems,
		"before": before,
		"after": after,
		"integrity": checks,
	}


if __name__ == "__main__":
	site = sys.argv[1]
	execute = "--execute" in sys.argv
	confirmation = sys.argv[sys.argv.index("--execute") + 1] if execute and len(sys.argv) > sys.argv.index("--execute") + 1 else None
	frappe.init(site=site)
	frappe.connect()
	frappe.set_user("Administrator")
	try:
		print(json.dumps(reset_batches(execute, confirmation), indent=1, default=str))
	finally:
		frappe.destroy()
