"""Phase 7: time entries, corrections, voids, remaining estimates and the Worklog (real authorization)."""

import json
from datetime import UTC, datetime
from unittest.mock import patch

import frappe
import frappe.client
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, convert_utc_to_system_timezone, get_system_timezone, nowdate

from masar.exceptions import MasarConflictError, MasarRequestReuseError
from masar.permissions import clear_membership_cache
from masar.services import batch_service, space_service, task_service, time_service, timeline_service
from masar.tests.fixtures import as_user, build_world, email, make_space


def _key():
	return f"t-{frappe.generate_hash(length=16)}"


class TimeCase(IntegrationTestCase):
	"""A fresh Space per test: a_manager (M), a_member, ab_member. b_member is an outsider."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		frappe.set_user("Administrator")
		self.S = make_space(
			f"Time {frappe.generate_hash(length=8)}", ["a_manager"], ["a_member", "ab_member"]
		)
		clear_membership_cache()
		as_user("a_member")
		self.task = task_service.create(self.S, "Effort", _key())["task"]["name"]

	def tearDown(self):
		frappe.local.response.pop("conflicts", None)
		frappe.set_user("Administrator")

	def log(self, duration="1h 30m", **kw):
		return time_service.log_time(self.task, duration, kw.pop("key", None) or _key(), **kw)


class TestDurations(TimeCase):
	def test_parsing_and_bounds(self):
		cases = {
			"30m": 30,
			"1h": 60,
			"1h 30m": 90,
			"1h30m": 90,
			"90m": 90,
			"90": 90,
			"1.5h": 90,
			"0.25h": 15,
			"2:15": 135,
			" 2H 5M ": 125,
			45: 45,
			"24h": 1440,
		}
		for value, minutes in cases.items():
			self.assertEqual(time_service.parse_duration(value), minutes, value)
		for bad in (
			"",
			"0",
			"0m",
			"-5m",
			"1.33h",
			"abc",
			"1d",
			"nan",
			"1e3m",
			"24h 1m",
			"99999999999",
			True,
			"1h 60x",
		):
			with self.assertRaises(frappe.ValidationError, msg=repr(bad)):
				time_service.parse_duration(bad)
		self.assertIsNone(time_service.parse_estimate(""))
		self.assertEqual(time_service.parse_estimate("0"), 0)
		self.assertEqual(time_service.parse_estimate("40h"), 2400)  # estimates may exceed a day


class TestModel(TimeCase):
	def test_model_rejects_invalid_minutes_and_foreign_spaces(self):
		frappe.set_user("Administrator")  # even with full rights the DocType guards its invariants
		base = {
			"doctype": "Masar Time Entry",
			"task": self.task,
			"space": self.S,
			"worker": email("a_member"),
			"work_date": nowdate(),
		}
		for minutes in (0, -10, 1441):
			with self.assertRaises(frappe.ValidationError, msg=minutes):
				frappe.get_doc({**base, "minutes": minutes}).insert()
		other = make_space(f"Other {frappe.generate_hash(length=6)}", ["a_manager"], [])
		with self.assertRaises(frappe.ValidationError):  # the Task's Space, never another
			frappe.get_doc({**base, "minutes": 30, "space": other}).insert()
		saved = frappe.get_doc({**base, "minutes": "45"}).insert()
		self.assertEqual(frappe.db.get_value("Masar Time Entry", saved.name, "minutes"), 45)  # integer
		with self.assertRaises(frappe.ValidationError):  # every entry belongs to a real Task
			frappe.get_doc({**base, "task": "does-not-exist", "minutes": 30}).insert()

	def test_qatar_business_date(self):
		self.assertEqual(get_system_timezone(), "Asia/Qatar")
		# 22:30 UTC is already the next day in Qatar (UTC+3): the business date follows Qatar.
		late_utc = datetime(2026, 10, 27, 22, 30, tzinfo=UTC)
		self.assertEqual(str(convert_utc_to_system_timezone(late_utc).date()), "2026-10-28")
		self.assertEqual(self.log("10m")["entry"]["workDate"], nowdate())  # default = Qatar today
		with patch.object(time_service, "nowdate", return_value="2026-10-28"):
			self.assertEqual(self.log("10m")["entry"]["workDate"], "2026-10-28")
			with self.assertRaises(frappe.ValidationError):  # a browser-local "today" ahead of Qatar
				self.log("10m", work_date="2026-10-29")


class TestLogging(TimeCase):
	def test_A_B_log_persist_attribute_and_total(self):
		result = self.log("1h 30m", description="Wrote the importer")
		entry = result["entry"]
		self.assertEqual(
			(entry["minutes"], entry["workDate"], entry["worker"]["name"]), (90, nowdate(), email("a_member"))
		)
		self.assertEqual(result["task"]["loggedMinutes"], 90)
		self.assertEqual(frappe.db.get_value("Masar Time Entry", entry["name"], "space"), self.S)
		self.assertEqual(time_service.get_entry(entry["name"])["description"], "Wrote the importer")

	def test_C_multiple_people_sum_in_integer_minutes(self):
		self.log("45m")
		as_user("ab_member")
		self.log("1.5h")
		self.log("1m")
		self.assertEqual(time_service.summary(self.task)["loggedMinutes"], 136)

	def test_work_dates(self):
		yesterday = add_days(nowdate(), -1)
		self.assertEqual(self.log("1h", work_date=yesterday)["entry"]["workDate"], str(yesterday))
		self.assertEqual(
			self.log("1h", work_date="2019-01-31")["entry"]["workDate"], "2019-01-31"
		)  # no cutoff
		with self.assertRaises(frappe.ValidationError):
			self.log("1h", work_date=add_days(nowdate(), 1))
		with self.assertRaises(frappe.ValidationError):
			self.log("1h", work_date="not-a-date")

	def test_I_idempotent_create_and_key_reuse(self):
		key = _key()
		first = self.log("2h", key=key)
		again = self.log("2h", key=key)  # lost response, repeated
		self.assertEqual((first["created"], again["created"]), (True, False))
		self.assertEqual(first["entry"]["name"], again["entry"]["name"])
		self.assertEqual(time_service.summary(self.task)["loggedMinutes"], 120)  # not 240
		with self.assertRaises(MasarRequestReuseError):
			self.log("3h", key=key)
		other = task_service.create(self.S, "Other", _key())["task"]["name"]
		with self.assertRaises(MasarRequestReuseError):
			time_service.log_time(other, "2h", key)
		self.assertEqual(
			frappe.db.count("Masar Time Entry", {"client_request_id": key}),
			1,
		)
		history = frappe.get_all(
			"Masar Activity", filters={"reference_name": self.task, "event": "time_logged"}, pluck="name"
		)
		self.assertEqual(len(history), 1)

	def test_concurrent_creation_with_an_invisible_winner(self):
		from types import SimpleNamespace

		from masar.tests.test_concurrency import http_write
		from masar.utils import context

		key = _key()
		real_find = time_service._find_created
		calls = SimpleNamespace(n=0)

		def find_late(*args):
			# Before insert: nothing. After the unique violation: the winner is not yet visible in this
			# snapshot. After the retry from a fresh snapshot: visible.
			calls.n += 1
			return None if calls.n <= 2 else real_find(*args)

		winner = self.log("1h", key=key)["entry"]["name"]
		with http_write() as retry, patch.object(time_service, "_find_created", side_effect=find_late):
			result = context.masar_write(lambda: self.log("1h", key=key))()
		self.assertEqual((result["entry"]["name"], result["created"]), (winner, False))
		self.assertEqual(retry.sleeps, 1)
		self.assertEqual(frappe.db.count("Masar Time Entry", {"client_request_id": key}), 1)
		self.assertEqual(time_service.summary(self.task)["loggedMinutes"], 60)

	def test_D_estimate_with_logging_is_atomic_and_never_auto_decrements(self):
		task_service.update(self.task, {"remainingMinutes": 300})
		result = self.log("1h")
		self.assertEqual(result["task"]["remainingMinutes"], 300)  # logging never subtracts
		result = self.log("30m", remaining="2h", set_remaining=True, base_remaining="300")
		self.assertEqual((result["task"]["remainingMinutes"], result["task"]["loggedMinutes"]), (120, 90))
		self.assertFalse(result["task"]["isCompleted"])
		result = self.log("15m", remaining="0", set_remaining=True, base_remaining="120")
		self.assertEqual(result["task"]["remainingMinutes"], 0)
		self.assertFalse(result["task"]["isCompleted"])  # zero remaining does not complete the Task
		# Stale estimate: the whole operation fails, nothing is logged.
		with self.assertRaises(MasarConflictError):
			self.log("45m", remaining="1h", set_remaining=True, base_remaining="300")
		self.assertEqual(time_service.summary(self.task)["loggedMinutes"], 105)
		cleared = self.log("5m", remaining="", set_remaining=True, base_remaining="0")
		self.assertIsNone(cleared["task"]["remainingMinutes"])
		changes = frappe.get_all(
			"Masar Activity", filters={"reference_name": self.task, "event": "field_changed"}, pluck="data"
		)
		self.assertTrue(any('"remaining_minutes"' in c and '"to": null' in c for c in changes))  # cleared

	def test_J_concurrent_estimate_updates_conflict(self):
		task_service.update(self.task, {"remainingMinutes": 600})
		as_user("ab_member")
		task_service.update(self.task, {"remainingMinutes": 480}, base={"remainingMinutes": 600})
		as_user("a_member")
		with self.assertRaises(MasarConflictError):
			task_service.update(self.task, {"remainingMinutes": 300}, base={"remainingMinutes": 600})
		self.assertEqual(frappe.db.get_value("Masar Task", self.task, "remaining_minutes"), 480)


class TestCorrections(TimeCase):
	def test_E_author_corrects_with_history_and_conflicts(self):
		entry = self.log("1h")["entry"]
		updated = time_service.update_entry(
			entry["name"], {"duration": "1h 45m", "description": "Fixed"}, entry["modified"]
		)
		self.assertEqual((updated["entry"]["minutes"], updated["task"]["loggedMinutes"]), (105, 105))
		self.assertIsNotNone(updated["entry"]["editedAt"])
		with self.assertRaises(MasarConflictError):
			time_service.update_entry(entry["name"], {"duration": "2h"}, entry["modified"])
		audit = json.loads(
			frappe.get_all(
				"Masar Activity", filters={"reference_name": self.task, "event": "time_edited"}, pluck="data"
			)[0]
		)
		self.assertEqual((audit["from"]["minutes"], audit["to"]["minutes"]), (60, 105))
		as_user("ab_member")
		with self.assertRaises(frappe.PermissionError):  # never another person's time
			time_service.update_entry(entry["name"], {"duration": "10m"})
		as_user("a_manager")
		with self.assertRaises(frappe.PermissionError):  # Managers void, they do not rewrite
			time_service.update_entry(entry["name"], {"duration": "10m"})
		with self.assertRaises(frappe.ValidationError):
			time_service.update_entry(entry["name"], {"worker": email("a_manager")})

	def test_F_void_stops_counting_and_keeps_evidence(self):
		mine = self.log("2h")["entry"]
		as_user("ab_member")
		theirs = self.log("1h")["entry"]
		with self.assertRaises(frappe.PermissionError):  # a Member cannot void others' time
			time_service.void_entry(mine["name"], "wrong")
		result = time_service.void_entry(theirs["name"])
		self.assertEqual(result["task"]["loggedMinutes"], 120)
		self.assertTrue(result["entry"]["isVoided"])
		self.assertEqual(
			time_service.void_entry(theirs["name"])["task"]["loggedMinutes"], 120
		)  # repeat: no-op
		with self.assertRaises(frappe.PermissionError):
			time_service.update_entry(theirs["name"], {"duration": "5m"})
		as_user("a_manager")
		with self.assertRaises(frappe.ValidationError):  # moderation needs a reason
			time_service.void_entry(mine["name"])
		moderated = time_service.void_entry(mine["name"], "Logged on the wrong task")
		self.assertEqual(moderated["task"]["loggedMinutes"], 0)
		self.assertEqual(
			(moderated["entry"]["voidedBy"]["name"], moderated["entry"]["worker"]["name"]),
			(email("a_manager"), email("a_member")),
		)
		self.assertTrue(frappe.db.exists("Masar Time Entry", mine["name"]))  # not deleted

	def test_edit_racing_void(self):
		entry = self.log("1h")["entry"]
		time_service.void_entry(entry["name"])
		with self.assertRaises(frappe.PermissionError):
			time_service.update_entry(entry["name"], {"duration": "2h"}, entry["modified"])
		self.assertEqual(time_service.summary(self.task)["loggedMinutes"], 0)


class TestTimeAuthorization(TimeCase):
	def test_G_outsiders_and_generic_apis(self):
		entry = self.log("1h")["entry"]["name"]
		as_user("b_member")
		for call in (
			lambda: time_service.get_entry(entry),
			lambda: time_service.summary(self.task),
			lambda: time_service.log_time(self.task, "1h", _key()),
			lambda: time_service.update_entry(entry, {"duration": "2h"}),
			lambda: time_service.void_entry(entry, "x"),
			lambda: timeline_service.timeline(self.task, "worklog"),
		):
			with self.assertRaises(frappe.DoesNotExistError):
				call()
		self.assertNotIn(entry, frappe.get_list("Masar Time Entry", pluck="name", limit_page_length=0))
		with self.assertRaises(frappe.PermissionError):
			frappe.client.get("Masar Time Entry", entry)
		from frappe.desk.search import search_link

		self.assertNotIn(entry, [r["value"] for r in search_link("Masar Time Entry", "")])
		as_user("a_member")  # members cannot bypass the service either
		for call in (
			lambda: frappe.client.set_value("Masar Time Entry", entry, "minutes", 600),
			lambda: frappe.client.insert(
				{
					"doctype": "Masar Time Entry",
					"task": self.task,
					"space": self.S,
					"worker": email("a_manager"),
					"work_date": nowdate(),
					"minutes": 60,
				}
			),
			lambda: frappe.client.delete("Masar Time Entry", entry),
		):
			with self.assertRaises(frappe.PermissionError):
				call()
		self.assertEqual(frappe.db.get_value("Masar Time Entry", entry, "minutes"), 60)

	def test_H_revoked_member_keeps_attribution_loses_access(self):
		entry = self.log("3h")["entry"]["name"]
		frappe.set_user("Administrator")
		space = frappe.get_doc("Masar Space", self.S)
		space.set("members", [m for m in space.members if m.user != email("a_member")])
		space.save(ignore_permissions=True)
		clear_membership_cache()
		as_user("a_member")
		for call in (
			lambda: time_service.get_entry(entry),
			lambda: time_service.update_entry(entry, {"duration": "1h"}),
			lambda: time_service.void_entry(entry),
			lambda: time_service.log_time(self.task, "1h", _key()),
		):
			with self.assertRaises(frappe.DoesNotExistError):
				call()
		as_user("a_manager")
		kept = time_service.get_entry(entry)
		self.assertEqual((kept["worker"]["name"], kept["minutes"]), (email("a_member"), 180))
		self.assertEqual(time_service.summary(self.task)["loggedMinutes"], 180)

	def test_lifecycle_and_completed_tasks(self):
		task_service.set_completed(self.task, True)
		self.assertEqual(self.log("1h")["task"]["isCompleted"], True)  # allowed; completion unchanged
		as_user("a_manager")
		space_service.set_status(self.S, "Completed")
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			self.log("1h")
		as_user("a_manager")
		time_service.log_time(self.task, "30m", _key())  # Manager wrap-up allowed
		space_service.set_status(self.S, "Closed")
		with self.assertRaises(frappe.PermissionError):
			time_service.log_time(self.task, "30m", _key())

	def test_deleted_task(self):
		entry = self.log("1h")["entry"]["name"]
		task_service.delete(self.task)
		self.assertFalse(frappe.db.exists("Masar Time Entry", entry))
		with self.assertRaises(frappe.DoesNotExistError):
			time_service.log_time(self.task, "1h", _key())


class TestWorklogAndInvariants(TimeCase):
	def test_K_timeline_has_each_entry_once(self):
		from masar.services import comment_service

		self.log("1h")
		comment_service.create(self.task, "<p>note</p>", _key())
		self.log("2h")
		all_items = timeline_service.timeline(self.task, "all", limit=50)["items"]
		kinds = [i["kind"] for i in all_items]
		self.assertEqual(kinds.count("time"), 2)
		self.assertNotIn("time_logged", [i["history"]["event"] for i in all_items if i["kind"] == "history"])
		worklog = timeline_service.timeline(self.task, "worklog", limit=50)
		self.assertEqual([i["entry"]["minutes"] for i in worklog["items"]], [60, 120])
		self.assertTrue(worklog["worklogAvailable"])

	def test_pagination_over_many_entries(self):
		for i in range(45):
			self.log(f"{i + 1}m")
		page = timeline_service.timeline(self.task, "worklog", limit=20)
		seen = [i["id"] for i in page["items"]]
		while page["earlierCursor"]:
			page = timeline_service.timeline(self.task, "worklog", before=page["earlierCursor"], limit=20)
			seen = [i["id"] for i in page["items"]] + seen
		self.assertEqual(len(seen), 45)
		self.assertEqual(len(set(seen)), 45)
		self.assertEqual(time_service.summary(self.task)["loggedMinutes"], sum(range(1, 46)))

	def test_activity_records_match_entries(self):
		first = self.log("1h")["entry"]
		second = self.log("2h")["entry"]
		time_service.update_entry(first["name"], {"duration": "90m"})
		time_service.update_entry(first["name"], {"description": "note only"})
		time_service.void_entry(second["name"], "duplicate")
		time_service.void_entry(second["name"], "duplicate")  # repeat: no new record
		events = frappe.get_all(
			"Masar Activity",
			filters={"reference_name": self.task, "event": ["like", "time_%"]},
			fields=["event", "data", "owner"],
			order_by="creation asc",
		)
		self.assertEqual(
			[e.event for e in events],
			["time_logged", "time_logged", "time_edited", "time_edited", "time_voided"],
		)
		logged = {json.loads(e.data)["entry"] for e in events if e.event == "time_logged"}
		self.assertEqual(logged, {first["name"], second["name"]})
		self.assertTrue(all(e.owner == email("a_member") for e in events))
		note_only = json.loads(events[3].data)
		self.assertTrue(note_only["noteChanged"])
		self.assertEqual(note_only["from"]["minutes"], note_only["to"]["minutes"])
		self.assertEqual(time_service.summary(self.task)["loggedMinutes"], 90)

	def test_L_M_no_effect_on_completion_planning_or_batch_snapshots(self):
		from masar.services import planning_service

		as_user("a_manager")
		feature = planning_service.create_feature(self.S, "F", "Now")["name"]
		task_service.update(self.task, {"feature": feature})
		batch = batch_service.create_batch("Effort batch", nowdate(), preset="one_week")["batch"]["name"]
		batch_service.move_tasks([self.task], batch)
		batch_service.start_batch(batch)
		task_service.set_completed(self.task, True)
		batch_service.finish_batch(batch, "Unbatched", None, _key())
		before = batch_service.get_batch(batch)["progress"]
		entry = time_service.log_time(self.task, "2h", _key())["entry"]
		time_service.update_entry(entry["name"], {"duration": "3h"})
		time_service.void_entry(entry["name"])
		task = task_service.get_detail(self.task)
		self.assertEqual((task["isCompleted"], task["priority"]), (True, "Medium"))
		self.assertEqual(frappe.db.get_value("Masar Feature", feature, "roadmap"), "Now")
		self.assertEqual(batch_service.get_batch(batch)["progress"], before)


class TestReleaseIdentity(IntegrationTestCase):
	def test_version_lists_every_api_method_without_prior_imports(self):
		import sys

		from masar.api import session

		# Simulate a fresh worker: no Masar API module imported or whitelisted except session.
		saved_modules = {m: sys.modules[m] for m in list(sys.modules) if m.startswith("masar.api.")}
		saved_whitelist = set(frappe.whitelisted)
		try:
			for name in saved_modules:
				if name != "masar.api.session":
					del sys.modules[name]
			frappe.whitelisted.difference_update(
				fn
				for fn in saved_whitelist
				if getattr(fn, "__module__", "").startswith("masar.api.")
				and fn.__module__ != "masar.api.session"
			)
			methods = set(session.version()["apiMethods"])
		finally:
			sys.modules.update(saved_modules)
			frappe.whitelisted.update(saved_whitelist)
		for expected in ("masar.api.time.log", "masar.api.tasks.update", "masar.api.comments.timeline"):
			self.assertIn(expected, methods)
