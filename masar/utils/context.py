"""Service context and write-endpoint guard.

Generic Frappe write paths (frappe.client.*, /api/resource, /api/v2/document) are denied for
Masar DocTypes by the permission hooks unless the write happens inside `masar_service()`.
The flag lives in request-local `frappe.flags` and cannot be set by a client payload.
"""

import logging
import random
import time
from contextlib import contextmanager
from functools import wraps

import frappe

from masar.exceptions import MasarBusyError

SERVICE_FLAG = "masar_service"
# MariaDB 11.8 runs Frappe's REPEATABLE READ transactions with innodb_snapshot_isolation=ON: a
# locking read of a row that a concurrent request committed after this transaction's snapshot fails
# with error 1020, which Frappe reports as QueryDeadlockError (as it does real deadlocks). Retrying
# the whole write from a fresh snapshot is safe because Masar writes have no external side effects;
# the optimistic concurrency checks (`base`, `expected_*`) run again on every attempt (ADR-041, ADR-042).
WRITE_ATTEMPTS = 5


@contextmanager
def masar_service():
	previous = frappe.flags.get(SERVICE_FLAG)
	frappe.flags[SERVICE_FLAG] = True
	try:
		yield
	finally:
		frappe.flags[SERVICE_FLAG] = previous


def in_masar_service() -> bool:
	return bool(frappe.flags.get(SERVICE_FLAG))


def masar_write(fn):
	"""Guard for state-changing endpoints.

	Frappe validates CSRF only after a token has been generated for the session (lazily, by
	get_csrf_token). Masar writes therefore require that a session token exists AND that the
	request header matches it (Phase 0 finding R-25). Non-HTTP callers (tests, bench execute)
	have no request object and are not subject to CSRF.
	"""

	@wraps(fn)
	def wrapper(*args, **kwargs):
		request = getattr(frappe.local, "request", None)
		if request is None:
			# Tests and bench execute share an outer transaction that must not be rolled back here.
			return fn(*args, **kwargs)
		if request.method != "POST":
			raise frappe.PermissionError("Method not allowed")
		expected = (frappe.session.data or {}).get("csrf_token")
		received = frappe.get_request_header("X-Frappe-CSRF-Token")
		if not expected or not received or received != expected:
			raise frappe.CSRFTokenError("Invalid or missing CSRF token. Reload the application.")
		for attempt in range(1, WRITE_ATTEMPTS + 1):
			try:
				return fn(*args, **kwargs)
			except frappe.QueryDeadlockError:
				# Deadlock (1213) or snapshot conflict (1020): the transaction was aborted, so a fresh
				# attempt is safe. rollback() also drops queued after-commit work (realtime events).
				frappe.db.rollback()
				_reset_request_state()
				if attempt == WRITE_ATTEMPTS:
					_log_retry(fn, attempt, "exhausted")
					raise MasarBusyError(_busy_message()) from None
				_log_retry(fn, attempt, "retrying")
				time.sleep(random.uniform(0.01, 0.04) * attempt)
			except frappe.QueryTimeoutError:
				# Lock wait timeout (1205): another transaction held a lock for the whole wait
				# (innodb_lock_wait_timeout). Retrying would stall the request again; report it instead.
				frappe.db.rollback()
				_log_retry(fn, attempt, "lock-wait-timeout")
				raise MasarBusyError(_busy_message()) from None

	return wrapper


def _reset_request_state():
	"""Forget per-request caches and response fragments from the failed attempt."""
	from masar.permissions import clear_membership_cache

	clear_membership_cache()
	frappe.local.response.pop("conflicts", None)
	frappe.flags[SERVICE_FLAG] = None


def _busy_message() -> str:
	return frappe._(
		"Masar is busy with another change to the same records. Nothing was saved; please try again."
	)


def _log_retry(fn, attempt: int, outcome: str):
	"""Retries are observable in the site log (logs/masar.retry.log). Frappe's loggers default to ERROR
	outside the development server, so the level is set explicitly."""
	logger = frappe.logger("masar.retry")
	logger.setLevel(logging.INFO)
	logger.warning({"method": f"{fn.__module__}.{fn.__name__}", "attempt": attempt, "outcome": outcome})


def concurrent_duplicate():
	"""A unique index rejected our insert, but the winning row is not visible yet: under REPEATABLE
	READ this transaction's snapshot predates the other request's commit. Signal a transient conflict
	so `masar_write` retries from a fresh snapshot, where the caller finds and returns the winner
	(ADR-042). Seen on production with truly parallel web workers."""
	raise frappe.QueryDeadlockError("Concurrent duplicate request; retrying from a fresh snapshot")
