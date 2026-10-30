"""Phase 2: Space creation, details, lifecycle, membership, ownership (real authorization, no mocks)."""

import frappe
import frappe.client
from frappe.tests import IntegrationTestCase

from masar.exceptions import MasarConflictError
from masar.services import space_service, task_service
from masar.tests.fixtures import as_user, build_world, email, unassigned_task


class TestSpaceService(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def tearDown(self):
		frappe.local.response.pop("conflicts", None)
		frappe.set_user("Administrator")

	def _space(self, owner="a_manager", title="Phase 2 Space"):
		as_user("admin")
		return space_service.create({"title": title, "owner": email(owner)})["name"]

	# --- creation --------------------------------------------------------------------------

	def test_admin_creates_space_owned_by_chosen_user_without_joining_it(self):
		name = self._space(owner="a_member", title="Created by admin")
		doc = frappe.get_doc("Masar Space", name)
		self.assertEqual(doc.space_owner, email("a_member"))
		self.assertEqual([(m.user, m.role) for m in doc.members], [(email("a_member"), "Manager")])
		self.assertEqual(doc.status, "In Progress")
		as_user("a_member")
		self.assertIn(name, {s["name"] for s in space_service.list_for_user()})
		as_user("admin")
		self.assertNotIn(name, {s["name"] for s in space_service.list_for_user("mine")})
		self.assertIn(name, {s["name"] for s in space_service.list_for_user("all")})
		self.assertTrue(
			frappe.db.exists("Masar Activity", {"reference_name": name, "event": "space_created"})
		)

	def test_only_administrators_create_spaces(self):
		for key in ("a_manager", "a_member"):
			as_user(key)
			with self.assertRaises(frappe.PermissionError):
				space_service.create({"title": "Nope", "owner": email(key)})
			with self.assertRaises(frappe.PermissionError):
				space_service.list_for_user("all")
			with self.assertRaises(frappe.PermissionError):
				space_service.user_candidates("")
		as_user("a_manager")
		with self.assertRaises(frappe.PermissionError):
			frappe.client.insert(
				{
					"doctype": "Masar Space",
					"title": "Generic",
					"space_owner": email("a_manager"),
					"space_type": "Internal",
					"department": "ERP",
					"members": [{"user": email("a_manager"), "role": "Manager"}],
				}
			)

	def test_creation_validates_owner_and_fields(self):
		as_user("admin")
		for data in (
			{"title": "No owner"},
			{"title": "Outsider owner", "owner": email("no_role")},
			{"title": "  ", "owner": email("a_manager")},
			{"title": "Bad link", "owner": email("a_manager"), "gameplanUrl": "http://insecure.example"},
		):
			with self.assertRaises(frappe.ValidationError, msg=str(data)):
				space_service.create(data)

	# --- details & lifecycle -----------------------------------------------------------------

	def test_manager_edits_details_member_cannot(self):
		as_user("a_manager")
		detail = space_service.update_details(
			self.world["A"], {"category": "Core", "completionDate": "2026-12-31"}
		)
		self.assertEqual((detail["category"], detail["completionDate"]), ("Core", "2026-12-31"))
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			space_service.update_details(self.world["A"], {"title": "Member edit"})
		as_user("b_member")
		with self.assertRaises(frappe.DoesNotExistError):
			space_service.update_details(self.world["A"], {"title": "Outsider edit"})

	def test_details_conflict_is_field_scoped(self):
		as_user("a_manager")
		current = frappe.db.get_value("Masar Space", self.world["A"], "title")
		space_service.update_details(self.world["A"], {"title": "Renamed A"}, {"title": current})
		with self.assertRaises(MasarConflictError):
			space_service.update_details(self.world["A"], {"title": "Stale"}, {"title": current})
		category = frappe.db.get_value("Masar Space", self.world["A"], "category")
		detail = space_service.update_details(self.world["A"], {"category": "Ops"}, {"category": category})
		self.assertEqual((detail["title"], detail["category"]), ("Renamed A", "Ops"))

	def test_status_transitions_and_task_write_rules(self):
		name = self._space(owner="a_manager", title="Lifecycle")
		as_user("a_manager")
		space_service.add_member(name, email("a_member"), "Member")
		task = task_service.create(name, "Lifecycle task", "life-0000-0001")["task"]["name"]

		detail = space_service.set_status(name, "Completed")
		self.assertEqual(detail["permissions"]["allowedStatuses"], ["In Progress", "Closed"])
		as_user("a_member")
		self.assertFalse(task_service.get_detail(task)["permissions"]["canEdit"])
		with self.assertRaises(frappe.PermissionError):
			task_service.update(task, {"title": "Member after completion"})
		with self.assertRaises(frappe.PermissionError):
			task_service.create(name, "New in completed", "life-0000-0002")
		as_user("a_manager")
		task_service.update(task, {"title": "Manager wrap-up"})  # Managers may still wrap up

		with self.assertRaises(frappe.ValidationError):
			space_service.set_status(name, "Cancelled")  # Completed -> Cancelled is not a transition
		space_service.set_status(name, "Closed")
		with self.assertRaises(frappe.PermissionError):
			task_service.set_completed(task, True)  # Closed: read-only for everyone
		self.assertEqual(task_service.get_detail(task)["title"], "Manager wrap-up")  # still readable
		self.assertTrue(frappe.db.exists("Masar Task", task))

		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			space_service.set_status(name, "In Progress")
		as_user("a_manager")
		space_service.set_status(name, "In Progress")  # reopen
		task_service.set_completed(task, True)
		events = frappe.get_all(
			"Masar Activity", filters={"reference_name": name, "event": "status_changed"}, pluck="data"
		)
		self.assertEqual(len(events), 3)

	def test_status_conflict_detection(self):
		name = self._space(title="Status race")
		as_user("a_manager")
		space_service.set_status(name, "Cancelled", expected_status="In Progress")
		with self.assertRaises(MasarConflictError):
			space_service.set_status(name, "Completed", expected_status="In Progress")

	# --- membership --------------------------------------------------------------------------

	def test_manager_adds_and_changes_roles_member_cannot_escalate(self):
		name = self._space(title="Membership")
		as_user("a_manager")
		space_service.add_member(name, email("a_member"), "Member")
		with self.assertRaises(frappe.ValidationError):
			space_service.add_member(name, email("a_member"), "Member")  # duplicate
		with self.assertRaises(frappe.ValidationError):
			space_service.add_member(name, email("no_role"), "Member")  # not a Masar user

		as_user("a_member")
		for call in (
			lambda: space_service.change_role(name, email("a_member"), "Manager"),
			lambda: space_service.add_member(name, email("ab_member"), "Manager"),
			lambda: space_service.remove_member(name, email("a_manager")),
		):
			with self.assertRaises(frappe.PermissionError):
				call()
		# Generic Frappe paths cannot change membership either.
		doc = frappe.get_doc("Masar Space", name)
		rows = [{"user": m.user, "role": "Manager"} for m in doc.members]
		with self.assertRaises(frappe.PermissionError):
			frappe.client.set_value("Masar Space", name, "members", rows)
		with self.assertRaises(frappe.PermissionError):
			frappe.client.set_value("Masar Space", name, "space_owner", email("a_member"))
		self.assertEqual(
			frappe.db.get_value("Masar Space Member", {"parent": name, "user": email("a_member")}, "role"),
			"Member",
		)

		as_user("outsider")
		with self.assertRaises(frappe.DoesNotExistError):
			space_service.add_member(name, email("outsider"), "Manager")

		as_user("a_manager")
		detail = space_service.change_role(name, email("a_member"), "Manager")
		self.assertIn(
			("a_member", "Manager"), {(m["name"].split("@")[0], m["role"]) for m in detail["members"]}
		)
		with self.assertRaises(frappe.ValidationError):
			space_service.change_role(name, email("a_manager"), "Member")  # owner must stay Manager

	def test_admin_manages_membership_without_being_member(self):
		name = self._space(title="Admin managed")
		as_user("admin")
		space_service.add_member(name, email("ab_member"), "Member")
		with self.assertRaises(frappe.DoesNotExistError):
			task_service.list_tasks(name)  # administration is not content access (Q-08)

	def test_remove_member_reassigns_tasks_and_revokes_access(self):
		name = self._space(title="Removal")
		as_user("a_manager")
		space_service.add_member(name, email("a_member"), "Member")
		space_service.add_member(name, email("ab_member"), "Member")
		shared = unassigned_task(name, "Shared", "rm-0000-0001")
		solo = unassigned_task(name, "Solo", "rm-0000-0002")
		task_service.add_assignee(shared, email("a_member"))
		task_service.add_assignee(shared, email("ab_member"))
		task_service.add_assignee(solo, email("a_member"))
		task_service.set_completed(solo, True)

		impact = space_service.removal_impact(name, email("a_member"))
		self.assertEqual(
			{k: impact[k] for k in ("assignedTasks", "ownedTasks", "ownershipMoves", "tasksLeftUnassigned")},
			{"assignedTasks": 2, "ownedTasks": 2, "ownershipMoves": 1, "tasksLeftUnassigned": 1},
		)
		result = space_service.remove_member(name, email("a_member"))
		self.assertEqual(result["tasksUpdated"], 2)
		self.assertEqual(frappe.db.get_value("Masar Task", shared, "task_owner"), email("ab_member"))
		self.assertIsNone(frappe.db.get_value("Masar Task", solo, "task_owner"))
		self.assertEqual(frappe.db.get_value("Masar Task", solo, "is_completed"), 1)  # history intact
		self.assertEqual(frappe.db.get_value("Masar Task", solo, "completed_by"), email("a_manager"))
		self.assertTrue(frappe.db.exists("Masar Activity", {"reference_name": shared, "event": "unassigned"}))
		as_user("a_member")
		for call in (
			lambda: space_service.get_detail(name),
			lambda: task_service.get_detail(shared),
			lambda: task_service.list_tasks(name),
		):
			with self.assertRaises(frappe.DoesNotExistError):
				call()
		names = {t.name for t in frappe.get_list("Masar Task", filters={"space": name}, fields=["name"])}
		self.assertEqual(names, set())

	def test_owner_cannot_be_removed(self):
		name = self._space(title="Owner stays")
		as_user("a_manager")
		with self.assertRaises(frappe.ValidationError):
			space_service.remove_member(name, email("a_manager"))

	# --- ownership ---------------------------------------------------------------------------

	def test_transfer_ownership_rules(self):
		name = self._space(title="Transfer")
		as_user("a_manager")
		space_service.add_member(name, email("a_member"), "Member")
		space_service.add_member(name, email("ab_member"), "Manager")

		as_user("ab_member")  # a Manager who is not the owner
		with self.assertRaises(frappe.PermissionError):
			space_service.transfer_ownership(name, email("ab_member"))
		as_user("a_manager")
		with self.assertRaises(frappe.ValidationError):
			space_service.transfer_ownership(name, email("outsider"))  # not a member
		detail = space_service.transfer_ownership(name, email("a_member"), expected_owner=email("a_manager"))
		self.assertEqual(detail["owner"]["name"], email("a_member"))
		roles = {m["name"]: m["role"] for m in detail["members"]}
		self.assertEqual((roles[email("a_member")], roles[email("a_manager")]), ("Manager", "Manager"))
		with self.assertRaises(frappe.PermissionError):  # the former owner lost the right to transfer
			space_service.transfer_ownership(name, email("ab_member"))
		as_user("a_member")
		with self.assertRaises(MasarConflictError):  # stale expectation: concurrent transfer
			space_service.transfer_ownership(name, email("ab_member"), expected_owner=email("a_manager"))
		as_user("admin")
		detail = space_service.transfer_ownership(name, email("ab_member"))
		self.assertEqual(detail["owner"]["name"], email("ab_member"))
		self.assertEqual(
			frappe.db.count("Masar Activity", {"reference_name": name, "event": "ownership_transferred"}), 2
		)

	def test_concurrent_membership_changes_merge(self):
		name = self._space(title="Concurrent")
		as_user("a_manager")
		space_service.add_member(name, email("a_member"), "Member")
		as_user("admin")
		space_service.add_member(name, email("ab_member"), "Member")
		members = set(frappe.get_all("Masar Space Member", filters={"parent": name}, pluck="user"))
		self.assertEqual(members, {email("a_manager"), email("a_member"), email("ab_member")})

	def test_desk_admin_generic_edit_still_enforces_invariants(self):
		name = self._space(title="Desk edit")
		as_user("desk_admin")
		with self.assertRaises(frappe.ValidationError):
			frappe.client.set_value("Masar Space", name, "space_owner", email("ab_member"))  # not a Manager

	def test_user_candidates(self):
		name = self._space(title="Candidates")
		as_user("a_manager")
		names = {u["name"] for u in space_service.user_candidates("", space=name)}
		self.assertNotIn(email("a_manager"), names)  # already a member
		self.assertNotIn(email("no_role"), names)
		self.assertIn(email("a_member"), names)
		as_user("a_member")
		with self.assertRaises(frappe.DoesNotExistError):
			space_service.user_candidates("", space=name)


class TestDepartmentRetired(IntegrationTestCase):
	def test_department_is_neither_returned_nor_editable(self):
		build_world()
		as_user("admin")
		created = space_service.create({"title": "No department", "owner": email("a_manager"), "department": "HR"})
		self.assertNotIn("department", created)
		as_user("a_manager")
		with self.assertRaises(frappe.ValidationError):
			space_service.update_details(created["name"], {"department": "App"})
