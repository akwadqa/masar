"""Cross-Space authorization over every path (docs/04 §8: SEC-T01, T02, T03, T12, T13, T14)."""

import frappe
import frappe.client
from frappe.tests import IntegrationTestCase

from masar.api import session as session_api
from masar.services import space_service, task_service
from masar.tests.fixtures import as_user, build_world, email


class TestSpacePermissions(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()
		as_user("a_member")
		cls.task_a = task_service.create(cls.world["A"], "Secret A task", "perm-task-a-0001")["task"]["name"]
		as_user("b_member")
		cls.task_b = task_service.create(cls.world["B"], "Secret B task", "perm-task-b-0001")["task"]["name"]
		frappe.set_user("Administrator")

	def tearDown(self):
		frappe.set_user("Administrator")

	# --- Masar API / services -------------------------------------------------------------

	def test_member_reads_own_space_task(self):
		as_user("a_member")
		self.assertEqual(task_service.get_detail(self.task_a)["title"], "Secret A task")

	def test_non_member_gets_not_found_for_task(self):
		as_user("b_member")
		for call in (
			lambda: task_service.get_detail(self.task_a),
			lambda: task_service.update(self.task_a, {"title": "hijacked"}),
			lambda: task_service.set_completed(self.task_a, True),
			lambda: task_service.add_assignee(self.task_a, email("b_member")),
			lambda: task_service.delete(self.task_a),
		):
			with self.assertRaises(frappe.DoesNotExistError):
				call()
		self.assertEqual(frappe.db.get_value("Masar Task", self.task_a, "title"), "Secret A task")

	def test_non_member_cannot_list_or_create_in_space(self):
		as_user("b_member")
		with self.assertRaises(frappe.DoesNotExistError):
			task_service.list_tasks(self.world["A"])
		with self.assertRaises(frappe.DoesNotExistError):
			task_service.create(self.world["A"], "Injected", "perm-inject-0001")
		with self.assertRaises(frappe.DoesNotExistError):
			space_service.get_detail(self.world["A"])

	def test_space_list_contains_only_memberships(self):
		as_user("ab_member")
		self.assertEqual(
			{s["name"] for s in space_service.list_for_user()}, {self.world["A"], self.world["B"]}
		)
		as_user("outsider")
		self.assertEqual(space_service.list_for_user(), [])

	def test_user_without_masar_role_is_rejected(self):
		as_user("no_role")
		with self.assertRaises(frappe.PermissionError):
			space_service.list_for_user()

	def test_member_cannot_delete_others_task_but_manager_can(self):
		as_user("a_manager")
		name = task_service.create(self.world["A"], "Manager made", "perm-del-0001")["task"]["name"]
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			task_service.delete(name)
		own = task_service.create(self.world["A"], "Member made", "perm-del-0002")["task"]["name"]
		self.assertTrue(task_service.delete(own)["deleted"])
		as_user("a_manager")
		self.assertTrue(task_service.delete(name)["deleted"])
		self.assertFalse(frappe.db.exists("Masar Activity", {"reference_name": name}))

	# --- Generic Frappe endpoints (frontend bypass) --------------------------------------

	def test_generic_reads_are_space_filtered(self):
		as_user("a_member")
		names = {t.name for t in frappe.get_list("Masar Task", fields=["name"], limit_page_length=0)}
		self.assertIn(self.task_a, names)
		self.assertNotIn(self.task_b, names)
		names = {
			t["name"] for t in frappe.client.get_list("Masar Task", fields=["name"], limit_page_length=0)
		}
		self.assertNotIn(self.task_b, names)
		with self.assertRaises(frappe.PermissionError):
			frappe.client.get("Masar Task", self.task_b)
		activity_spaces = {
			a.space for a in frappe.get_list("Masar Activity", fields=["space"], limit_page_length=0)
		}
		self.assertNotIn(self.world["B"], activity_spaces)
		space_names = {s.name for s in frappe.get_list("Masar Space", fields=["name"])}
		self.assertEqual(space_names, {self.world["A"]})

	def test_child_tables_listed_directly_are_space_filtered(self):
		as_user("a_manager")
		task_service.add_assignee(self.task_a, email("a_member"))
		as_user("b_member")
		members = frappe.client.get_list(
			"Masar Space Member", parent="Masar Space", fields=["parent", "user"], limit_page_length=0
		)
		self.assertTrue(members)
		self.assertEqual({m["parent"] for m in members}, {self.world["B"]})
		assignees = frappe.client.get_list(
			"Masar Task Assignee", parent="Masar Task", fields=["parent", "user"], limit_page_length=0
		)
		self.assertNotIn(self.task_a, {a["parent"] for a in assignees})

	def test_generic_writes_are_denied_even_for_members(self):
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			frappe.client.set_value("Masar Task", self.task_a, "title", "generic edit")
		with self.assertRaises(frappe.PermissionError):
			frappe.client.insert(
				{"doctype": "Masar Task", "space": self.world["A"], "title": "generic insert"}
			)
		with self.assertRaises((frappe.PermissionError, frappe.DoesNotExistError)):
			frappe.client.delete("Masar Task", self.task_a)
		self.assertEqual(frappe.db.get_value("Masar Task", self.task_a, "title"), "Secret A task")

	def test_client_payload_cannot_enable_service_context(self):
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			frappe.client.insert(
				{
					"doctype": "Masar Task",
					"space": self.world["A"],
					"title": "flag smuggling",
					"flags": {"masar_service": True},
					"masar_service": 1,
				}
			)
		self.assertFalse(frappe.flags.get("masar_service"))

	def test_protected_space_fields_cannot_be_changed_by_members(self):
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			frappe.client.set_value("Masar Space", self.world["A"], "space_owner", email("a_member"))
		as_user("a_manager")
		# Managers change Space settings through Masar services (Phase 2), not generic writes.
		with self.assertRaises(frappe.PermissionError):
			frappe.client.set_value("Masar Space", self.world["A"], "title", "renamed")

	def test_document_sharing_is_blocked(self):
		frappe.set_user("Administrator")
		with self.assertRaises(frappe.ValidationError):
			frappe.share.add("Masar Task", self.task_a, email("b_member"), read=1)
		as_user("b_member")
		with self.assertRaises(frappe.DoesNotExistError):
			task_service.get_detail(self.task_a)

	# --- Desk separation ------------------------------------------------------------------

	def test_masar_roles_do_not_grant_desk_access(self):
		for key in ("a_manager", "a_member", "admin"):
			self.assertEqual(frappe.db.get_value("User", email(key), "user_type"), "Website User", key)

	def test_boot_reports_desk_access_and_spaces(self):
		as_user("a_member")
		boot = session_api.boot()
		self.assertTrue(boot["authenticated"])
		self.assertFalse(boot["hasDeskAccess"])
		self.assertEqual([s["name"] for s in boot["spaces"]], [self.world["A"]])
		self.assertTrue(boot["csrfToken"])
		frappe.set_user("Guest")
		self.assertEqual(session_api.boot(), {"authenticated": False})
