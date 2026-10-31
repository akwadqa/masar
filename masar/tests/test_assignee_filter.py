"""Task lists filter by assignee (client request, Oct 2026), within the caller's Spaces only."""

import frappe
from frappe.tests import IntegrationTestCase

from masar.services import task_service
from masar.tests.fixtures import as_user, build_world, email, unassigned_task


def _key():
	return f"af-{frappe.generate_hash(length=16)}"


class TestAssigneeFilter(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		as_user("a_manager")
		self.assigned = unassigned_task(self.world["A"], "Assigned to a member", _key())
		self.other = unassigned_task(self.world["A"], "Assigned to nobody", _key())
		task_service.add_assignee(self.assigned, email("a_member"))

	def _names(self, **filters):
		return {
			row["name"]
			for row in task_service.list_tasks(self.world["A"], completed="all", **filters)["items"]
		}

	def test_lists_only_tasks_assigned_to_the_chosen_people(self):
		names = self._names(assignees=[email("a_member")])
		self.assertIn(self.assigned, names)
		self.assertNotIn(self.other, names)
		self.assertNotIn(self.assigned, self._names(assignees=[email("ab_member")]))

	def test_combines_with_the_owner_filter(self):
		self.assertIn(self.assigned, self._names(assignees=[email("a_member")], owners=[email("a_manager")]))
		self.assertNotIn(
			self.assigned, self._names(assignees=[email("a_member")], owners=[email("a_member")])
		)

	def test_my_work_applies_the_filter_across_spaces(self):
		rows = task_service.my_work(completed="all", assignees=[email("a_member")])["items"]
		self.assertIn(self.assigned, {row["name"] for row in rows})
		self.assertNotIn(self.other, {row["name"] for row in rows})

	def test_assignee_options_come_only_from_member_spaces(self):
		self.assertIn(email("a_member"), {ref["name"] for ref in task_service.assignees(self.world["A"])})
		as_user("b_member")
		with self.assertRaises(frappe.DoesNotExistError):
			task_service.assignees(self.world["A"])
		self.assertNotIn(email("a_member"), {ref["name"] for ref in task_service.assignees()})
