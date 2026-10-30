"""Time tracking: manual time entries, corrections and totals (ADR-060 … ADR-063).

- Durations are integer minutes (1 … 1,440 per entry); natural input such as "1h 30m" or "1.5h" is parsed
  here and in the Workspace with the same grammar, the server being authoritative.
- The worker is always the session user. Work dates are Qatar business dates, never in the future.
- Authors correct their own entries; Space Managers may void (never edit) others' entries with a reason.
  Every change is written to Task history; voided entries stop counting but stay visible.
- `Masar Task.logged_minutes` is a cache recomputed from valid entries under the Task row lock, so totals
  never drift and are never computed in the browser.
"""

import re

import frappe
from frappe import _
from frappe.query_builder.functions import Sum
from frappe.utils import cint, getdate, now_datetime, nowdate

from masar.exceptions import MasarConflictError, MasarRequestReuseError
from masar.masar.doctype.masar_task.masar_task import effective_estimate, set_estimate
from masar.masar.doctype.masar_time_entry.masar_time_entry import MAX_MINUTES
from masar.permissions import (
	MANAGER,
	can_write_tasks,
	get_space_role,
	get_space_status,
	not_found,
	require_masar_user,
	require_task_access,
	require_task_write,
)
from masar.services.activity import record_activity
from masar.services.serializers import iso_date, iso_datetime, user_refs
from masar.utils.context import concurrent_duplicate, masar_service

REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
DURATION = re.compile(r"^(?:(?P<h>\d+(?:\.\d+)?)\s*h)?\s*(?:(?P<m>\d+)\s*m)?$")
MAX_NOTE = 1000
MAX_ESTIMATE = 10_000 * 60  # 10,000 hours: a sanity bound, not a business rule


# --------------------------------------------------------------------------- durations


def parse_duration(value, maximum: int = MAX_MINUTES) -> int:
	"""Minutes from 90, "90", "90m", "1h", "1h 30m", "1h30m", "1.5h" or "1:30". Decimal hours must give
	whole minutes (1.5h → 90; 1.33h is refused rather than silently rounded)."""
	if isinstance(value, bool):
		frappe.throw(_("Enter a duration such as 30m, 1h or 1h 30m."))
	if isinstance(value, int):
		minutes = value
	else:
		text = " ".join(str(value or "").lower().split())
		if re.fullmatch(r"\d+", text):
			minutes = int(text)
		elif match := re.fullmatch(r"(\d+):([0-5]\d)", text):
			minutes = int(match.group(1)) * 60 + int(match.group(2))
		else:
			match = DURATION.fullmatch(text)
			if not text or not match or not (match.group("h") or match.group("m")):
				frappe.throw(_("Enter a duration such as 30m, 1h or 1h 30m."))
			hours = float(match.group("h") or 0) * 60
			if abs(hours - round(hours)) > 1e-9:
				frappe.throw(_("Hours must convert to whole minutes (for example 1.5h, not 1.33h)."))
			minutes = round(hours) + int(match.group("m") or 0)
	if minutes < 1:
		frappe.throw(_("A duration must be at least 1 minute."))
	if minutes > maximum:
		if maximum == MAX_MINUTES:
			frappe.throw(_("One entry can record at most 24 hours (one day's work)."))
		frappe.throw(_("Enter a realistic duration."))
	return minutes


def parse_estimate(value) -> int | None:
	"""Remaining estimate: empty clears it (None), 0 is a real "nothing left" estimate."""
	if value is None or (isinstance(value, str) and not value.strip()):
		return None
	if value in (0, "0", "0m", "0h"):
		return 0
	return parse_duration(value, maximum=MAX_ESTIMATE)


def _work_date(value) -> str:
	if not value:
		return nowdate()  # site timezone: Asia/Qatar
	try:
		day = getdate(value)
	except Exception:
		frappe.throw(_("Enter a valid work date."))
	if day > getdate(nowdate()):
		frappe.throw(_("Work cannot be logged for a future date."))
	return str(day)


def _note(value) -> str | None:
	text = (value or "").strip()
	if len(text) > MAX_NOTE:
		frappe.throw(_("Work notes are limited to {0} characters.").format(MAX_NOTE))
	return text or None


# --------------------------------------------------------------------------- reads

ENTRY_FIELDS = (
	"name",
	"task",
	"space",
	"worker",
	"work_date",
	"minutes",
	"description",
	"creation",
	"modified",
	"edited_at",
	"is_voided",
	"voided_at",
	"voided_by",
	"void_reason",
)


