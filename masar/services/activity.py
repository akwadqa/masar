import json

import frappe

from masar.services import realtime_service


def record_activity(doc, event: str, data: dict | None = None, space: str | None = None):
	"""Append a history entry. Callers have already authorised the underlying change, and
	Activity is system-maintained (no user write permission exists), hence ignore_permissions."""
	entry_space = space or doc.get("space") or (doc.name if doc.doctype == "Masar Space" else None)
	frappe.get_doc(
		{
			"doctype": "Masar Activity",
			"reference_doctype": doc.doctype,
			"reference_name": doc.name,
			"space": entry_space,
			"actor": frappe.session.user,
			"event": event,
			"data": json.dumps(data or {}, default=str),
		}
	).insert(ignore_permissions=True)
	# The bell list is derived from history (client revision 5): one place covers every path.
	from masar.services.inbox_service import from_activity

	from_activity(doc.doctype, doc.name, entry_space, event, data or {})
	# Live updates (specs/realtime.md) use the same hook: every change records history, while many
	# service writes (db.set_value, db_set, qb.update) skip Frappe's document events.
	realtime_service.space_changed(entry_space)
	if doc.doctype == "Masar Batch":
		realtime_service.batch_changed(doc.name)
