"""Start/stop work timer (client revision), built on Phase 7 time entries.

Policy:
- One active timer per employee, enforced by a unique column (`Masar Timer Session.active_worker`).
- Elapsed time always comes from server timestamps; the browser only displays it.
- Stopping logs one Time Entry through `time_service.log_time` with a request id derived from the
  session, so a repeated or concurrent Stop can never log twice.
- Minutes are the elapsed time rounded to the nearest minute, at least 1. The employee may log less
  than measured, never more, and never over the 24-hour entry limit.
- The work date is the Qatar business date on which the timer started.
"""

import frappe
from frappe import _
from frappe.utils import get_datetime, getdate, now_datetime

from masar.exceptions import MasarConflictError
from masar.permissions import get_space_role, require_masar_user, require_task_access, require_task_write
from masar.services.serializers import iso_datetime
from masar.utils.context import masar_service

DOCTYPE = "Masar Timer Session"
ACTIVE = ("Running", "Paused")
MAX_MINUTES = 24 * 60


class TimerSession:
	"""One employee's timer session: loading, elapsed time and state changes."""

	def __init__(self, doc):
		self.doc = doc

	@classmethod
	def active_for(cls, user: str, lock: bool = False) -> "TimerSession | None":
		name = frappe.db.get_value(DOCTYPE, {"worker": user, "state": ["in", ACTIVE]}, "name")
		return cls(frappe.get_doc(DOCTYPE, name, for_update=lock)) if name else None

	@classmethod
	def owned(cls, name: str) -> "TimerSession":
		"""Load the caller's own session for an update, or 404 (also for other people's sessions)."""
		doc = frappe.get_doc(DOCTYPE, name, for_update=True) if frappe.db.exists(DOCTYPE, name) else None
		if not doc or doc.worker != frappe.session.user:
			frappe.throw(_("Timer not found"), frappe.DoesNotExistError)
		return cls(doc)

	def elapsed_seconds(self, at=None) -> int:
		at = at or now_datetime()
		end = get_datetime(self.doc.paused_at) if self.doc.state == "Paused" else at
		return max(0, int((end - get_datetime(self.doc.started_at)).total_seconds()) - int(self.doc.paused_seconds or 0))

	def measured_minutes(self) -> int:
		return max(1, round(self.elapsed_seconds() / 60))

	def save(self, **values):
		self.doc.update(values)
		with masar_service():
			self.doc.save(ignore_permissions=True)

	def to_dict(self) -> dict:
		task = frappe.db.get_value("Masar Task", self.doc.task, ["title", "space"], as_dict=True) or {}
		return {
			"name": self.doc.name,
			"task": self.doc.task,
			"taskTitle": task.get("title"),
			"space": self.doc.space,
			"state": self.doc.state,
			"startedAt": iso_datetime(self.doc.started_at),
			"elapsedSeconds": self.elapsed_seconds(),
			"serverTime": iso_datetime(now_datetime()),
			"timeEntry": self.doc.time_entry,
		}


def active() -> dict | None:
	require_masar_user()
	session = TimerSession.active_for(frappe.session.user)
	return session.to_dict() if session else None


def start(task_name: str) -> dict:
	"""Start timing a Task. Starting the Task that is already timed returns that session; a timer on
	another Task must be stopped or discarded first (nothing is ever discarded implicitly)."""
	task = _writable_task(task_name)
	current = TimerSession.active_for(frappe.session.user, lock=True)
	if current and current.doc.task == task.name:
		return current.to_dict()
	if current:
		_active_conflict(current)
	return _insert(task)


def pause(name: str) -> dict:
	session = TimerSession.owned(name)
	if session.doc.state == "Running":
		session.save(state="Paused", paused_at=now_datetime())
	return session.to_dict()


def resume(name: str) -> dict:
	session = TimerSession.owned(name)
	if session.doc.state == "Paused":
		paused = int((now_datetime() - get_datetime(session.doc.paused_at)).total_seconds())
		session.save(state="Running", paused_at=None, paused_seconds=int(session.doc.paused_seconds or 0) + paused)
	return session.to_dict()


def stop(name: str, minutes=None, description: str | None = None) -> dict:
	"""Log the measured time (or less) as one Time Entry and close the session. Idempotent."""
	from masar.services import time_service

	session = TimerSession.owned(name)
	if session.doc.state == "Stopped":
		return {**session.to_dict(), "logged": False}
	if session.doc.state == "Discarded":
		frappe.throw(_("This timer was discarded."))
	logged_minutes = _minutes_to_log(session, minutes)
	work_date = str(getdate(session.doc.started_at))
	result = time_service.log_time(session.doc.task, f"{logged_minutes}m", f"timer-{session.doc.name}", work_date, description)
	session.save(state="Stopped", ended_at=now_datetime(), time_entry=result["entry"]["name"])
	return {**session.to_dict(), "logged": True, "minutes": logged_minutes, "result": result}


def discard(name: str) -> dict:
	"""Close a timer without logging time (always allowed for its owner, even after access ends)."""
	session = TimerSession.owned(name)
	if session.doc.state in ACTIVE:
		session.save(state="Discarded", ended_at=now_datetime())
	return session.to_dict()


def _minutes_to_log(session: TimerSession, minutes) -> int:
	measured = session.measured_minutes()
	if measured > MAX_MINUTES and not minutes:
		frappe.throw(_("This timer ran for more than 24 hours. Enter the time to log, or discard it."))
	if minutes is None or minutes == "":
		return measured
	requested = int(minutes)
	if requested < 1 or requested > min(measured, MAX_MINUTES):
		frappe.throw(_("Log between 1 minute and the measured time ({0} minutes).").format(min(measured, MAX_MINUTES)))
	return requested


def _writable_task(task_name: str):
	require_masar_user()
	task = require_task_access(task_name)
	require_task_write(task.space, get_space_role(task.space))
	return task


def _active_conflict(current: TimerSession):
	frappe.local.response["activeTimer"] = current.to_dict()
	frappe.throw(_("A timer is already running on another task. Stop or discard it first."), MasarConflictError)


def _insert(task) -> dict:
	doc = frappe.get_doc({
		"doctype": DOCTYPE, "task": task.name, "space": task.space, "worker": frappe.session.user,
		"state": "Running", "started_at": now_datetime(), "paused_seconds": 0,
	})
	frappe.db.savepoint("masar_timer_start")
	try:
		with masar_service():
			doc.insert(ignore_permissions=True)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		# A concurrent start won the race: report the timer that now exists instead of a second one.
		frappe.db.rollback(save_point="masar_timer_start")
		current = TimerSession.active_for(frappe.session.user)
		if current and current.doc.task == task.name:
			return current.to_dict()
		_active_conflict(current)
	return TimerSession(doc).to_dict()
