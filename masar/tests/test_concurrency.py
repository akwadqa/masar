"""Phase 5 transaction-retry audit (ADR-041, ADR-042): classification, bounded retries, exactly-once
effects and idempotency keys. Real database writes; the request rollback is simulated with a savepoint
so the test transaction survives."""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from masar.exceptions import MasarBusyError, MasarConflictError, MasarRequestReuseError
from masar.services import planning_service, task_service
from masar.services.activity import record_activity
from masar.tests.fixtures import as_user, build_world
from masar.utils import context


@contextmanager
def http_write():
	"""Run masar_write as for an HTTP POST; `rollback()` returns to a savepoint taken here."""
	frappe.local.request = SimpleNamespace(method="POST")
	frappe.session.data = frappe._dict(csrf_token="token")
	frappe.db.savepoint("retry_test")
	calls = SimpleNamespace(rollbacks=0, sleeps=0)
	original_rollback = frappe.db.rollback

	def rollback(*args, **kwargs):
		calls.rollbacks += 1
		original_rollback(save_point="retry_test")

	try:
		with (
			patch.object(frappe, "get_request_header", return_value="token"),
			patch.object(context.frappe.db, "rollback", side_effect=rollback),
			patch.object(
				context.time, "sleep", side_effect=lambda *_: setattr(calls, "sleeps", calls.sleeps + 1)
			),
		):
			yield calls
	finally:
		del frappe.local.request


