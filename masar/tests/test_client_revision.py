"""Client revision backend: work timer, per-user preferences, Space subset filter and Space icons."""

from datetime import timedelta

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime

from masar.exceptions import MasarConflictError
from masar.permissions import clear_membership_cache
from masar.services import planning_service, space_service, task_service
from masar.services.personal import preference_service, timer_service
from masar.tests.fixtures import as_user, build_world, email, make_space


def _key():
	return f"cr-{frappe.generate_hash(length=16)}"


class ClientRevisionCase(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		frappe.set_user("Administrator")
		frappe.db.delete("Masar Timer Session")  # each test starts without an active timer
		self.S = make_space(f"Timer {frappe.generate_hash(length=8)}", ["a_manager"], ["a_member", "ab_member"])
		clear_membership_cache()
		as_user("a_member")
		self.task = task_service.create(self.S, "Timed work", _key())["task"]["name"]
		self.other = task_service.create(self.S, "Other work", _key())["task"]["name"]

	def tearDown(self):
		frappe.local.response.pop("activeTimer", None)
		frappe.set_user("Administrator")

	def _backdate(self, timer: str, minutes: int):
		started = now_datetime() - timedelta(minutes=minutes)
		frappe.db.set_value("Masar Timer Session", timer, "started_at", started, update_modified=False)


class TestTimer(ClientRevisionCase):
	def test_start_is_idempotent_per_task_and_blocks_a_second_task(self):
		first = timer_service.start(self.task)
		self.assertEqual(timer_service.start(self.task)["name"], first["name"])
		with self.assertRaises(MasarConflictError):
			timer_service.start(self.other)
		self.assertEqual(frappe.local.response["activeTimer"]["task"], self.task)
		self.assertEqual(timer_service.active()["name"], first["name"])

	def test_stop_logs_exactly_one_entry_from_server_time(self):
		timer = timer_service.start(self.task)["name"]
		self._backdate(timer, 95)
		result = timer_service.stop(timer, description="Integration work")
		self.assertTrue(result["logged"])
		self.assertEqual(result["minutes"], 95)
		again = timer_service.stop(timer)
		self.assertFalse(again["logged"])
		entries = frappe.get_all("Masar Time Entry", filters={"task": self.task}, fields=["minutes", "worker"])
		self.assertEqual(entries, [{"minutes": 95, "worker": frappe.session.user}])
		self.assertIsNone(timer_service.active())

	def test_pause_excludes_paused_time(self):
		timer = timer_service.start(self.task)["name"]
		self._backdate(timer, 60)
		timer_service.pause(timer)
		frappe.db.set_value("Masar Timer Session", timer, "paused_at", now_datetime() - timedelta(minutes=20), update_modified=False)
		timer_service.resume(timer)
		self.assertEqual(timer_service.stop(timer)["minutes"], 40)

	def test_short_sessions_log_one_minute_and_overrides_are_bounded(self):
		timer = timer_service.start(self.task)["name"]
		self.assertEqual(timer_service.stop(timer)["minutes"], 1)
		timer = timer_service.start(self.other)["name"]
		self._backdate(timer, 30)
		with self.assertRaises(frappe.ValidationError):
			timer_service.stop(timer, minutes=31)
		self.assertEqual(timer_service.stop(timer, minutes=25)["minutes"], 25)

	def test_more_than_a_day_requires_an_explicit_duration(self):
		timer = timer_service.start(self.task)["name"]
		self._backdate(timer, 26 * 60)
		with self.assertRaises(frappe.ValidationError):
			timer_service.stop(timer)
		self.assertEqual(timer_service.stop(timer, minutes=480)["minutes"], 480)

	def test_only_the_owner_can_see_or_change_a_timer(self):
		timer = timer_service.start(self.task)["name"]
		as_user("ab_member")
		self.assertIsNone(timer_service.active())
		for action in (timer_service.stop, timer_service.pause, timer_service.discard):
			with self.assertRaises(frappe.DoesNotExistError):
				action(timer)

	def test_discard_logs_nothing_and_frees_the_slot(self):
		timer = timer_service.start(self.task)["name"]
		timer_service.discard(timer)
		self.assertEqual(frappe.db.count("Masar Time Entry", {"task": self.task}), 0)
		self.assertEqual(timer_service.start(self.other)["task"], self.other)

	def test_outsiders_and_closed_spaces_cannot_start(self):
		as_user("b_member")
		with self.assertRaises(frappe.DoesNotExistError):
			timer_service.start(self.task)
		as_user("a_manager")
		space_service.set_status(self.S, "Closed")
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			timer_service.start(self.task)

	def test_unique_slot_rejects_a_second_active_row(self):
		timer_service.start(self.task)
		duplicate = frappe.get_doc({
			"doctype": "Masar Timer Session", "task": self.other, "space": self.S, "worker": frappe.session.user,
			"state": "Running", "started_at": now_datetime(),
		})
		with self.assertRaises((frappe.DuplicateEntryError, frappe.UniqueValidationError)):
			duplicate.insert(ignore_permissions=True)


class TestPreferences(ClientRevisionCase):
	def test_theme_and_appearance_are_validated_and_personal(self):
		# Defaults (client revision 3): Violet Workspace and Light.
		self.assertEqual(preference_service.get_preferences()["theme"], "violet")
		self.assertEqual(preference_service.get_preferences()["appearance"], "light")
		preference_service.set_preferences(theme="teal", appearance="dark")
		self.assertEqual(preference_service.get_preferences()["theme"], "teal")
		with self.assertRaises(frappe.ValidationError):
			preference_service.set_preferences(theme="neon")
		as_user("ab_member")
		self.assertEqual(preference_service.get_preferences()["theme"], "violet")

	def test_pins_only_authorised_spaces_and_forget_removed_access(self):
		preference_service.set_preferences(pinned_spaces=[self.S])
		self.assertEqual(preference_service.get_preferences()["pinnedSpaces"], [self.S])
		with self.assertRaises(frappe.PermissionError):
			preference_service.set_preferences(pinned_spaces=[self.world["B"]])
		as_user("a_manager")
		space_service.remove_member(self.S, frappe.db.get_value("User", {"name": ["like", "a_member@%"]}))
		as_user("a_member")
		self.assertEqual(preference_service.get_preferences()["pinnedSpaces"], [])


class TestSpaceSubsetAndIcons(ClientRevisionCase):
	def test_my_work_space_subset_is_limited_to_memberships(self):
		as_user("ab_member")
		rows = task_service.my_work(spaces_filter=[self.S], completed="all")["items"]
		self.assertTrue(rows)
		self.assertEqual({row["space"] for row in rows}, {self.S})
		as_user("a_member")
		with self.assertRaises(frappe.DoesNotExistError):
			task_service.my_work(spaces_filter=[self.S, self.world["B"]])

	def test_managers_set_valid_icons_members_cannot(self):
		as_user("a_manager")
		detail = space_service.update_details(self.S, {"icon": "shopping-bag", "iconColor": "rose"})
		self.assertEqual((detail["icon"], detail["iconColor"]), ("shopping-bag", "rose"))
		with self.assertRaises(frappe.ValidationError):
			space_service.update_details(self.S, {"icon": "not-an-icon"})
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			space_service.update_details(self.S, {"icon": "globe"})


	def test_roadmap_cards_list_the_people_on_open_tasks(self):
		as_user("a_manager")
		feature = planning_service.create_feature(self.S, "Checkout", "Now")["name"]
		as_user("a_member")
		for task, person in ((self.task, "a_member"), (self.other, "ab_member")):
			task_service.update(task, {"feature": feature})
			task_service.add_assignee(task, email(person))
		task_service.set_completed(self.other, True)
		card = next(row for row in planning_service.list_features(self.S)["items"] if row["name"] == feature)
		# Only people on open Tasks appear: the completed Task's assignee does not.
		self.assertEqual([person["name"] for person in card["people"]], [email("a_member")])
