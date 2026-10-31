"""Filter chips with operators and the Creation date sort (specs/dynamic-task-filters.md)."""

import frappe
from frappe.tests import IntegrationTestCase

from masar.services import label_service, space_service, task_service
from masar.tests.fixtures import as_user, build_world, email, unassigned_task


def _key():
	return f"fo-{frappe.generate_hash(length=16)}"


class TestTaskFilterOperators(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		as_user("a_manager")
		space = self.world["A"]
		self.label = label_service.create(space, f"Chip {frappe.generate_hash(length=5)}")["label"]["name"]
		self.unassigned = unassigned_task(space, "Nobody on it", _key())
		self.assigned = unassigned_task(space, "A member on it", _key())
		self.labelled = unassigned_task(space, "Carries the label", _key())
		task_service.add_assignee(self.assigned, email("a_member"))
		task_service.add_label(self.labelled, self.label)
		task_service.update(self.assigned, {"priority": "High"})

	def tearDown(self):
		frappe.set_user("Administrator")

	def _names(self, **filters):
		rows = task_service.list_tasks(self.world["A"], completed="all", **filters)["items"]
		return {row["name"] for row in rows}

	def test_assignee_is_empty_lists_only_unassigned_tasks(self):
		names = self._names(assignees_op="empty")
		self.assertIn(self.unassigned, names)
		self.assertNotIn(self.assigned, names)
		self.assertIn(self.assigned, self._names(assignees_op="set"))
		self.assertNotIn(self.unassigned, self._names(assignees_op="set"))

	def test_assignee_is_not_keeps_unassigned_tasks(self):
		names = self._names(assignees=[email("a_member")], assignees_op="not")
		self.assertNotIn(self.assigned, names)
		self.assertIn(self.unassigned, names)

	def test_label_operators(self):
		self.assertEqual(self._names(label=[self.label]) & {self.labelled, self.unassigned}, {self.labelled})
		self.assertNotIn(self.labelled, self._names(label=[self.label], label_op="not"))
		self.assertIn(self.unassigned, self._names(label=[self.label], label_op="not"))
		self.assertNotIn(self.labelled, self._names(label_op="empty"))
		self.assertIn(self.labelled, self._names(label_op="set"))

	def test_status_and_priority_operators_combine_as_and(self):
		names = self._names(priority=["High", "Highest"], statuses=["Done"], statuses_op="not")
		self.assertIn(self.assigned, names)
		self.assertNotIn(self.unassigned, names)
		self.assertNotIn(self.assigned, self._names(priority=["High"], priority_op="not"))
		status = frappe.db.get_value("Masar Task", self.assigned, "status")
		self.assertIn(self.assigned, self._names(priority=["High"], statuses=[status]))
		self.assertNotIn(self.assigned, self._names(priority=["High"], statuses=[status], statuses_op="not"))

	def test_owner_is_not(self):
		self.assertNotIn(self.unassigned, self._names(owners=[email("a_manager")], owners_op="not"))

	def test_unsupported_operators_are_rejected(self):
		for filters in (
			{"statuses_op": "empty"},
			{"owners_op": "set"},
			{"priority_op": "empty"},
			{"assignees_op": "contains"},
			{"priority": ["Urgent"]},
		):
			with self.subTest(filters=filters), self.assertRaises(frappe.ValidationError):
				self._names(**filters)

	def test_operators_never_reach_other_spaces(self):
		as_user("b_member")
		with self.assertRaises(frappe.DoesNotExistError):
			self._names(assignees_op="empty")
		mine = {row["name"] for row in task_service.my_work(completed="all", assignees_op="empty")["items"]}
		self.assertNotIn(self.unassigned, mine)

	def test_creation_sort_pages_newest_first_without_gaps(self):
		full = [
			row["name"]
			for row in task_service.list_tasks(self.world["A"], completed="all", sort="created")["items"]
		]
		self.assertLess(full.index(self.labelled), full.index(self.unassigned))
		paged, cursor = [], None
		while True:
			page = task_service.list_tasks(
				self.world["A"], completed="all", sort="created", limit=2, cursor=cursor
			)
			paged += [row["name"] for row in page["items"]]
			cursor = page["nextCursor"]
			if not cursor:
				break
		self.assertEqual(paged, full)

	def test_space_summaries_carry_their_creation(self):
		summary = next(s for s in space_service.list_for_user() if s["name"] == self.world["A"])
		self.assertEqual(
			frappe.utils.get_datetime(summary["creation"]).replace(tzinfo=None),
			frappe.db.get_value("Masar Space", self.world["A"], "creation"),
		)
