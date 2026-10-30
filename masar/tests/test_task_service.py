"""Task workflows: idempotent creation, field-scoped conflicts, keyset pagination, filters."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from masar.exceptions import MasarConflictError
from masar.services import task_service
from masar.tests.fixtures import as_user, build_world, email, unassigned_task


class TestTaskService(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		as_user("a_member")

	def tearDown(self):
		frappe.local.response.pop("conflicts", None)
		frappe.set_user("Administrator")

	def test_create_is_idempotent_per_user_and_request_id(self):
		first = task_service.create(self.world["A"], "Fix login timeout", "idem-0000-0001")
		again = task_service.create(self.world["A"], "Fix login timeout", "idem-0000-0001")
		self.assertTrue(first["created"])
		self.assertFalse(again["created"])
		self.assertEqual(first["task"]["name"], again["task"]["name"])
		self.assertEqual(frappe.db.count("Masar Task", {"client_request_id": "idem-0000-0001"}), 1)
		# The same id from another user is a different draft.
		as_user("ab_member")
		other = task_service.create(self.world["A"], "Fix login timeout", "idem-0000-0001")
		self.assertTrue(other["created"])
		self.assertNotEqual(other["task"]["name"], first["task"]["name"])

	def test_duplicate_insert_race_returns_existing_task(self):
		first = task_service.create(self.world["A"], "Race", "idem-race-0001")["task"]["name"]
		# First lookup misses (as if a concurrent request had not committed yet); the insert then
		# hits the unique index and the service must return the existing task.
		with patch.object(task_service, "_find_by_request", side_effect=[None, first]):
			result = task_service.create(self.world["A"], "Race", "idem-race-0001")
		self.assertFalse(result["created"])
		self.assertEqual(result["task"]["name"], first)

	def test_empty_title_and_bad_request_id_are_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			task_service.create(self.world["A"], "   ", "idem-empty-0001")
		with self.assertRaises(frappe.ValidationError):
			task_service.create(self.world["A"], "ok", "bad id!")
		self.assertFalse(frappe.db.exists("Masar Task", {"client_request_id": "idem-empty-0001"}))

	def test_same_field_conflict_is_detected(self):
		name = task_service.create(self.world["A"], "Original", "conf-0000-0001")["task"]["name"]
		as_user("ab_member")
		task_service.update(name, {"title": "Theirs"}, {"title": "Original"})
		as_user("a_member")
		with self.assertRaises(MasarConflictError):
			task_service.update(name, {"title": "Mine"}, {"title": "Original"})
		self.assertEqual(frappe.local.response["conflicts"][0]["field"], "title")
		self.assertEqual(frappe.db.get_value("Masar Task", name, "title"), "Theirs")

	def test_different_field_edits_do_not_conflict(self):
		name = task_service.create(self.world["A"], "Original", "conf-0000-0002")["task"]["name"]
		as_user("ab_member")
		task_service.update(name, {"title": "Theirs"}, {"title": "Original"})
		as_user("a_member")
		detail = task_service.update(name, {"priority": "High"}, {"priority": "Medium"})
		self.assertEqual((detail["title"], detail["priority"]), ("Theirs", "High"))

	def test_unknown_or_protected_fields_are_rejected(self):
		name = task_service.create(self.world["A"], "Protected", "prot-0000-0001")["task"]["name"]
		for changes in ({"space": self.world["B"]}, {"completedBy": email("a_member")}, {"loggedMinutes": 5}):
			with self.assertRaises(frappe.ValidationError):
				task_service.update(name, changes)

	def test_keyset_pagination_returns_every_task_once(self):
		as_user("b_member")
		created = {
			task_service.create(self.world["B"], f"Page {i}", f"page-0000-{i:04d}")["task"]["name"]
			for i in range(7)
		}
		seen, cursor = [], None
		for _ in range(10):
			page = task_service.list_tasks(self.world["B"], limit=3, cursor=cursor)
			seen.extend(item["name"] for item in page["items"])
			cursor = page["nextCursor"]
			if not cursor:
				break
		self.assertEqual(len(seen), len(set(seen)))
		self.assertTrue(created.issubset(set(seen)))

	def test_filters_assigned_owned_and_completed(self):
		mine = unassigned_task(self.world["A"], "Mine", "filt-0000-0001")
		not_mine = unassigned_task(self.world["A"], "Not mine", "filt-0000-0002")
		task_service.add_assignee(mine, email("a_member"))
		# Other tests of this class leave Tasks a_member created (and so owns): look at these two only.
		assigned = {t["name"] for t in task_service.list_tasks(self.world["A"], assigned_to_me=True)["items"]}
		self.assertIn(mine, assigned)
		self.assertNotIn(not_mine, assigned)
		owned = {t["name"] for t in task_service.list_tasks(self.world["A"], owned_by_me=True)["items"]}
		self.assertIn(mine, owned)
		self.assertNotIn(not_mine, owned)
		task_service.set_completed(mine, True)
		open_names = {t["name"] for t in task_service.list_tasks(self.world["A"], completed="open")["items"]}
		self.assertNotIn(mine, open_names)

	def test_list_query_count_is_constant(self):
		for i in range(5):
			name = task_service.create(self.world["A"], f"Q {i}", f"qcount-000-{i:04d}")["task"]["name"]
			task_service.add_assignee(name, email("a_member"))
		with self.assertQueryCount(8):
			task_service.list_tasks(self.world["A"], limit=50)

	def test_datetimes_carry_the_site_utc_offset(self):
		from datetime import datetime

		detail = task_service.create(self.world["A"], "Offsets", "tz-0000-0001")["task"]
		parsed = datetime.fromisoformat(detail["creation"])
		self.assertIsNotNone(parsed.tzinfo)
		self.assertIsNotNone(datetime.fromisoformat(detail["modified"]).tzinfo)


class TestTimezoneSerialisation(IntegrationTestCase):
	"""Business time is Asia/Qatar (UTC+03:00, no DST). Naive stored datetimes are site-local."""

	def test_naive_datetimes_get_the_site_offset_and_dates_stay_dates(self):
		from masar.services import serializers

		with patch.object(serializers, "get_system_timezone", return_value="Asia/Qatar"):
			self.assertEqual(serializers.iso_datetime("2026-10-28 23:30:00"), "2026-10-28T23:30:00+03:00")
			self.assertEqual(serializers.iso_datetime("2026-06-15 08:00:00"), "2026-06-15T08:00:00+03:00")
		self.assertEqual(serializers.iso_date("2026-12-31"), "2026-12-31")
		self.assertIsNone(serializers.iso_datetime(None))
