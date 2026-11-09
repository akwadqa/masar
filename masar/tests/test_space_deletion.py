"""Deleting an empty Space with its remaining content (client decision 2026-11-03, replacing the cascade
of 2026-10-31), and Tasks with their time logs."""

import frappe
from frappe.tests import IntegrationTestCase

from masar.permissions import space_capabilities
from masar.services import (
	comment_service,
	label_service,
	planning_service,
	space_deletion,
	space_service,
	task_service,
	time_service,
)
from masar.services.personal import timer_service
from masar.tests.fixtures import as_user, build_world, email, make_space, unassigned_task


def _key(prefix="sd"):
	return f"{prefix}-{frappe.generate_hash(length=16)}"


def _space_rows(space: str) -> dict[str, int]:
	"""Rows of every Masar DocType that links to this Space (nothing may survive a deletion)."""
	linking = frappe.get_all(
		"DocField",
		filters={"fieldtype": "Link", "options": "Masar Space", "parent": ["like", "Masar %"]},
		fields=["parent", "fieldname"],
	)
	counts = {
		f"{row.parent}.{row.fieldname}": frappe.db.count(row.parent, {row.fieldname: space})
		for row in linking
	}
	return {key: count for key, count in counts.items() if count}


class TestTaskDeletionWithTimeLogs(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_a_task_with_logged_and_timed_work_can_be_deleted(self):
		as_user("a_manager")
		task = unassigned_task(self.world["A"], "Timed work", _key())
		time_service.log_time(task, "30m", _key("log"))
		timer = timer_service.start(task)["name"]
		frappe.db.set_value(
			"Masar Timer Session", timer, "started_at", frappe.utils.add_to_date(None, minutes=-5)
		)
		timer_service.stop(timer)
		self.assertTrue(frappe.db.exists("Masar Timer Session", {"task": task}))

		task_service.delete(task)

		self.assertFalse(frappe.db.exists("Masar Task", task))
		self.assertFalse(frappe.db.exists("Masar Time Entry", {"task": task}))
		self.assertFalse(frappe.db.exists("Masar Timer Session", {"task": task}))


class TestSpaceDeletion(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		frappe.set_user("Administrator")
		self.space = make_space(f"Doomed {frappe.generate_hash(length=6)}", ["a_manager"], ["a_member"])
		self.title = frappe.db.get_value("Masar Space", self.space, "title")

	def tearDown(self):
		frappe.set_user("Administrator")

	def _fill(self):
		"""A Space with Tasks, Features, Releases, Labels, comments and time logs."""
		as_user("a_manager")
		feature = planning_service.create_feature(self.space, "Feature")["name"]
		release = planning_service.create_release(self.space, f"R {frappe.generate_hash(length=4)}")["name"]
		label = label_service.create(self.space, "Label")["label"]["name"]
		task = unassigned_task(self.space, "Planned work", _key())
		task_service.update(task, {"feature": feature, "release": release})
		task_service.add_label(task, label)
		task_service.add_assignee(task, email("a_member"))
		comment_service.create(task, "<p>Note</p>", _key("c"))
		time_service.log_time(task, "15m", _key("log"))
		other = unassigned_task(self.space, "Second", _key())
		return [task, other]

	def test_a_space_with_tasks_in_any_status_cannot_be_deleted(self):
		tasks = self._fill()
		task_service.set_completed(tasks[0], True)
		self.assertEqual(space_service.get_detail(self.space)["taskCount"], 2)
		with self.assertRaises(frappe.ValidationError):
			space_deletion.delete_space(self.space, self.title)
		task_service.delete(tasks[1])  # one Completed task still blocks
		self.assertEqual(space_service.get_detail(self.space)["taskCount"], 1)
		with self.assertRaises(frappe.ValidationError):
			space_deletion.delete_space(self.space, self.title)
		self.assertTrue(frappe.db.exists("Masar Space", self.space))
		self.assertTrue(frappe.db.exists("Masar Task", tasks[0]))
		self.assertTrue(frappe.db.exists("Masar Feature", {"space": self.space}))

	def test_admin_is_refused_too_while_tasks_remain(self):
		as_user("a_manager")
		unassigned_task(self.space, "Blocking", _key())
		as_user("admin")
		with self.assertRaises(frappe.ValidationError):
			space_deletion.delete_space(self.space, self.title)
		self.assertTrue(frappe.db.exists("Masar Space", self.space))

	def test_owner_deletes_an_emptied_space_with_its_remaining_content(self):
		tasks = self._fill()
		other_space_task = unassigned_task(self.world["A"], "Elsewhere", _key())
		for task in tasks:
			task_service.delete(task)
		self.assertEqual(space_service.get_detail(self.space)["taskCount"], 0)

		result = space_deletion.delete_space(self.space, self.title)

		self.assertEqual(result, {"name": self.space, "deleted": True})
		self.assertFalse(frappe.db.exists("Masar Space", self.space))
		self.assertEqual(_space_rows(self.space), {})
		for task in tasks:
			self.assertFalse(frappe.db.exists("Masar Task Assignee", {"parent": task}))
			self.assertFalse(frappe.db.exists("Masar Task Label", {"parent": task}))
		self.assertTrue(frappe.db.exists("Masar Task", other_space_task))

	def test_masar_admin_may_delete_without_membership(self):
		as_user("admin")
		space_deletion.delete_space(self.space, self.title)
		self.assertFalse(frappe.db.exists("Masar Space", self.space))

	def test_other_managers_members_and_outsiders_may_not(self):
		as_user("Administrator")
		doc = frappe.get_doc("Masar Space", self.space)
		doc.append("members", {"user": email("ab_member"), "role": "Manager"})
		doc.save(ignore_permissions=True)
		for user, error in (
			("ab_member", frappe.PermissionError),
			("a_member", frappe.PermissionError),
			("outsider", frappe.DoesNotExistError),
		):
			as_user(user)
			with self.subTest(user=user), self.assertRaises(error):
				space_deletion.delete_space(self.space, self.title)
		self.assertTrue(frappe.db.exists("Masar Space", self.space))

	def test_the_title_must_be_typed(self):
		as_user("a_manager")
		with self.assertRaises(frappe.ValidationError):
			space_deletion.delete_space(self.space, "wrong")
		with self.assertRaises(frappe.ValidationError):
			space_deletion.delete_space(self.space, "")
		self.assertTrue(frappe.db.exists("Masar Space", self.space))

	def test_capability_flag_matches_the_rule(self):
		owner = frappe.db.get_value("Masar Space", self.space, "space_owner")
		for user, expected in (("a_manager", True), ("a_member", False), ("admin", True)):
			as_user(user)
			with self.subTest(user=user):
				self.assertEqual(space_capabilities(self.space, owner, "In Progress")["canDelete"], expected)