def serialise_entries(rows: list) -> list[dict]:
	if not rows:
		return []
	refs = user_refs([r.worker for r in rows] + [r.voided_by for r in rows if r.get("voided_by")])
	me = frappe.session.user
	cache: dict[str, tuple] = {}
	out = []
	for r in rows:
		if r.space not in cache:
			role = get_space_role(r.space)
			cache[r.space] = (role, can_write_tasks(get_space_status(r.space), role))
		role, writable = cache[r.space]
		voided = bool(r.is_voided)
		out.append(
			{
				"name": r.name,
				"task": r.task,
				"worker": refs.get(r.worker),
				"workDate": iso_date(r.work_date),
				"minutes": cint(r.minutes),
				"description": r.description,
				"loggedAt": iso_datetime(r.creation),
				"modified": iso_datetime(r.modified),
				"editedAt": iso_datetime(r.edited_at),
				"isVoided": voided,
				"voidedAt": iso_datetime(r.get("voided_at")),
				"voidedBy": refs.get(r.voided_by) if voided and r.get("voided_by") else None,
				"voidReason": r.void_reason if voided else None,
				"permissions": {
					"canEdit": writable and not voided and r.worker == me,
					"canVoid": writable and not voided and (r.worker == me or role == MANAGER),
				},
			}
		)
	return out


def get_entry(entry_name: str) -> dict:
	doc = _entry(entry_name)
	return serialise_entries([frappe._dict({f: doc.get(f) for f in ENTRY_FIELDS})])[0]


def summary(task_name: str) -> dict:
	"""Authoritative totals for a Task the caller can read."""
	task = require_task_access(task_name)
	return {"loggedMinutes": cint(task.logged_minutes), "remainingMinutes": effective_estimate(task)}


def _entry(entry_name: str, lock: bool = False):
	require_masar_user()
	space = frappe.db.get_value("Masar Time Entry", entry_name, "space") if entry_name else None
	if not space or get_space_role(space) is None:
		not_found("Time entry")
	return frappe.get_doc("Masar Time Entry", entry_name, for_update=lock)


# --------------------------------------------------------------------------- writes


def _recompute(task_name: str) -> int:
	"""Logged total = sum of valid entries (integer minutes); stored on the Task as a cache."""
	entry = frappe.qb.DocType("Masar Time Entry")
	total = (
		frappe.qb.from_(entry)
		.select(Sum(entry.minutes))
		.where((entry.task == task_name) & (entry.is_voided == 0))
		.run()[0][0]
	)
	total = cint(total)
	frappe.db.set_value("Masar Task", task_name, "logged_minutes", total, update_modified=False)
	return total


def _find_created(key: str, task: str, minutes: int, work_date: str):
	existing = frappe.db.get_value(
		"Masar Time Entry",
		{"owner": frappe.session.user, "client_request_id": key},
		["name", "task", "minutes", "work_date"],
		as_dict=True,
	)
	if existing and (
		existing.task != task or cint(existing.minutes) != minutes or str(existing.work_date) != work_date
	):
		frappe.throw(
			_("This request id was already used for a different time entry."), MasarRequestReuseError
		)
	return existing.name if existing else None


def _result(task_name: str, entry_name: str, created: bool) -> dict:
	from masar.services import task_service

	return {"entry": get_entry(entry_name), "task": task_service.get_detail(task_name), "created": created}


def log_time(
	task_name: str,
	duration,
	client_request_id: str,
	work_date=None,
	description: str | None = None,
	remaining=None,
	set_remaining: bool = False,
	base_remaining=None,
) -> dict:
	"""Log work on a Task for the session user, optionally setting the remaining estimate in the same
	transaction (ADR-062). Idempotent per (user, client_request_id): a repeat after a lost response
	returns the same entry; a stale estimate (`base_remaining` differs) fails the whole operation."""
	if not client_request_id or not REQUEST_ID.match(client_request_id):
		frappe.throw(_("A valid client request id is required."))
	minutes = parse_duration(duration)
	day = _work_date(work_date)
	note = _note(description)
	task = require_task_access(task_name, for_update=True)  # serialises totals per Task
	require_task_write(task.space, get_space_role(task.space))
	existing = _find_created(client_request_id, task.name, minutes, day)
	if existing:
		return _result(task.name, existing, False)
	new_estimate = parse_estimate(remaining) if set_remaining else None
	# `base_remaining` is the estimate the user saw ("" = none). A different stored value is a conflict.
	current_estimate = effective_estimate(task)
	if set_remaining and base_remaining is not None and parse_estimate(base_remaining) != current_estimate:
		frappe.local.response["conflicts"] = [
			{"field": "remainingMinutes", "current": current_estimate, "yours": new_estimate}
		]
		frappe.throw(
			_("Someone else changed the remaining estimate. Review it; your time was not logged."),
			MasarConflictError,
		)
	doc = frappe.get_doc(
		{
			"doctype": "Masar Time Entry",
			"task": task.name,
			"space": task.space,
			"worker": frappe.session.user,
			"work_date": day,
			"minutes": minutes,
			"description": note,
			"client_request_id": client_request_id,
		}
	)
	frappe.db.savepoint("masar_time_log")
	try:
		with masar_service():
			doc.insert()
			if set_remaining and new_estimate != current_estimate:
				set_estimate(task, new_estimate)
				task.save()  # records the estimate change in Task history
			_recompute(task.name)
			record_activity(
				task,
				"time_logged",
				{"entry": doc.name, "minutes": minutes, "workDate": day},
				space=task.space,
			)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		frappe.db.rollback(save_point="masar_time_log")
		existing = _find_created(client_request_id, task.name, minutes, day)
		if not existing:
			concurrent_duplicate()
		return _result(task.name, existing, False)
	return _result(task.name, doc.name, True)


