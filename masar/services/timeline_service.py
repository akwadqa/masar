"""Unified Task timeline: Comments | History | Worklog (ADR-057).

A read model over existing records — `Masar Comment` and the Task's `Masar Activity` entries — never a
copy. Items are ordered by (time, source, name), which is stable even for identical timestamps, and
paged with keyset cursors in either direction. A comment anchor (deep link) returns the page that
starts at that comment, however old it is, without loading the whole discussion.

History payloads are rebuilt from resolved references: only names the viewer may see are returned
(Feature / Release / label titles of the same Space; Batch titles only if the Batch is visible).
Worklog shows Time Entries (Phase 7); corrections and voids also appear in History as audit evidence.
"""

import base64
import json

import frappe
from frappe import _
from frappe.utils import cint, get_datetime

from masar.permissions import batch_visible, not_found, require_task_access
from masar.services.comment_service import COMMENT_FIELDS, serialise_comments
from masar.services.serializers import iso_datetime, user_refs
from masar.services.time_service import ENTRY_FIELDS as TIME_FIELDS
from masar.services.time_service import serialise_entries

VIEWS = ("all", "comments", "history", "worklog")
MAX_LIMIT = 100
# Events shown in History. Comment events are represented by the comments themselves, except deletion,
# which is the visible moderation evidence.
HIDDEN_EVENTS = ("comment_added", "comment_edited", "time_logged")
SOURCE_RANK = {"history": 0, "comment": 1, "time": 2}


def _encode(key: tuple) -> str:
	return base64.urlsafe_b64encode(json.dumps([str(key[0]), key[1], key[2]]).encode()).decode()


def _decode(cursor: str) -> tuple:
	try:
		at, rank, name = json.loads(base64.urlsafe_b64decode(cursor.encode()))
		return get_datetime(at), int(rank), str(name)
	except (ValueError, TypeError):
		frappe.throw(_("Invalid cursor."))


def _where(table, rank: int, key: tuple, direction: str):
	"""Rows strictly before/after `key` in (creation, rank, name) order, for one source table whose
	rows all have source rank `rank` (the rank comparison is resolved here, not in SQL)."""
	at, key_rank, name = key
	before = direction == "before"
	if rank == key_rank:
		tie = (table.name < name) if before else (table.name > name)
		same = (table.creation == at) & tie
	elif (rank < key_rank) == before:
		same = table.creation == at  # every row at that instant sorts on the requested side
	else:
		same = None
	strict = (table.creation < at) if before else (table.creation > at)
	return strict | same if same is not None else strict


def _fetch(
	task: str, view: str, key: tuple | None, direction: str, limit: int, inclusive: bool = False
) -> list:
	"""Up to `limit` rows per source on one side of `key`, merged in (creation, rank, name) order."""
	rows = []
	descending = direction == "before"
	if view in ("all", "comments"):
		c = frappe.qb.DocType("Masar Comment")
		q = frappe.qb.from_(c).select(*[c[f] for f in COMMENT_FIELDS]).where(c.task == task)
		if key:
			cond = _where(c, SOURCE_RANK["comment"], key, direction)
			if inclusive:
				cond = cond | (c.name == key[2])
			q = q.where(cond)
		order = frappe.qb.desc if descending else frappe.qb.asc
		for r in (
			q.orderby(c.creation, order=order).orderby(c.name, order=order).limit(limit).run(as_dict=True)
		):
			rows.append(("comment", r))
	if view in ("all", "history"):
		a = frappe.qb.DocType("Masar Activity")
		q = (
			frappe.qb.from_(a)
			.select(a.name, a.creation, a.actor, a.event, a.data)
			.where(
				(a.reference_doctype == "Masar Task")
				& (a.reference_name == task)
				& a.event.notin(HIDDEN_EVENTS)
			)
		)
		if key:
			q = q.where(_where(a, SOURCE_RANK["history"], key, direction))
		order = frappe.qb.desc if descending else frappe.qb.asc
		for r in (
			q.orderby(a.creation, order=order).orderby(a.name, order=order).limit(limit).run(as_dict=True)
		):
			rows.append(("history", r))
	if view in ("all", "worklog"):
		# Worklog (Phase 7): each Time Entry once, at the moment it was logged. Its "time_logged" history
		# entry is hidden above so the same event never appears twice (ADR-063).
		t = frappe.qb.DocType("Masar Time Entry")
		q = frappe.qb.from_(t).select(*[t[f] for f in TIME_FIELDS]).where(t.task == task)
		if key:
			q = q.where(_where(t, SOURCE_RANK["time"], key, direction))
		order = frappe.qb.desc if descending else frappe.qb.asc
		for r in (
			q.orderby(t.creation, order=order).orderby(t.name, order=order).limit(limit).run(as_dict=True)
		):
			rows.append(("time", r))
	rows.sort(key=lambda item: (item[1].creation, SOURCE_RANK[item[0]], item[1].name), reverse=descending)
	return rows[:limit]