class TestRetryPolicy(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		as_user("a_manager")

	def tearDown(self):
		frappe.set_user("Administrator")

	def _attempts(self, error):
		attempts = []

		def fn():
			attempts.append(1)
			raise error

		return attempts, fn

	def test_transient_conflict_is_retried_and_effects_happen_once(self):
		task = task_service.create(self.world["A"], "Retry once", "retry-once-0001")["task"]["name"]
		doc = frappe.get_doc("Masar Task", task)
		attempts = []

		def flaky():
			attempts.append(1)
			record_activity(doc, "field_changed", {"field": "probe"})
			if len(attempts) < 3:
				raise frappe.QueryDeadlockError("1020 Record has changed since last read")
			return "ok"

		with http_write() as calls:
			self.assertEqual(context.masar_write(flaky)(), "ok")
		self.assertEqual((len(attempts), calls.rollbacks, calls.sleeps), (3, 2, 2))
		probes = frappe.get_all(
			"Masar Activity", filters={"reference_name": task, "data": ["like", '%"probe"%']}, pluck="name"
		)
		self.assertEqual(len(probes), 1)  # the two aborted attempts left nothing behind

	def test_retries_are_bounded_and_reported_as_busy(self):
		attempts, fn = self._attempts(frappe.QueryDeadlockError("1213 deadlock"))
		with http_write(), self.assertRaises(MasarBusyError) as caught:
			context.masar_write(fn)()
		self.assertEqual(len(attempts), context.WRITE_ATTEMPTS)
		self.assertEqual(caught.exception.http_status_code, 503)

	def test_lock_wait_timeout_is_not_retried(self):
		attempts, fn = self._attempts(frappe.QueryTimeoutError("1205 lock wait timeout"))
		with http_write() as calls, self.assertRaises(MasarBusyError):
			context.masar_write(fn)()
		self.assertEqual((len(attempts), calls.sleeps), (1, 0))

	def test_authorization_validation_and_stale_writes_are_not_retried(self):
		for error in (
			frappe.PermissionError("no"),
			frappe.DoesNotExistError("missing"),
			frappe.ValidationError("bad input"),
			MasarConflictError("stale"),
		):
			attempts, fn = self._attempts(error)
			with http_write() as calls, self.assertRaises(type(error)):
				context.masar_write(fn)()
			self.assertEqual((len(attempts), calls.rollbacks), (1, 0), type(error).__name__)

	def test_stale_write_still_conflicts_after_a_retry(self):
		"""A retry re-runs the optimistic check: it can never overwrite a newer value."""
		task = task_service.create(self.world["A"], "Stale retry", "retry-stale-0001")["task"]["name"]
		task_service.update(task, {"priority": "High"})
		attempts = []

		def write():
			attempts.append(1)
			if len(attempts) == 1:
				raise frappe.QueryDeadlockError("1020")
			return task_service.update(task, {"priority": "Low"}, base={"priority": "Medium"})

		with http_write(), self.assertRaises(MasarConflictError):
			context.masar_write(write)()
		self.assertEqual(frappe.db.get_value("Masar Task", task, "priority"), "High")

	def test_non_http_callers_are_never_retried(self):
		attempts, fn = self._attempts(frappe.QueryDeadlockError("1213"))
		with self.assertRaises(frappe.QueryDeadlockError):
			context.masar_write(fn)()
		self.assertEqual(len(attempts), 1)


class TestIdempotencyKeys(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		as_user("ab_member")

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_repeated_request_after_lost_response_returns_the_same_task(self):
		first = task_service.create(self.world["A"], "Lost response", "lost-response-0001")
		again = task_service.create(self.world["A"], " Lost   response ", "lost-response-0001")
		self.assertTrue(first["created"])
		self.assertFalse(again["created"])
		self.assertEqual(first["task"]["name"], again["task"]["name"])
		self.assertEqual(frappe.db.count("Masar Task", {"client_request_id": "lost-response-0001"}), 1)

	def test_key_reused_for_another_resource_is_rejected(self):
		task_service.create(self.world["A"], "Original", "reused-key-0001")
		with self.assertRaises(MasarRequestReuseError):
			task_service.create(self.world["B"], "Original", "reused-key-0001")
		with self.assertRaises(MasarRequestReuseError):
			task_service.create(self.world["A"], "Something else", "reused-key-0001")
		self.assertEqual(frappe.db.count("Masar Task", {"client_request_id": "reused-key-0001"}), 1)

	def test_feature_creation_is_idempotent_per_request(self):
		as_user("a_manager")
		first = planning_service.create_feature(
			self.world["A"], "Idempotent feature", client_request_id="feature-key-0001"
		)
		again = planning_service.create_feature(
			self.world["A"], " Idempotent   feature ", client_request_id="feature-key-0001"
		)
		self.assertEqual((first["created"], again["created"]), (True, False))
		self.assertEqual(first["name"], again["name"])
		self.assertEqual(frappe.db.count("Masar Feature", {"client_request_id": "feature-key-0001"}), 1)
		with self.assertRaises(MasarRequestReuseError):
			planning_service.create_feature(
				self.world["A"], "Another feature", client_request_id="feature-key-0001"
			)
		other = planning_service.create_feature(
			self.world["A"], "Idempotent feature", client_request_id="feature-key-0002"
		)
		self.assertNotEqual(other["name"], first["name"])  # a new request may create a same-titled Feature
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):  # the key never bypasses authority
			planning_service.create_feature(
				self.world["A"], "Idempotent feature", client_request_id="feature-key-0001"
			)


class TestConcurrentDuplicates(IntegrationTestCase):
	"""The losing request of a simultaneous duplicate create is retried and answered with the winner."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_invisible_winner_is_retried_then_returned(self):
		from masar.services import comment_service

		as_user("a_manager")
		task = task_service.create(self.world["A"], "Race target", "race-target-0001")["task"]["name"]
		real_find = comment_service._find_created
		calls = {"n": 0}

		def find_late(key, task_name):
			# 1st lookup (before insert): nothing yet. 2nd (after the unique violation): the winner is
			# committed but not visible in this snapshot. After the retry: visible.
			calls["n"] += 1
			return None if calls["n"] <= 2 else real_find(key, task_name)

		winner = comment_service.create(task, "<p>race</p>", "race-key-00000001")["comment"]["name"]
		with http_write() as retry, patch.object(comment_service, "_find_created", side_effect=find_late):
			result = context.masar_write(
				lambda: comment_service.create(task, "<p>race</p>", "race-key-00000001")
			)()
		self.assertEqual((result["comment"]["name"], result["created"]), (winner, False))
		self.assertEqual(retry.sleeps, 1)  # exactly one retry from a fresh snapshot
		self.assertEqual(frappe.db.count("Masar Comment", {"client_request_id": "race-key-00000001"}), 1)
