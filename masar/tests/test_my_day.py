"""Client revision 4: My Day is personal, and finished Tasks leave it automatically."""

import frappe
from frappe.tests import IntegrationTestCase

from masar.patches.v9 import personal_my_day
from masar.permissions import my_day_query_conditions
from masar.services import task_service
from masar.services.personal import my_day_service
from masar.tests.fixtures import as_user, build_world, email, unassigned_task


def _task(space, title, key):
	return task_service.create(space, title, f"md-{key}-{frappe.generate_hash(length=8)}")["task"]["name"]


def _my_day(**filters):
	return {t["name"] for t in task_service.my_work(my_day=True, completed="all", **filters)["items"]}


class TestMyDay(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		as_user("a_manager")

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_my_day_is_per_person(self):
		task = _task(self.world["A"], "Personal pick", "own")
		my_day_service.set_my_day(task, True)
		self.assertIn(task, _my_day())
		self.assertTrue(task_service.get_detail(task)["isMyDay"])

		as_user("a_member")
		self.assertNotIn(task, _my_day())
		self.assertFalse(task_service.get_detail(task)["isMyDay"])
		row = next(t for t in task_service.list_tasks(self.world["A"])["items"] if t["name"] == task)
		self.assertFalse(row["isMyDay"])
		my_day_service.set_my_day(task, True)
		my_day_service.set_my_day(task, True)  # idempotent
		self.assertEqual(frappe.db.count("Masar My Day", {"task": task}), 2)

		my_day_service.set_my_day(task, False)
		self.assertNotIn(task, _my_day())
		as_user("a_manager")
		self.assertIn(task, _my_day())

	def test_my_day_leaves_task_and_history_unchanged(self):
		task = _task(self.world["A"], "No history", "hist")
		modified = frappe.db.get_value("Masar Task", task, "modified")
		events = frappe.db.count("Masar Activity", {"reference_name": task})
		my_day_service.set_my_day(task, True)
		self.assertEqual(frappe.db.get_value("Masar Task", task, "modified"), modified)
		self.assertEqual(frappe.db.count("Masar Activity", {"reference_name": task}), events)

	def test_older_clients_still_toggle_through_update(self):
		task = _task(self.world["A"], "Legacy toggle", "legacy")
		detail = task_service.update(task, {"isMyDay": True})
		self.assertTrue(detail["isMyDay"])
		self.assertIn(task, _my_day())
		detail = task_service.update(task, {"isMyDay": False, "priority": "High"})
		self.assertFalse(detail["isMyDay"])
		self.assertEqual(detail["priority"], "High")

	def test_finished_tasks_leave_every_my_day(self):
		task = _task(self.world["A"], "Finish me", "done")
		my_day_service.set_my_day(task, True)
		as_user("a_member")
		my_day_service.set_my_day(task, True)
		task_service.update(task, {"status": "Completed"})
		self.assertEqual(frappe.db.count("Masar My Day", {"task": task}), 0)
		self.assertNotIn(task, _my_day())
		with self.assertRaises(frappe.ValidationError):
			my_day_service.set_my_day(task, True)

		other = _task(self.world["A"], "Bulk finish", "bulk")
		my_day_service.set_my_day(other, True)
		task_service.set_completed(other, True)
		self.assertEqual(frappe.db.count("Masar My Day", {"task": other}), 0)

	def test_deleted_task_leaves_my_day(self):
		task = _task(self.world["A"], "Delete me", "del")
		my_day_service.set_my_day(task, True)
		task_service.delete(task)
		self.assertEqual(frappe.db.count("Masar My Day", {"task": task}), 0)

	def test_non_members_cannot_add_and_rows_stay_private(self):
		task = _task(self.world["A"], "Members only", "perm")
		my_day_service.set_my_day(task, True)
		as_user("b_member")
		with self.assertRaises(frappe.DoesNotExistError):
			my_day_service.set_my_day(task, True)
		self.assertIn(email("b_member"), my_day_query_conditions())
		row = frappe.get_doc("Masar My Day", {"task": task, "user": email("a_manager")})
		self.assertFalse(frappe.has_permission("Masar My Day", "read", row, user=email("b_member")))
		self.assertFalse(frappe.has_permission("Masar My Day", "write", row, user=email("a_manager")))

	def test_patch_gives_shared_flags_to_assignees(self):
		task = unassigned_task(self.world["A"], "Shared flag", f"md-patch-{frappe.generate_hash(length=8)}")
		task_service.add_assignee(task, email("a_member"))
		frappe.db.set_value("Masar Task", task, "is_my_day", 1, update_modified=False)
		finished = unassigned_task(self.world["A"], "Finished flag", f"md-done-{frappe.generate_hash(length=8)}")
		task_service.add_assignee(finished, email("a_member"))
		task_service.set_completed(finished, True)
		frappe.db.set_value("Masar Task", finished, "is_my_day", 1, update_modified=False)
		frappe.set_user("Administrator")
		personal_my_day.execute()
		personal_my_day.execute()  # re-runnable
		self.assertEqual(
			frappe.get_all("Masar My Day", filters={"task": task}, pluck="user"), [email("a_member")]
		)
		self.assertEqual(frappe.db.count("Masar My Day", {"task": finished}), 0)

	def test_removing_a_test_scope_removes_its_my_day_rows(self):
		from masar.demo.engine import delete_scope

		frappe.set_user("Administrator")
		space = frappe.get_doc(
			{
				"doctype": "Masar Space",
				"title": f"Scope {frappe.generate_hash(length=6)}",
				"space_owner": email("a_manager"),
				"members": [{"user": email("a_manager"), "role": "Manager"}],
			}
		).insert(ignore_permissions=True)
		as_user("a_manager")
		task = _task(space.name, "Scoped", "scope")
		my_day_service.set_my_day(task, True)
		frappe.set_user("Administrator")
		delete_scope([space.name], [])
		self.assertEqual(frappe.db.count("Masar My Day", {"task": task}), 0)