def timeline(
	task_name: str,
	view: str = "all",
	before: str | None = None,
	after: str | None = None,
	anchor: str | None = None,
	limit: int = 30,
) -> dict:
	"""Items in chronological order (oldest first) for one page:
	- default: the newest `limit` items, with `earlierCursor` if older ones exist;
	- `before`: the `limit` items preceding a cursor; `after`: the `limit` items following it;
	- `anchor` (a comment): the page starting at that comment, with cursors both ways."""
	task = require_task_access(task_name)
	if view not in VIEWS:
		frappe.throw(_("Unknown timeline view."))
	limit = max(1, min(cint(limit) or 30, MAX_LIMIT))
	if anchor:
		row = frappe.db.get_value("Masar Comment", anchor, ["task", "creation", "name"], as_dict=True)
		if not row or row.task != task.name:
			not_found("Comment")
		key = (row.creation, SOURCE_RANK["comment"], row.name)
		items = _fetch(task.name, view, key, "after", limit + 1, inclusive=True)
		later = len(items) > limit
		items = items[:limit]
		earlier = bool(_fetch(task.name, view, key, "before", 1))
	elif after:
		items = _fetch(task.name, view, _decode(after), "after", limit + 1)
		later = len(items) > limit
		items = items[:limit]
		earlier = True
	else:
		items = _fetch(task.name, view, _decode(before) if before else None, "before", limit + 1)
		earlier = len(items) > limit
		items = list(reversed(items[:limit]))
		later = bool(before)
	payload = _serialise(items)
	first, last = (items[0], items[-1]) if items else (None, None)
	cursor = lambda item: _encode((item[1].creation, SOURCE_RANK[item[0]], item[1].name))  # noqa: E731
	return {
		"items": payload,
		"earlierCursor": cursor(first) if earlier and first else None,
		"laterCursor": cursor(last) if later and last else None,
		"worklogAvailable": True,
	}


def _serialise(items: list) -> list[dict]:
	comments = serialise_comments([r for kind, r in items if kind == "comment"])
	by_name = {c["name"]: c for c in comments}
	history = describe_history([r for kind, r in items if kind == "history"])
	entries = {e["name"]: e for e in serialise_entries([r for kind, r in items if kind == "time"])}
	out = []
	for kind, r in items:
		if kind == "comment":
			out.append(
				{
					"kind": "comment",
					"id": f"comment:{r.name}",
					"at": iso_datetime(r.creation),
					"comment": by_name[r.name],
				}
			)
		elif kind == "time":
			out.append(
				{
					"kind": "time",
					"id": f"time:{r.name}",
					"at": iso_datetime(r.creation),
					"entry": entries[r.name],
				}
			)
		else:
			out.append(
				{
					"kind": "history",
					"id": f"history:{r.name}",
					"at": iso_datetime(r.creation),
					"history": history[r.name],
				}
			)
	return out


# --------------------------------------------------------------------------- history descriptions


