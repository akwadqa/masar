"""Client revision 2: Task statuses, automatic Overdue, Markdown descriptions and new list filters."""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, getdate, nowdate

from masar.permissions import clear_membership_cache
from masar.services import planning_service, task_service
from masar.tests.fixtures import as_user, build_world, email, make_space, unassigned_task


def _key():
	return f"st-{frappe.generate_hash(length=16)}"


class TaskStatusCase(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		frappe.set_user("Administrator")
		self.S = make_space(f"Status {frappe.generate_hash(length=8)}", ["a_manager"], ["a_member", "ab_member"])
		clear_membership_cache()
		as_user("a_member")
		self.task = task_service.create(self.S, "Status work", _key())["task"]["name"]

	def tearDown(self):
		frappe.set_user("Administrator")

	def _status(self, name=None):
		return frappe.db.get_value("Masar Task", name or self.task, ["status", "is_completed"])


class TestStatuses(TaskStatusCase):
	def test_new_tasks_are_open_and_statuses_drive_completion(self):
		self.assertEqual(self._status(), ("Open", 0))
		for status, finished in (("Working", 0), ("Pending Review", 0), ("Changes Required", 0), ("Closed", 1), ("Cancelled", 1), ("Completed", 1)):
			detail = task_service.update(self.task, {"status": status})
			self.assertEqual((detail["status"], detail["isCompleted"]), (status, bool(finished)))
		self.assertIsNotNone(frappe.db.get_value("Masar Task", self.task, "completed_at"))

	def test_overdue_cannot_be_set_by_people(self):
		with self.assertRaises(frappe.ValidationError):
			task_service.update(self.task, {"status": "Overdue"})
		with self.assertRaises(frappe.ValidationError):
			task_service.update(self.task, {"status": "Done"})
		with self.assertRaises(frappe.ValidationError):
			task_service.bulk_update([self.task], "set_status", "Overdue")

	def test_set_completed_maps_to_completed_and_open(self):
		task_service.set_completed(self.task, True)
		self.assertEqual(self._status(), ("Completed", 1))
		task_service.set_completed(self.task, False)
		self.assertEqual(self._status(), ("Open", 0))

	def test_bulk_set_status(self):
		other = task_service.create(self.S, "Second", _key())["task"]["name"]
		result = task_service.bulk_update([self.task, other], "set_status", "Pending Review")
		self.assertEqual(sorted(result["changed"]), sorted([self.task, other]))
		self.assertEqual({i["status"] for i in result["items"]}, {"Pending Review"})

	def test_status_change_is_in_the_history(self):
		task_service.update(self.task, {"status": "Working"})
		events = frappe.get_all(
			"Masar Activity", filters={"reference_name": self.task, "event": "field_changed"}, pluck="data"
		)
		self.assertTrue(any('"status"' in e and '"Working"' in e for e in events))


class TestOverdue(TaskStatusCase):
	def test_past_due_date_makes_an_unfinished_task_overdue_once(self):
		yesterday = add_days(nowdate(), -1)
		task_service.update(self.task, {"dueDate": yesterday})
		self.assertEqual(self._status(), ("Overdue", 0))
		# A person may move it on afterwards; Masar does not flip it back for the same due date.
		task_service.update(self.task, {"status": "Working"})
		self.assertEqual(self._status(), ("Working", 0))
		self.assertEqual(task_service.mark_overdue(), 0)
		self.assertEqual(self._status(), ("Working", 0))
		# A new past due date applies Overdue again.
		task_service.update(self.task, {"dueDate": add_days(nowdate(), -2)})
		self.assertEqual(self._status(), ("Overdue", 0))

	def test_moving_the_due_date_ahead_reopens(self):
		task_service.update(self.task, {"dueDate": add_days(nowdate(), -1)})
		task_service.update(self.task, {"dueDate": add_days(nowdate(), 3)})
		self.assertEqual(self._status(), ("Open", 0))

	def test_finished_tasks_never_become_overdue(self):
		task_service.update(self.task, {"status": "Cancelled"})
		task_service.update(self.task, {"dueDate": add_days(nowdate(), -1)})
		self.assertEqual(self._status(), ("Cancelled", 1))

	def test_daily_job_marks_tasks_whose_due_date_passed(self):
		task_service.update(self.task, {"dueDate": nowdate(), "status": "Working"})
		# Simulate the day rolling over: the stored due date is now in the past.
		frappe.db.set_value("Masar Task", self.task, "due_date", add_days(nowdate(), -1), update_modified=False)
		modified = frappe.db.get_value("Masar Task", self.task, "modified")
		frappe.set_user("Administrator")
		self.assertGreaterEqual(task_service.mark_overdue(), 1)
		self.assertEqual(self._status(), ("Overdue", 0))
		self.assertEqual(frappe.db.get_value("Masar Task", self.task, "modified"), modified)
		self.assertEqual(
			str(frappe.db.get_value("Masar Task", self.task, "overdue_for")), str(getdate(add_days(nowdate(), -1)))
		)
		self.assertEqual(task_service.mark_overdue(), 0)


class TestDescription(TaskStatusCase):
	def test_description_is_markdown_without_html(self):
		text = "**Bold** and `code`\n\n- one\n- two\n\n> quoted, and a < b > c\n\n<script>alert(1)</script><b>x</b>"
		detail = task_service.update(self.task, {"description": text})
		self.assertIn("**Bold**", detail["description"])
		self.assertIn("a < b > c", detail["description"])
		self.assertNotIn("<script>", detail["description"])
		self.assertNotIn("<b>", detail["description"])

	def test_description_cleaning_resists_nested_tags_and_unsafe_links(self):
		from masar.masar.doctype.masar_task.masar_task import clean_markdown

		self.assertNotIn("<script", clean_markdown("<scr<b>ipt>alert(1)</scr</b>ipt>"))
		self.assertNotRegex(clean_markdown("<img src=x onerror=alert(1)"), r"(?<!\\)<img")  # escaped, shown as text
		self.assertEqual(clean_markdown("[x](javascript:alert(1))"), "[x](#:alert(1))".replace("#:alert(1)", "#"))
		self.assertEqual(clean_markdown("[ok](https://example.com)"), "[ok](https://example.com)")
		self.assertEqual(clean_markdown("a < b and 2 <3"), "a < b and 2 <3")


class TestFilters(TaskStatusCase):
	def test_status_and_owner_filters(self):
		mine = unassigned_task(self.S, "Owned by member", _key())
		task_service.add_assignee(mine, email("a_member"))
		task_service.update(mine, {"status": "Pending Review"})
		listed = task_service.list_tasks(self.S, statuses=["Pending Review"])["items"]
		self.assertEqual([t["name"] for t in listed], [mine])
		owned = task_service.list_tasks(self.S, owners=[email("a_member")])["items"]
		# self.task was created by a_member, who owns it (client revision 5).
		self.assertEqual({t["name"] for t in owned}, {mine, self.task})
		with self.assertRaises(frappe.ValidationError):
			task_service.list_tasks(self.S, statuses=["Done"])

	def test_release_filter_across_spaces_needs_a_listed_space(self):
		as_user("a_manager")
		release = planning_service.create_release(self.S, "R1")["name"]
		as_user("a_member")
		task_service.update(self.task, {"release": release})
		items = task_service.my_work(spaces_filter=[self.S], release=release)["items"]
		self.assertEqual([t["name"] for t in items], [self.task])
		as_user("b_member")
		with self.assertRaises(frappe.DoesNotExistError):
			task_service.my_work(release=release)

	def test_owner_options_come_only_from_member_spaces(self):
		task_service.add_assignee(self.task, email("a_member"))
		names = [o["name"] for o in task_service.owners(spaces_filter=[self.S])]
		self.assertEqual(names, [email("a_member")])
		as_user("b_member")
		self.assertNotIn(email("a_member"), [o["name"] for o in task_service.owners()])
		with self.assertRaises(frappe.DoesNotExistError):
			task_service.owners(space=self.S)

	def test_my_releases_lists_only_member_spaces(self):
		as_user("a_manager")
		release = planning_service.create_release(self.S, "Cross-Space R")["name"]
		as_user("a_member")
		items = planning_service.list_my_releases([self.S])["items"]
		self.assertEqual([i["name"] for i in items], [release])
		self.assertTrue(items[0]["spaceTitle"].startswith("Status "))
		as_user("b_member")
		self.assertNotIn(release, [i["name"] for i in planning_service.list_my_releases()["items"]])
		with self.assertRaises(frappe.DoesNotExistError):
			planning_service.list_my_releases([self.S])

	def test_my_features_lists_only_member_spaces(self):
		as_user("a_manager")
		feature = planning_service.create_feature(self.S, "Cross-Space F")["name"]
		as_user("a_member")
		self.assertEqual([i["name"] for i in planning_service.list_my_features([self.S])["items"]], [feature])
		as_user("b_member")
		self.assertNotIn(feature, [i["name"] for i in planning_service.list_my_features()["items"]])


class TestFullWidth(TaskStatusCase):
	def test_full_width_is_a_personal_preference(self):
		from masar.services.personal import preference_service

		# Full width is the default (client revision 3); turning it off is personal.
		self.assertTrue(preference_service.get_preferences()["fullWidth"])
		self.assertFalse(preference_service.set_preferences(full_width=False)["fullWidth"])
		as_user("ab_member")
		self.assertTrue(preference_service.get_preferences()["fullWidth"])
		as_user("a_member")
		self.assertTrue(preference_service.set_preferences(full_width="1")["fullWidth"])
