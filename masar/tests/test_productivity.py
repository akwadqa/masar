"""Phase 3: Actions, promotion, labels, My Work, search and bulk operations (real authorization)."""

import frappe
import frappe.client
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, nowdate

from masar.exceptions import MasarConflictError
from masar.services import action_service, label_service, space_service, task_service
from masar.tests.fixtures import as_user, build_world, email, unassigned_task


def _task(space, title, key):
	return task_service.create(space, title, f"p3-{key}-{frappe.generate_hash(length=8)}")["task"]["name"]


class TestActions(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		as_user("a_manager")

	def tearDown(self):
		frappe.local.response.pop("conflicts", None)
		frappe.set_user("Administrator")

	def test_crud_ordering_counters_and_idempotent_add(self):
		task = _task(self.world["A"], "Checklist", "crud")
		a1 = action_service.add(task, "  first   step ", "act-crud-0001")["action"]
		again = action_service.add(task, "first step", "act-crud-0001")
		self.assertFalse(again["created"])
		self.assertEqual(again["action"]["name"], a1["name"])
		a2 = action_service.add(task, "second", None)["action"]
		a3 = action_service.add(task, "third", None)["action"]
		self.assertEqual(a1["title"], "first step")
		action_service.move(a3["name"], before=a1["name"])
		self.assertEqual(
			[a["title"] for a in action_service.list_actions(task)], ["third", "first step", "second"]
		)
		action_service.update(a2["name"], "second (edited)", base_title="second")
		with self.assertRaises(MasarConflictError):
			action_service.update(a2["name"], "stale", base_title="second")
		done = action_service.set_done(a1["name"], True)
		self.assertTrue(done["isDone"])
		self.assertEqual(done["doneBy"]["name"], email("a_manager"))
		counts = frappe.db.get_value("Masar Task", task, ["action_count", "action_done_count"])
		self.assertEqual(tuple(counts), (3, 1))
		action_service.delete(a3["name"])
		self.assertEqual(frappe.db.get_value("Masar Task", task, "action_count"), 2)
		with self.assertRaises(frappe.ValidationError):
			action_service.add(task, "   ")

	def test_idempotent_replay_is_scoped_to_the_authorised_task(self):
		private = _task(self.world["A"], "Replay source", "replay")
		action_service.add(private, "only in A", "act-replay-0001")
		other = _task(self.world["A"], "Replay target", "replay2")
		with self.assertRaises(frappe.ValidationError):
			action_service.add(other, "different task", "act-replay-0001")
		self.assertEqual(frappe.db.count("Masar Task Action", {"task": other}), 0)

	def test_actions_are_invisible_and_immutable_outside_the_space(self):
		task = _task(self.world["A"], "Private checklist", "iso")
		action = action_service.add(task, "secret step")["action"]["name"]
		as_user("b_member")
		for call in (
			lambda: action_service.list_actions(task),
			lambda: action_service.add(task, "injected"),
			lambda: action_service.update(action, "hijacked"),
			lambda: action_service.set_done(action, True),
			lambda: action_service.promote(action),
			lambda: action_service.delete(action),
		):
			with self.assertRaises(frappe.DoesNotExistError):
				call()
		names = {r.name for r in frappe.get_list("Masar Task Action", fields=["name"], limit_page_length=0)}
		self.assertNotIn(action, names)
		with self.assertRaises(frappe.PermissionError):
			frappe.client.get("Masar Task Action", action)
		as_user("a_member")  # even members cannot write through generic APIs
		with self.assertRaises(frappe.PermissionError):
			frappe.client.set_value("Masar Task Action", action, "title", "generic")
		with self.assertRaises(frappe.PermissionError):
			frappe.client.insert(
				{"doctype": "Masar Task Action", "task": task, "space": self.world["A"], "title": "x"}
			)
		self.assertEqual(frappe.db.get_value("Masar Task Action", action, "title"), "secret step")

	def test_lifecycle_applies_to_actions(self):
		as_user("admin")
		space = space_service.create({"title": "Action lifecycle", "owner": email("a_manager")})["name"]
		as_user("a_manager")
		space_service.add_member(space, email("a_member"), "Member")
		task = _task(space, "Lifecycle checklist", "life")
		action = action_service.add(task, "step")["action"]["name"]
		space_service.set_status(space, "Completed")
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			action_service.set_done(action, True)
		as_user("a_manager")
		action_service.set_done(action, True)  # Managers may wrap up
		space_service.set_status(space, "Closed")
		with self.assertRaises(frappe.PermissionError):
			action_service.add(task, "after close")
		with self.assertRaises(frappe.PermissionError):
			action_service.promote(action)

	def test_promotion_inherits_minimal_fields_once_with_lineage(self):
		parent = unassigned_task(self.world["A"], "Parent", f"p3-promo-{frappe.generate_hash(length=8)}")
		task_service.update(
			parent, {"priority": "High", "description": "<p>Not copied</p>", "isImportant": True}
		)
		task_service.add_assignee(parent, email("a_member"))
		task_service.add_assignee(parent, email("ab_member"))
		task_service.set_owner(parent, email("ab_member"))
		action = action_service.add(parent, "Write migration script")["action"]["name"]

		result = action_service.promote(action)
		self.assertTrue(result["created"])
		new = result["task"]
		self.assertEqual(
			(new["title"], new["space"], new["priority"], new["taskOwner"]),
			("Write migration script", self.world["A"], "High", email("ab_member")),
		)
		self.assertEqual(new["assignees"], [])  # the owner is inherited, assignment is not
		self.assertIsNone(new["description"])
		self.assertFalse(new["isImportant"])
		self.assertEqual(new["sourceTask"]["name"], parent)
		self.assertEqual(new["sourceAction"], action)
		self.assertEqual(result["action"]["promotedTask"], new["name"])

		again = action_service.promote(action)  # e.g. retry after a timeout
		self.assertFalse(again["created"])
		self.assertEqual(again["task"]["name"], new["name"])
		self.assertEqual(frappe.db.count("Masar Task", {"source_action": action}), 1)
		self.assertTrue(
			frappe.db.exists("Masar Activity", {"reference_name": parent, "event": "action_promoted"})
		)
		self.assertTrue(
			frappe.db.exists(
				"Masar Activity", {"reference_name": new["name"], "event": "promoted_from_action"}
			)
		)
		with self.assertRaises(frappe.ValidationError):
			action_service.update(action, "edit after promotion")
		listed = next(a for a in action_service.list_actions(parent) if a["name"] == action)
		self.assertIs(listed["promotedTaskCompleted"], False)

	def test_concurrent_promotion_is_stopped_by_the_durable_unique_guard(self):
		parent = _task(self.world["A"], "Race parent", "race")
		action = action_service.add(parent, "Raced step")["action"]["name"]
		# Simulate the winner of a concurrent request: its Task exists, the Action row is not updated yet.
		winner = frappe.get_doc(
			{
				"doctype": "Masar Task",
				"space": self.world["A"],
				"title": "Raced step",
				"source_action": action,
			}
		).insert(ignore_permissions=True)
		result = action_service.promote(action)
		self.assertFalse(result["created"])
		self.assertEqual(result["task"]["name"], winner.name)
		self.assertEqual(frappe.db.count("Masar Task", {"source_action": action}), 1)

	def test_deleting_tasks_keeps_lineage_consistent(self):
		parent = _task(self.world["A"], "Cascade parent", "cascade")
		action = action_service.add(parent, "Promote me")["action"]["name"]
		promoted = action_service.promote(action)["task"]["name"]
		task_service.delete(promoted)
		self.assertIsNone(frappe.db.get_value("Masar Task Action", action, "promoted_task"))
		self.assertTrue(action_service.promote(action)["created"])  # promotable again
		task_service.delete(parent)
		self.assertFalse(frappe.db.exists("Masar Task Action", action))


class TestLabelsWorkAndBulk(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		as_user("a_manager")

	def tearDown(self):
		frappe.local.response.pop("conflicts", None)
		frappe.set_user("Administrator")

	def test_labels_are_space_scoped_normalised_and_unique(self):
		as_user("a_member")
		backend = label_service.create(self.world["A"], "Backend", "info")["label"]
		same = label_service.create(self.world["A"], "  backend ", "error")
		self.assertFalse(same["created"])
		self.assertEqual(same["label"]["name"], backend["name"])
		for reserved in ("Important", "my  day"):
			with self.assertRaises(frappe.ValidationError):
				label_service.create(self.world["A"], reserved)
		as_user("b_member")
		other = label_service.create(self.world["B"], "Backend")["label"]
		self.assertNotEqual(other["name"], backend["name"])
		with self.assertRaises(frappe.DoesNotExistError):
			label_service.list_labels(self.world["A"])
		names = {r.name for r in frappe.get_list("Masar Label", fields=["name"], limit_page_length=0)}
		self.assertNotIn(backend["name"], names)

		as_user("a_member")
		task = _task(self.world["A"], "Labelled", "lbl")
		detail = task_service.add_label(task, backend["name"])
		self.assertEqual([lbl["title"] for lbl in detail["labels"]], ["Backend"])
		with self.assertRaises(frappe.ValidationError):
			task_service.add_label(task, other["name"])  # another Space's label
		with self.assertRaises(frappe.PermissionError):
			label_service.update(backend["name"], title="Renamed by member")
		as_user("a_manager")
		label_service.update(backend["name"], title="Server")
		removal = label_service.delete(backend["name"])
		self.assertEqual(removal["tasksUpdated"], 1)
		self.assertEqual(task_service.get_detail(task)["labels"], [])

	def test_my_work_filters_and_isolation(self):
		as_user("ab_member")
		mine_a = _task(self.world["A"], "AB work in A", "mw1")
		mine_b = _task(self.world["B"], "AB work in B", "mw2")
		task_service.add_assignee(mine_a, email("ab_member"))
		task_service.add_assignee(mine_b, email("ab_member"))
		task_service.update(
			mine_a, {"isImportant": True, "dueDate": add_days(nowdate(), -1), "priority": "High"}
		)
		task_service.update(mine_b, {"isMyDay": True, "dueDate": nowdate()})

		names = lambda **f: {t["name"] for t in task_service.my_work(**f)["items"]}  # noqa: E731
		self.assertTrue({mine_a, mine_b} <= names(assigned_to_me=True))
		self.assertIn(mine_a, names(important=True))
		self.assertNotIn(mine_b, names(important=True))
		self.assertIn(mine_b, names(my_day=True))
		self.assertIn(mine_a, names(due="overdue"))
		self.assertIn(mine_b, names(due="today"))
		self.assertEqual(names(space=self.world["B"], assigned_to_me=True) & {mine_a}, set())
		self.assertIn(mine_a, names(priority="High", assigned_to_me=True))
		self.assertIn(mine_a, names(q="work in A"))
		item = next(t for t in task_service.my_work(assigned_to_me=True)["items"] if t["name"] == mine_b)
		self.assertEqual(item["spaceTitle"], "Space B")

		as_user("a_member")  # member of A only
		self.assertNotIn(mine_b, names())
		with self.assertRaises(frappe.DoesNotExistError):
			task_service.my_work(space=self.world["B"])
		self.assertEqual([t for t in task_service.search("AB work") if t["space"] == self.world["B"]], [])
		self.assertEqual([t["name"] for t in task_service.lookup([mine_a, mine_b, "nonexistent"])], [mine_a])

		# Revocation: once removed from B, ab_member no longer sees B tasks anywhere.
		as_user("b_member")
		space_service.remove_member(self.world["B"], email("ab_member"))
		as_user("ab_member")
		self.assertNotIn(mine_b, names())
		self.assertEqual(task_service.lookup([mine_b]), [])
		self.assertEqual([t for t in task_service.search("AB work in B")], [])

	def test_my_work_pagination_is_stable(self):
		as_user("a_member")
		created = {_task(self.world["A"], f"Page MW {i}", f"pg{i}") for i in range(6)}
		for sort in ("recently_updated", "due_date"):
			seen, cursor = [], None
			for _ in range(10):
				page = task_service.my_work(q="Page MW", sort=sort, limit=4, cursor=cursor)
				seen.extend(t["name"] for t in page["items"])
				cursor = page["nextCursor"]
				if not cursor:
					break
			self.assertEqual(len(seen), len(set(seen)), sort)
			self.assertTrue(created <= set(seen), sort)

	def test_bulk_is_all_or_nothing_and_detects_conflicts(self):
		as_user("ab_member")
		t1 = _task(self.world["A"], "Bulk 1", "b1")
		t2 = _task(self.world["B"], "Bulk 2", "b2")
		result = task_service.bulk_update(
			[t1, t2], "priority", "Highest", expected={t1: "Medium", t2: "Medium"}
		)
		self.assertEqual(sorted(result["changed"]), sorted([t1, t2]))
		with self.assertRaises(MasarConflictError):
			task_service.bulk_update([t1, t2], "priority", "Low", expected={t1: "Medium", t2: "Highest"})
		self.assertEqual(frappe.db.get_value("Masar Task", t1, "priority"), "Highest")

		as_user("a_member")  # cannot touch t2 (Space B): nothing changes, no hint which task failed
		with self.assertRaises(frappe.DoesNotExistError):
			task_service.bulk_update([t1, t2], "priority", "Low")
		self.assertEqual(frappe.db.get_value("Masar Task", t1, "priority"), "Highest")

		as_user("a_manager")
		label = label_service.create(self.world["A"], "Bulk label")["label"]["name"]
		as_user("ab_member")
		with self.assertRaises(frappe.ValidationError):
			task_service.bulk_update([t1, t2], "add_label", label)  # label of A on a B task
		task_service.bulk_update([t1], "add_label", label)
		self.assertEqual(frappe.db.count("Masar Task Label", {"parent": t1, "label": label}), 1)
		with self.assertRaises(frappe.ValidationError):
			task_service.bulk_update([t1, t2], "add_assignee", email("a_member"))  # not a member of B
		task_service.bulk_update([t1], "add_assignee", email("a_member"))
		task_service.bulk_update([t1], "add_assignee", email("ab_member"))
		task_service.bulk_update([t1], "remove_assignee", email("a_member"))
		self.assertEqual(frappe.db.get_value("Masar Task", t1, "task_owner"), email("ab_member"))
		task_service.bulk_update([t1, t2], "set_completed", True, expected={t1: False, t2: False})
		self.assertEqual(frappe.db.get_value("Masar Task", t2, "is_completed"), 1)

	def test_bulk_respects_space_lifecycle(self):
		as_user("admin")
		closed = space_service.create({"title": "Closed bulk", "owner": email("a_manager")})["name"]
		as_user("a_manager")
		open_task = _task(self.world["A"], "Open bulk", "lc1")
		closed_task = _task(closed, "Closed bulk task", "lc2")
		space_service.set_status(closed, "Closed")
		with self.assertRaises(frappe.PermissionError):
			task_service.bulk_update([open_task, closed_task], "priority", "Low")
		self.assertEqual(frappe.db.get_value("Masar Task", open_task, "priority"), "Medium")