def describe_history(rows: list) -> dict[str, dict]:
	"""Turn Activity rows into display-safe entries. Unknown or unresolvable references become neutral
	text; nothing outside the Task's Space (or a Batch the viewer cannot see) is named."""
	parsed = []
	users, labels, features, releases, batches, tasks = set(), set(), set(), set(), set(), set()
	for r in rows:
		try:
			data = json.loads(r.data or "{}")
		except ValueError:
			data = {}
		parsed.append((r, data))
		users.add(r.actor)
		if r.event in ("assigned", "unassigned"):
			users.add(data.get("user"))
		if r.event == "owner_changed":
			users.update([data.get("from"), data.get("to")])
		if r.event == "comment_deleted":
			users.add(data.get("author"))
		if r.event == "time_voided":
			users.add(data.get("worker"))
		if r.event in ("label_added", "label_removed"):
			labels.add(data.get("label"))
		if r.event == "field_changed" and data.get("field") == "feature":
			features.update([data.get("from"), data.get("to")])
		if r.event == "field_changed" and data.get("field") == "target_release":
			releases.update([data.get("from"), data.get("to")])
		if r.event in ("batch_added", "batch_removed"):
			batches.update([data.get("batch"), data.get("carriedFrom")])
		if r.event in ("action_promoted", "promoted_from_action"):
			tasks.add(data.get("task"))
	refs = user_refs([u for u in users if u])
	titles = {
		"label": _titles("Masar Label", "label_name", labels),
		"feature": _titles("Masar Feature", "title", features),
		"release": _titles("Masar Release", "release_name", releases),
		"task": _titles("Masar Task", "title", tasks),
	}
	batch_titles = {}
	for name in [b for b in batches if b]:
		owner, title = frappe.db.get_value("Masar Batch", name, ["batch_owner", "batch_name"]) or (None, None)
		if owner and batch_visible(name, owner):
			batch_titles[name] = title
	result = {}
	for r, data in parsed:
		entry = {"event": r.event, "actor": refs.get(r.actor)}
		if r.event == "field_changed":
			field = data.get("field")
			entry["field"] = {
				"target_release": "release",
				"due_date": "dueDate",
				"is_important": "isImportant",
				"is_my_day": "isMyDay",
				"remaining_minutes": "remainingMinutes",
			}.get(field, field)
			if field == "feature":
				entry["from"], entry["to"] = (
					titles["feature"].get(data.get("from")),
					titles["feature"].get(data.get("to")),
				)
			elif field == "target_release":
				entry["from"], entry["to"] = (
					titles["release"].get(data.get("from")),
					titles["release"].get(data.get("to")),
				)
			elif field != "description":
				entry["from"], entry["to"] = data.get("from"), data.get("to")
		elif r.event in ("assigned", "unassigned"):
			entry["user"] = refs.get(data.get("user"))
		elif r.event == "owner_changed":
			entry["from"], entry["to"] = refs.get(data.get("from")), refs.get(data.get("to"))
		elif r.event in ("label_added", "label_removed"):
			entry["label"] = titles["label"].get(data.get("label"))
		elif r.event in ("batch_added", "batch_removed"):
			entry["batch"] = batch_titles.get(data.get("batch"))
			entry["carriedFrom"] = batch_titles.get(data.get("carriedFrom"))
		elif r.event == "comment_deleted":
			entry["author"] = refs.get(data.get("author"))
			entry["moderated"] = bool(data.get("moderated"))
		elif r.event == "time_edited":
			entry["from"], entry["to"] = data.get("from"), data.get("to")
			entry["noteChanged"] = bool(data.get("noteChanged"))
		elif r.event == "time_voided":
			entry["worker"] = refs.get(data.get("worker"))
			entry["minutes"] = data.get("minutes")
			entry["moderated"] = bool(data.get("moderated"))
			entry["reason"] = data.get("reason")
		elif r.event in ("attachment_added", "attachment_removed"):
			entry["fileName"] = data.get("fileName")
		elif r.event in ("action_promoted", "promoted_from_action"):
			entry["task"] = titles["task"].get(data.get("task"))
		elif r.event == "created":
			entry["title"] = data.get("title")
		result[r.name] = entry
	return result


def _titles(doctype: str, field: str, names: set) -> dict:
	names = [n for n in names if n]
	if not names:
		return {}
	return dict(
		frappe.get_all(doctype, filters={"name": ["in", names]}, fields=["name", field], as_list=True)
	)  # same Space
