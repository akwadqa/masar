"""DocType invariants for Space and Task (MASAR-SPACE-002/006/007, MASAR-TASK-006/007/009)."""

import json

import frappe
from frappe.tests import IntegrationTestCase

from masar.services import task_service
from masar.tests.fixtures import as_user, build_world, email, make_space, unassigned_task


class TestSpaceModel(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_space_requires_a_manager(self):
		doc = frappe.get_doc(
			{
				"doctype": "Masar Space",
				"title": "No managers",
				"space_owner": email("a_member"),
				"space_type": "Internal",
				"department": "App",
				"members": [{"user": email("a_member"), "role": "Member"}],
			}
		)
		with self.assertRaisesRegex(frappe.ValidationError, "at least one Manager"):
			doc.insert(ignore_permissions=True)

	def test_owner_must_be_a_manager(self):
		doc = frappe.get_doc(
			{
				"doctype": "Masar Space",
				"title": "Owner is member",
				"space_owner": email("a_member"),
				"space_type": "Internal",
				"department": "App",
				"members": [
					{"user": email("a_manager"), "role": "Manager"},
					{"user": email("a_member"), "role": "Member"},
				],
			}
		)
		with self.assertRaises(frappe.ValidationError):
			doc.insert(ignore_permissions=True)

	def test_duplicate_members_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			make_space("Dup", ["a_manager"], ["a_manager"])

	def test_member_needs_masar_role(self):
		with self.assertRaises(frappe.ValidationError):
			make_space("No role", ["a_manager"], ["no_role"])

	def test_gameplan_link_must_be_https(self):
		doc = frappe.get_doc("Masar Space", self.world["A"])
		doc.gameplan_url = "javascript:alert(1)"
		with self.assertRaises(frappe.ValidationError):
			doc.save(ignore_permissions=True)

	def test_space_with_tasks_cannot_be_deleted(self):
		as_user("a_member")
		task_service.create(self.world["A"], "Keeps the space alive", "model-delete-guard-1")
		frappe.set_user("Administrator")
		with self.assertRaises(frappe.ValidationError):
			frappe.delete_doc("Masar Space", self.world["A"], ignore_permissions=True)


class TestTaskModel(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		as_user("a_manager")

	def tearDown(self):
		frappe.set_user("Administrator")

	def _task(self, title="Model task"):
		return task_service.create(self.world["A"], title, frappe.generate_hash(length=16))["task"]["name"]

	def _unassigned(self):
		return unassigned_task(self.world["A"], "Model task", frappe.generate_hash(length=16))

	def test_first_assignee_becomes_owner_and_owner_follows_removal(self):
		name = self._unassigned()
		task_service.add_assignee(name, email("a_member"))
		detail = task_service.add_assignee(name, email("ab_member"))
		self.assertEqual(detail["taskOwner"], email("a_member"))
		detail = task_service.remove_assignee(name, email("a_member"))
		self.assertEqual(detail["taskOwner"], email("ab_member"))
		detail = task_service.remove_assignee(name, email("ab_member"))
		self.assertIsNone(detail["taskOwner"])

	def test_owner_must_be_an_assignee(self):
		name = self._unassigned()
		task_service.add_assignee(name, email("a_member"))
		with self.assertRaises(frappe.ValidationError):
			task_service.set_owner(name, email("a_manager"))
		task_service.add_assignee(name, email("a_manager"))
		detail = task_service.set_owner(name, email("a_manager"))
		self.assertEqual(detail["taskOwner"], email("a_manager"))

	def test_assignee_must_be_space_member(self):
		name = self._unassigned()
		with self.assertRaises(frappe.ValidationError):
			task_service.add_assignee(name, email("b_member"))
		self.assertEqual(frappe.db.count("Masar Task Assignee", {"parent": name}), 0)

	def test_title_is_trimmed_and_required(self):
		name = task_service.create(self.world["A"], "  spaced   out  ", "model-title-trim-1")["task"]["name"]
		self.assertEqual(frappe.db.get_value("Masar Task", name, "title"), "spaced out")
		with self.assertRaises(frappe.ValidationError):
			task_service.update(name, {"title": "   "})

	def test_completion_audit_and_reopen(self):
		name = self._task()
		detail = task_service.set_completed(name, True)
		self.assertTrue(detail["isCompleted"])
		self.assertEqual(detail["completedBy"]["name"], email("a_manager"))
		self.assertIsNotNone(detail["completedAt"])
		detail = task_service.set_completed(name, False)
		self.assertIsNone(detail["completedAt"])
		self.assertIsNone(detail["completedBy"])
		events = frappe.get_all(
			"Masar Activity", filters={"reference_name": name}, pluck="event", order_by="creation asc"
		)
		# Completion is a status change (client revision 2): Open -> Completed -> Open.
		self.assertEqual(events, ["created", "field_changed", "field_changed"])

	def test_space_is_immutable(self):
		name = self._task()
		doc = frappe.get_doc("Masar Task", name)
		doc.space = self.world["B"]
		with self.assertRaises(frappe.ValidationError):
			doc.save(ignore_permissions=True)

	def test_description_is_sanitised(self):
		name = self._task()
		detail = task_service.update(
			name, {"description": '<p onclick="x()">Hi<script>alert(1)</script></p>'}
		)
		self.assertNotIn("<script", detail["description"])
		self.assertNotIn("onclick", detail["description"])
		self.assertIn("Hi", detail["description"])

	def test_field_changes_are_recorded(self):
		name = self._task()
		task_service.update(name, {"priority": "High"})
		row = frappe.get_all(
			"Masar Activity", filters={"reference_name": name, "event": "field_changed"}, fields=["data"]
		)[0]
		self.assertEqual(json.loads(row.data), {"field": "priority", "from": "Medium", "to": "High"})

	def test_server_created_records_get_distinct_idempotency_keys(self):
		# Regression: the fallback key was derived from the not-yet-assigned name ("server:None").
		frappe.set_user("Administrator")
		first = frappe.get_doc(
			{"doctype": "Masar Task", "space": self.world["A"], "title": "Desk 1"}
		).insert()
		second = frappe.get_doc(
			{"doctype": "Masar Task", "space": self.world["A"], "title": "Desk 2"}
		).insert()
		self.assertNotEqual(first.client_request_id, second.client_request_id)
		self.assertTrue(first.client_request_id.startswith("server:"))
