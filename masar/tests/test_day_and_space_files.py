"""Owner decisions of 2026-10-31: My Day lasts one day and starts with the Tasks due today; Space files
(Managers add and remove, members read)."""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, nowdate

from masar.permissions import file_has_permission
from masar.services import space_file_service, task_service
from masar.services.personal import my_day_service
from masar.tests.fixtures import as_user, build_world, email, unassigned_task

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _in_my_day(task: str, user: str) -> bool:
	return bool(frappe.db.exists("Masar My Day", {"task": task, "user": email(user)}))


class TestDueTodayInMyDay(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		as_user("a_manager")

	def tearDown(self):
		frappe.set_user("Administrator")

	def _task(self, title: str) -> str:
		return unassigned_task(self.world["A"], title, f"day-{frappe.generate_hash(length=10)}")

	def test_due_today_joins_assignees_or_owner_at_once(self):
		assigned = self._task("Assigned, due today")
		task_service.add_assignee(assigned, email("a_member"))
		task_service.update(assigned, {"dueDate": nowdate()})
		self.assertTrue(_in_my_day(assigned, "a_member"))
		self.assertFalse(_in_my_day(assigned, "a_manager"), "the owner only when nobody is assigned")

		unassigned = self._task("Nobody assigned, due today")
		task_service.update(unassigned, {"dueDate": nowdate()})
		self.assertTrue(_in_my_day(unassigned, "a_manager"))

		later = self._task("Due tomorrow")
		task_service.add_assignee(later, email("a_member"))
		task_service.update(later, {"dueDate": add_days(nowdate(), 1)})
		self.assertFalse(_in_my_day(later, "a_member"))

	def test_new_assignee_of_a_task_due_today_gets_it(self):
		name = self._task("Due today, assigned later")
		task_service.add_assignee(name, email("a_member"))
		task_service.update(name, {"dueDate": nowdate()})
		task_service.add_assignee(name, email("ab_member"))
		self.assertTrue(_in_my_day(name, "ab_member"))

	def test_a_removed_due_today_task_is_not_added_back_during_the_day(self):
		name = self._task("Removed by its assignee")
		task_service.add_assignee(name, email("a_member"))
		task_service.update(name, {"dueDate": nowdate()})
		as_user("a_member")
		my_day_service.set_my_day(name, False)
		as_user("a_manager")
		task_service.update(name, {"title": "Renamed, still due today"})
		self.assertFalse(_in_my_day(name, "a_member"))

	def test_new_day_clears_my_day_and_adds_unfinished_tasks_due_today(self):
		picked = self._task("Picked yesterday")
		my_day_service.set_my_day(picked, True)
		due = self._task("Due today")
		task_service.add_assignee(due, email("a_member"))
		frappe.db.set_value("Masar Task", due, "due_date", nowdate())  # due today, not yet in My Day
		done = self._task("Due today but finished")
		task_service.add_assignee(done, email("a_member"))
		frappe.db.set_value("Masar Task", done, {"due_date": nowdate(), "is_completed": 1, "status": "Completed"})

		my_day_service.start_new_day()
		self.assertFalse(_in_my_day(picked, "a_manager"))
		self.assertTrue(_in_my_day(due, "a_member"))
		self.assertFalse(_in_my_day(done, "a_member"))


class TestSpaceFiles(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_managers_add_and_remove_members_read(self):
		as_user("a_manager")
		row = space_file_service.store(self.world["A"], "brd.png", PNG)
		self.assertTrue(row["canDelete"])
		file = frappe.get_doc("File", frappe.db.get_value("Masar Space File", row["name"], "file"))
		self.assertEqual((file.is_private, file.attached_to_doctype), (1, "Masar Space"))

		as_user("a_member")
		self.assertEqual([f["name"] for f in space_file_service.list_files(self.world["A"])], [row["name"]])
		self.assertFalse(space_file_service.list_files(self.world["A"])[0]["canDelete"])
		self.assertTrue(file_has_permission(file, "read", user=email("a_member")))
		with self.assertRaises(frappe.PermissionError):
			space_file_service.delete(row["name"])

		as_user("b_member")  # not a member of A
		self.assertFalse(file_has_permission(file, "read", user=email("b_member")))
		with self.assertRaises(frappe.DoesNotExistError):
			space_file_service.list_files(self.world["A"])

		as_user("a_manager")
		space_file_service.delete(row["name"])
		self.assertFalse(frappe.db.exists("Masar Space File", row["name"]))
		self.assertFalse(frappe.db.exists("File", file.name))

	def test_type_is_checked_from_the_bytes(self):
		as_user("a_manager")
		with self.assertRaises(frappe.ValidationError):
			space_file_service.store(self.world["A"], "notes.png", b"not an image")