def update_entry(entry_name: str, changes: dict, base_modified: str | None = None) -> dict:
	"""Authors correct their own entries (duration, date, note). Nobody edits another person's time.
	A stale editor gets a conflict; every correction is recorded in Task history with before/after."""
	if not isinstance(changes, dict) or not changes or set(changes) - {"duration", "workDate", "description"}:
		frappe.throw(_("Only the duration, work date and note can be corrected."))
	doc = _entry(entry_name)
	task = require_task_access(doc.task, for_update=True)
	require_task_write(task.space, get_space_role(task.space))
	doc = frappe.get_doc("Masar Time Entry", entry_name, for_update=True)
	if doc.is_voided:
		frappe.throw(_("This entry was voided and can no longer be changed."), frappe.PermissionError)
	if doc.worker != frappe.session.user:
		frappe.throw(_("Only the person who logged this time can correct it."), frappe.PermissionError)
	if base_modified and iso_datetime(doc.modified) != base_modified:
		frappe.local.response["conflicts"] = [{"field": "entry", "current": iso_datetime(doc.modified)}]
		frappe.throw(_("This entry changed meanwhile. Review the latest version."), MasarConflictError)
	before = {"minutes": cint(doc.minutes), "workDate": str(doc.work_date)}
	if "duration" in changes:
		doc.minutes = parse_duration(changes["duration"])
	if "workDate" in changes:
		doc.work_date = _work_date(changes["workDate"])
	note_changed = "description" in changes and _note(changes["description"]) != doc.description
	if "description" in changes:
		doc.description = _note(changes["description"])
	after = {"minutes": cint(doc.minutes), "workDate": str(doc.work_date)}
	if before == after and not note_changed:
		return _result(task.name, doc.name, False)
	doc.edited_at = now_datetime()
	with masar_service():
		doc.save()
		_recompute(task.name)
		record_activity(
			task,
			"time_edited",
			{"entry": doc.name, "from": before, "to": after, "noteChanged": note_changed},
			space=task.space,
		)
	return _result(task.name, doc.name, False)


def void_entry(entry_name: str, reason: str | None = None) -> dict:
	"""Void instead of delete: the entry stops counting, its record and the reason stay (ADR-061).
	Authors void their own entries; Space Managers may void others' entries, with a reason."""
	doc = _entry(entry_name)
	task = require_task_access(doc.task, for_update=True)
	role = get_space_role(task.space)
	require_task_write(task.space, role)
	doc = frappe.get_doc("Masar Time Entry", entry_name, for_update=True)
	if doc.is_voided:
		return _result(task.name, doc.name, False)  # repeated request: already done
	moderated = doc.worker != frappe.session.user
	if moderated and role != MANAGER:
		frappe.throw(
			_("Only the person who logged this time or a Space Manager can void it."), frappe.PermissionError
		)
	reason = _note(reason)
	if moderated and not reason:
		frappe.throw(_("Give a reason when voiding someone else's time."))
	doc.is_voided = 1
	doc.voided_at = now_datetime()
	doc.voided_by = frappe.session.user
	doc.void_reason = reason
	with masar_service():
		doc.save()
		_recompute(task.name)
		record_activity(
			task,
			"time_voided",
			{
				"entry": doc.name,
				"worker": doc.worker,
				"minutes": cint(doc.minutes),
				"moderated": moderated,
				"reason": reason,
			},
			space=task.space,
		)
	return _result(task.name, doc.name, False)
