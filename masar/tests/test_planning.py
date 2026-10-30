"""Phase 4: Features roadmap, Releases and their Task associations (real authorization)."""

import frappe
import frappe.client
from frappe.tests import IntegrationTestCase

from masar.exceptions import MasarConflictError
from masar.services import planning_service as planning
from masar.services import space_service, task_service
from masar.tests.fixtures import as_user, build_world, email


def _task(space, title, key):
	return task_service.create(space, title, f"p4-{key}-{frappe.generate_hash(length=8)}")["task"]["name"]


class PlanningCase(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		as_user("a_manager")

	def tearDown(self):
		frappe.local.response.pop("conflicts", None)
		frappe.set_user("Administrator")


class TestFeatures(PlanningCase):
	def test_create_list_progress_and_empty_state(self):
		feature = planning.create_feature(self.world["A"], "  Single   sign-on ", "Now")
		self.assertEqual(feature["title"], "Single sign-on")
		self.assertIsNone(feature["progress"]["percent"])  # no tasks: empty state, not 0 %
		t1 = _task(self.world["A"], "SSO backend", "prog1")
		t2 = _task(self.world["A"], "SSO frontend", "prog2")
		for t in (t1, t2):
			task_service.update(t, {"feature": feature["name"]})
		task_service.set_completed(t1, True)
		detail = planning.get_feature(feature["name"])
		self.assertEqual(detail["progress"], {"total": 2, "completed": 1, "open": 1, "percent": 50})
		listed = planning.list_features(self.world["A"])
		self.assertIn(feature["name"], [f["name"] for f in listed["items"]])
		self.assertTrue(listed["permissions"]["canManage"])
		with self.assertRaises(frappe.ValidationError):
			planning.create_feature(self.world["A"], "Bad column", "Someday")

	def test_roadmap_order_and_movement(self):
		as_user("admin")
		space = space_service.create({"title": "Roadmap order", "owner": email("a_manager")})["name"]
		as_user("a_manager")
		a = planning.create_feature(space, "A", "Next")["name"]
		b = planning.create_feature(space, "B", "Next")["name"]
		c = planning.create_feature(space, "C", "Later")["name"]
		planning.create_feature(space, "D", "Now")
		order = [(f["roadmap"], f["title"]) for f in planning.list_features(space)["items"]]
		self.assertEqual(order, [("Now", "D"), ("Next", "A"), ("Next", "B"), ("Later", "C")])
		# Move C between A and B; then B to the top of Now.
		moved = planning.move_feature(c, "Next", before=a, after=b, expected_roadmap="Later")
		self.assertEqual(moved["roadmap"], "Next")
		self.assertEqual(
			[f["title"] for f in planning.list_features(space)["items"] if f["roadmap"] == "Next"],
			["A", "C", "B"],
		)
		# Stale column: someone else already moved it.
		with self.assertRaises(MasarConflictError):
			planning.move_feature(c, "Done", expected_roadmap="Later")
		# Neighbours from another column mean the client's view is stale.
		with self.assertRaises(MasarConflictError):
			planning.move_feature(b, "Now", before=a)
		activity = frappe.get_all(
			"Masar Activity", filters={"reference_name": c, "event": "roadmap_changed"}, pluck="data"
		)
		self.assertEqual(len(activity), 1)

	def test_done_with_open_tasks_is_allowed_and_reported(self):
		feature = planning.create_feature(self.world["A"], "Reporting", "Now")["name"]
		task = _task(self.world["A"], "Report export", "done1")
		task_service.update(task, {"feature": feature})
		moved = planning.move_feature(feature, "Done", expected_roadmap="Now")
		self.assertEqual(moved["roadmap"], "Done")
		self.assertEqual(moved["openTasks"], 1)
		# Roadmap and task completion are independent.
		self.assertEqual(frappe.db.get_value("Masar Task", task, "is_completed"), 0)

	def test_members_link_tasks_but_cannot_manage_features(self):
		feature = planning.create_feature(self.world["A"], "Members view", "Later")["name"]
		as_user("a_member")
		self.assertFalse(planning.list_features(self.world["A"])["permissions"]["canManage"])
		task = _task(self.world["A"], "Member task", "mem1")
		task_service.update(task, {"feature": feature})
		self.assertEqual(task_service.get_detail(task)["feature"]["name"], feature)
		for call in (
			lambda: planning.create_feature(self.world["A"], "Nope"),
			lambda: planning.update_feature(feature, {"title": "Renamed"}),
			lambda: planning.move_feature(feature, "Now"),
			lambda: planning.delete_feature(feature),
		):
			with self.assertRaises(frappe.PermissionError):
				call()

	def test_features_are_invisible_outside_the_space(self):
		feature = planning.create_feature(self.world["A"], "Secret roadmap item")["name"]
		as_user("b_member")
		for call in (
			lambda: planning.get_feature(feature),
			lambda: planning.list_features(self.world["A"]),
			lambda: planning.update_feature(feature, {"title": "x"}),
			lambda: planning.move_feature(feature, "Now"),
			lambda: planning.delete_feature(feature, detach=True),
		):
			with self.assertRaises(frappe.DoesNotExistError):
				call()
		self.assertNotIn(feature, [r.name for r in frappe.get_list("Masar Feature", pluck="name")])
		with self.assertRaises(frappe.PermissionError):
			frappe.client.set_value("Masar Feature", feature, "title", "hijack")
		# A Task of B cannot point at a Feature of A.
		b_task = _task(self.world["B"], "B task", "iso1")
		with self.assertRaises(frappe.ValidationError):
			task_service.update(b_task, {"feature": feature})

	def test_generic_writes_are_denied_even_for_managers(self):
		feature = planning.create_feature(self.world["A"], "Generic write")["name"]
		with self.assertRaises(frappe.PermissionError):
			frappe.client.set_value("Masar Feature", feature, "roadmap", "Done")
		with self.assertRaises(frappe.PermissionError):
			frappe.client.insert({"doctype": "Masar Feature", "space": self.world["A"], "title": "Sneaky"})

	def test_delete_never_cascades_and_requires_explicit_detach(self):
		feature = planning.create_feature(self.world["A"], "To delete")["name"]
		task = _task(self.world["A"], "Keeps living", "del1")
		task_service.update(task, {"feature": feature})
		with self.assertRaises(MasarConflictError):
			planning.delete_feature(feature)
		self.assertTrue(frappe.db.exists("Masar Feature", feature))
		result = planning.delete_feature(feature, detach=True)
		self.assertEqual(result["tasksDetached"], 1)
		self.assertFalse(frappe.db.exists("Masar Feature", feature))
		self.assertTrue(frappe.db.exists("Masar Task", task))
		self.assertIsNone(frappe.db.get_value("Masar Task", task, "feature"))

	def test_space_lifecycle_applies(self):
		as_user("admin")
		space = space_service.create({"title": "Lifecycle roadmap", "owner": email("a_manager")})["name"]
		as_user("a_manager")
		feature = planning.create_feature(space, "Wrap-up")["name"]
		space_service.set_status(space, "Completed")
		planning.move_feature(feature, "Done")  # Managers may still wrap up
		space_service.set_status(space, "Closed")
		with self.assertRaises(frappe.PermissionError):
			planning.move_feature(feature, "Now")
		self.assertFalse(planning.list_features(space)["permissions"]["canManage"])


class TestReleases(PlanningCase):
	def test_version_uniqueness_is_normalised_per_space(self):
		r = planning.create_release(self.world["A"], "  v1.0 ", "2026-12-01")
		self.assertEqual(r["releaseName"], "v1.0")
		self.assertEqual(r["status"], "Planned")
		for duplicate in ("v1.0", "V1.0", " v1.0  "):
			with self.assertRaises(frappe.DuplicateEntryError):
				planning.create_release(self.world["A"], duplicate)
		as_user("b_member")
		planning.create_release(self.world["B"], "v1.0")  # other Space: allowed
		as_user("a_manager")
		other = planning.create_release(self.world["A"], "v1.1")["name"]
		with self.assertRaises(frappe.DuplicateEntryError):
			planning.update_release(other, {"releaseName": "V1.0"})

	def test_lifecycle_open_task_warning_and_archived_freeze(self):
		release = planning.create_release(self.world["A"], "2026.11")["name"]
		task = _task(self.world["A"], "Ship it", "rel1")
		task_service.update(task, {"release": release})
		released = planning.set_release_status(release, "Released", expected_status="Planned")
		self.assertEqual(released["openTasks"], 1)
		self.assertEqual(released["releasedBy"]["name"], email("a_manager"))
		self.assertIsNotNone(released["releasedAt"])
		with self.assertRaises(MasarConflictError):
			planning.set_release_status(release, "Archived", expected_status="Planned")
		archived = planning.set_release_status(release, "Archived", expected_status="Released")
		self.assertFalse(archived["permissions"]["canLinkTasks"])
		# Archived: definition read-only, links frozen in both directions, deletion refused.
		with self.assertRaises(frappe.PermissionError):
			planning.update_release(release, {"notes": "late edit"})
		with self.assertRaises(frappe.ValidationError):
			task_service.update(task, {"release": None})
		other = _task(self.world["A"], "Too late", "rel2")
		with self.assertRaises(frappe.ValidationError):
			task_service.update(other, {"release": release})
		with self.assertRaises(frappe.PermissionError):
			planning.delete_release(release, detach=True)
		# Other task fields stay editable.
		task_service.update(task, {"priority": "High"})
		restored = planning.set_release_status(release, "Planned")
		self.assertIsNone(restored["releasedAt"])
		task_service.update(other, {"release": release})

	def test_invalid_transition_and_permissions(self):
		release = planning.create_release(self.world["A"], "perm-check")["name"]
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			planning.set_release_status(release, "Released")
		with self.assertRaises(frappe.PermissionError):
			planning.create_release(self.world["A"], "member release")
		self.assertEqual(planning.get_release(release)["allowedStatuses"], [])
		as_user("outsider")
		with self.assertRaises(frappe.DoesNotExistError):
			planning.get_release(release)
		with self.assertRaises(frappe.DoesNotExistError):
			planning.list_releases(self.world["A"])
		as_user("a_manager")
		with self.assertRaises(frappe.ValidationError):
			planning.set_release_status(release, "Shipped")

	def test_delete_requires_detach_and_keeps_tasks(self):
		release = planning.create_release(self.world["A"], "delete-me")["name"]
		task = _task(self.world["A"], "Survivor", "rdel")
		task_service.update(task, {"release": release})
		with self.assertRaises(MasarConflictError):
			planning.delete_release(release)
		self.assertEqual(planning.delete_release(release, detach=True)["tasksDetached"], 1)
		self.assertIsNone(frappe.db.get_value("Masar Task", task, "target_release"))

	def test_list_filter_and_search(self):
		as_user("admin")
		space = space_service.create({"title": "Release list", "owner": email("a_manager")})["name"]
		as_user("a_manager")
		planning.create_release(space, "Alpha", "2026-12-10")
		planning.create_release(space, "Beta", "2026-11-10")
		gamma = planning.create_release(space, "Gamma")["name"]
		planning.set_release_status(gamma, "Released")
		names = [r["releaseName"] for r in planning.list_releases(space)["items"]]
		self.assertEqual(names, ["Beta", "Alpha", "Gamma"])
		self.assertEqual(
			[r["releaseName"] for r in planning.list_releases(space, status="Released")["items"]], ["Gamma"]
		)
		self.assertEqual(
			[r["releaseName"] for r in planning.list_releases(space, q="alp")["items"]], ["Alpha"]
		)


class TestTaskPlanningLinks(PlanningCase):
	def test_filters_combine_server_side_and_none(self):
		feature = planning.create_feature(self.world["A"], "Filter feature")["name"]
		release = planning.create_release(self.world["A"], "filter-rel")["name"]
		both = _task(self.world["A"], "Both linked", "f1")
		only_feature = _task(self.world["A"], "Feature only", "f2")
		task_service.update(both, {"feature": feature, "release": release, "priority": "High"})
		task_service.update(only_feature, {"feature": feature})
		names = lambda **f: [t["name"] for t in task_service.list_tasks(self.world["A"], **f)["items"]]  # noqa: E731
		self.assertEqual(set(names(feature=feature)), {both, only_feature})
		self.assertEqual(names(feature=feature, release=release), [both])
		self.assertEqual(names(feature=feature, release="none"), [only_feature])
		self.assertEqual(names(feature=feature, priority="High"), [both])
		self.assertNotIn(both, names(feature="none"))
		row = next(
			t for t in task_service.list_tasks(self.world["A"], feature=feature)["items"] if t["name"] == both
		)
		self.assertEqual(row["feature"]["title"], "Filter feature")
		self.assertEqual(row["release"]["title"], "filter-rel")
		# Across Spaces (All Tasks) a Feature filter works when its Space is one of the caller's Spaces;
		# other Spaces' records are still rejected.
		self.assertEqual(set(t["name"] for t in task_service.my_work(feature=feature)["items"]), {both, only_feature})
		self.assertIsInstance(task_service.my_work(feature="none")["items"], list)
		as_user("ab_member")
		with self.assertRaises(frappe.ValidationError):
			task_service.list_tasks(self.world["B"], feature=feature)
		with self.assertRaises(frappe.ValidationError):
			task_service.my_work(space=self.world["B"], release=release)

	def test_bulk_set_feature_and_release(self):
		feature = planning.create_feature(self.world["A"], "Bulk feature")["name"]
		release = planning.create_release(self.world["A"], "bulk-rel")["name"]
		t1 = _task(self.world["A"], "Bulk 1", "b1")
		t2 = _task(self.world["A"], "Bulk 2", "b2")
		result = task_service.bulk_update([t1, t2], "set_feature", feature)
		self.assertEqual(set(result["changed"]), {t1, t2})
		task_service.bulk_update([t1, t2], "set_release", release, expected={t1: None, t2: None})
		with self.assertRaises(MasarConflictError):
			task_service.bulk_update([t1], "set_release", None, expected={t1: None})
		task_service.bulk_update([t1], "set_feature", None)
		self.assertIsNone(frappe.db.get_value("Masar Task", t1, "feature"))
		# Cross-Space selection with a Space-bound value is refused as a whole.
		as_user("ab_member")
		b_task = _task(self.world["B"], "Bulk B", "b3")
		with self.assertRaises(frappe.ValidationError):
			task_service.bulk_update([t2, b_task], "set_feature", feature)
		self.assertIsNone(frappe.db.get_value("Masar Task", b_task, "feature"))
		# Archived Release: the whole bulk request fails and nothing changes.
		as_user("a_manager")
		planning.set_release_status(release, "Archived")
		t3 = _task(self.world["A"], "Bulk 3", "b4")
		with self.assertRaises(frappe.ValidationError):
			task_service.bulk_update([t3], "set_release", release)
		self.assertIsNone(frappe.db.get_value("Masar Task", t3, "target_release"))

	def test_link_changes_are_recorded_in_history(self):
		feature = planning.create_feature(self.world["A"], "History feature")["name"]
		task = _task(self.world["A"], "History", "h1")
		task_service.update(task, {"feature": feature}, base={"feature": None})
		events = frappe.get_all(
			"Masar Activity", filters={"reference_name": task, "event": "field_changed"}, pluck="data"
		)
		self.assertTrue(any('"feature"' in e for e in events))
		with self.assertRaises(MasarConflictError):
			task_service.update(task, {"feature": None}, base={"feature": None})


class TestPlanningIntegrity(PlanningCase):
	def test_duplicate_slot_is_renumbered(self):
		as_user("admin")
		space = space_service.create({"title": "Slots", "owner": email("a_manager")})["name"]
		as_user("a_manager")
		a = planning.create_feature(space, "A", "Now")["name"]
		b = planning.create_feature(space, "B", "Now")["name"]
		c = planning.create_feature(space, "C", "Later")["name"]
		d = planning.create_feature(space, "D", "Later")["name"]
		# Two clients drop different Features into the same gap between A and B.
		planning.move_feature(c, "Now", before=a, after=b)
		planning.move_feature(d, "Now", before=a, after=b)
		orders = frappe.get_all(
			"Masar Feature", filters={"space": space, "roadmap": "Now"}, pluck="sort_order"
		)
		self.assertEqual(len(orders), len(set(orders)))
		titles = [f["title"] for f in planning.list_features(space)["items"]]
		self.assertEqual(titles[0], "A")
		self.assertEqual(titles[-1], "B")

	def test_invalid_and_deleted_references(self):
		task = _task(self.world["A"], "References", "ref1")
		for field in ("feature", "release"):
			with self.assertRaises(frappe.ValidationError):
				task_service.update(task, {field: "does-not-exist"})
			with self.assertRaises(frappe.ValidationError):
				task_service.list_tasks(self.world["A"], **{field: "does-not-exist"})
		with self.assertRaises(frappe.DoesNotExistError):
			planning.get_feature("does-not-exist")
		with self.assertRaises(frappe.DoesNotExistError):
			planning.move_feature("does-not-exist", "Now")

	def test_generic_task_write_cannot_bypass_link_rules(self):
		feature = planning.create_feature(self.world["A"], "Generic task link")["name"]
		as_user("ab_member")
		b_task = _task(self.world["B"], "Generic B", "gen1")
		with self.assertRaises(frappe.PermissionError):
			frappe.client.set_value("Masar Task", b_task, "feature", feature)
		self.assertIsNone(frappe.db.get_value("Masar Task", b_task, "feature"))

	def test_link_search_only_returns_member_spaces(self):
		from frappe.desk.search import search_link

		feature = planning.create_feature(self.world["A"], "Searchable roadmap item")["name"]
		release = planning.create_release(self.world["A"], "searchable-9.9")["name"]
		as_user("b_member")
		self.assertNotIn(feature, [r["value"] for r in search_link("Masar Feature", "Searchable")])
		self.assertNotIn(release, [r["value"] for r in search_link("Masar Release", "searchable")])
		as_user("a_member")
		self.assertIn(feature, [r["value"] for r in search_link("Masar Feature", "Searchable")])

	def test_progress_counts_only_linked_tasks_of_the_space(self):
		feature = planning.create_feature(self.world["A"], "Counting")["name"]
		tasks = [_task(self.world["A"], f"Count {i}", f"cnt{i}") for i in range(3)]
		task_service.bulk_update(tasks, "set_feature", feature)
		task_service.set_completed(tasks[0], True)
		task_service.set_completed(tasks[1], True)
		task_service.set_completed(tasks[1], False)  # reopened
		progress = planning.get_feature(feature)["progress"]
		self.assertEqual((progress["completed"], progress["total"], progress["percent"]), (1, 3, 33))
		self.assertEqual(planning.get_feature(feature)["roadmap"], "Later")  # unchanged by completion
