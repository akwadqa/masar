"""Phase 5: Batches across Spaces — lifecycle, viewer-scoped visibility, history and integrity.
Covers the directive's security matrix A–O with real authorization (no mocks except simulated
transient database errors)."""

import frappe
import frappe.client
from frappe.tests import IntegrationTestCase

from masar.exceptions import MasarConflictError
from masar.permissions import clear_membership_cache
from masar.services import batch_service as batches
from masar.services import planning_service, space_service, task_service
from masar.tests.fixtures import as_user, build_world, email, make_space
from masar.tests.test_concurrency import http_write
from masar.utils import context


def _task(space, title):
	return task_service.create(space, title, f"p5-{frappe.generate_hash(length=12)}")["task"]["name"]


def _key():
	return f"req-{frappe.generate_hash(length=16)}"


def _set_role(space, user_key, role):
	frappe.db.set_value("Masar Space Member", {"parent": space, "user": email(user_key)}, "role", role)
	clear_membership_cache()


class BatchCase(IntegrationTestCase):
	"""World: A (a_manager M; a_member, ab_member) · B (b_member M; ab_member) ·
	C (a_manager M; outsider m) per test, so a_manager plans across A and C."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		frappe.set_user("Administrator")
		self.C = make_space(f"Space C {frappe.generate_hash(length=6)}", ["a_manager"], ["outsider"])
		clear_membership_cache()
		as_user("a_manager")

	def tearDown(self):
		frappe.local.response.pop("conflicts", None)
		frappe.set_user("Administrator")

	def _batch(self, name="Batch", start="2026-11-02", preset="one_week"):
		return batches.create_batch(name, start, preset=preset)["batch"]["name"]

	def _planned_batch_with(self, a=2, c=1):
		batch = self._batch()
		tasks_a = [_task(self.world["A"], f"A{i}") for i in range(a)]
		tasks_c = [_task(self.C, f"C{i}") for i in range(c)]
		batches.move_tasks(tasks_a + tasks_c, batch)
		return batch, tasks_a, tasks_c


class TestBatchBasics(BatchCase):
	def test_presets_are_inclusive_calendar_days(self):
		self.assertEqual(batches.end_for_preset("2026-11-02", "one_week"), "2026-11-08")  # Mon → Sun
		self.assertEqual(batches.end_for_preset("2026-11-02", "two_weeks"), "2026-11-15")
		self.assertEqual(batches.end_for_preset("2026-12-28", "one_week"), "2027-01-03")  # year boundary
		created = batches.create_batch("Two weeks", "2026-11-02", preset="two_weeks")["batch"]
		self.assertEqual((created["endDate"], created["durationDays"]), ("2026-11-15", 14))
		with self.assertRaises(frappe.ValidationError):
			batches.create_batch("Backwards", "2026-11-10", end_date="2026-11-09")

	def test_only_space_managers_create_and_creation_is_idempotent(self):
		key = _key()
		first = batches.create_batch("Idempotent", "2026-11-02", preset="one_week", client_request_id=key)
		again = batches.create_batch("Idempotent", "2026-11-02", preset="one_week", client_request_id=key)
		self.assertEqual(first["batch"]["name"], again["batch"]["name"])
		self.assertFalse(again["created"])
		self.assertEqual(frappe.db.count("Masar Batch", {"client_request_id": key}), 1)
		with self.assertRaises(frappe.ValidationError):  # same key, different Batch
			batches.create_batch("Other", "2026-11-02", preset="one_week", client_request_id=key)
		for user in ("a_member", "outsider"):
			as_user(user)
			with self.assertRaises(frappe.PermissionError):
				batches.create_batch("Nope", "2026-11-02", preset="one_week")

	def test_cross_space_planning_keeps_each_task_in_its_space(self):
		batch, tasks_a, tasks_c = self._planned_batch_with()
		listed = batches.batch_tasks(batch)["items"]
		self.assertEqual({t["name"] for t in listed}, set(tasks_a + tasks_c))
		self.assertEqual({t["space"] for t in listed}, {self.world["A"], self.C})
		self.assertTrue(all(t["batch"]["name"] == batch for t in listed))
		self.assertEqual(frappe.db.get_value("Masar Task", tasks_c[0], "space"), self.C)
		detail = batches.get_batch(batch)
		self.assertEqual(detail["progress"]["total"], 3)
		self.assertTrue(detail["canManage"])

	def test_planned_metadata_edits_and_deletion(self):
		batch = self._batch()
		updated = batches.update_batch(
			batch, {"batchName": "Renamed", "endDate": "2026-11-12"}, base={"batchName": "Batch"}
		)
		self.assertEqual((updated["batchName"], updated["endDate"]), ("Renamed", "2026-11-12"))
		with self.assertRaises(MasarConflictError):
			batches.update_batch(batch, {"batchName": "Stale"}, base={"batchName": "Batch"})
		# Client revision 3: deleting a Planned Batch returns its Tasks to the Backlog first.
		task = _task(self.world["A"], "Returns to the Backlog")
		batches.move_tasks([task], batch)
		batches.delete_batch(batch)
		self.assertFalse(frappe.db.exists("Masar Batch", batch))
		self.assertFalse(frappe.db.exists("Masar Batch Item", {"batch": batch}))
		self.assertFalse(frappe.db.exists("Masar Batch Item", {"current_task": task}))
		self.assertTrue(frappe.db.exists("Masar Task", task))

	def test_only_planned_batches_can_be_deleted(self):
		batch = self._batch()
		batches.start_batch(batch, request_id=frappe.generate_hash(length=16))
		with self.assertRaises(frappe.ValidationError):
			batches.delete_batch(batch)


class TestBatchVisibility(BatchCase):
	def test_A_E_partial_viewers_see_only_their_spaces(self):
		batch, tasks_a, tasks_c = self._planned_batch_with(a=7, c=5)
		task_service.set_completed(tasks_a[0], True)
		task_service.set_completed(tasks_c[0], True)
		task_service.set_completed(tasks_c[1], True)
		for user, expected_tasks, completed in (("a_member", tasks_a, 1), ("outsider", tasks_c, 2)):
			as_user(user)
			detail = batches.get_batch(batch)
			self.assertEqual(detail["progress"]["total"], len(expected_tasks), user)
			self.assertEqual(detail["progress"]["completed"], completed, user)
			self.assertEqual({t["name"] for t in batches.batch_tasks(batch)["items"]}, set(expected_tasks))
			self.assertFalse(detail["canManage"])
			self.assertFalse(detail["ownerLacksAccess"])  # only the owner is told about scope
			listed = next(b for b in batches.list_batches()["items"] if b["name"] == batch)
			self.assertEqual(listed["progress"]["total"], len(expected_tasks))
			# Nothing in the payload names the other Space.
			other = self.C if user == "a_member" else self.world["A"]
			self.assertNotIn(other, frappe.as_json(detail) + frappe.as_json(listed))

	def test_unrelated_users_cannot_see_the_batch(self):
		batch, *_ = self._planned_batch_with()
		as_user("b_member")
		with self.assertRaises(frappe.DoesNotExistError):
			batches.get_batch(batch)
		self.assertNotIn(batch, [b["name"] for b in batches.list_batches()["items"]])
		for call in (lambda: batches.batch_tasks(batch), lambda: batches.batch_history(batch)):
			with self.assertRaises(frappe.DoesNotExistError):
				call()
		with self.assertRaises(frappe.DoesNotExistError):
			task_service.my_work(batch=batch)

	def test_B_L_generic_apis_cannot_bypass_batch_rules(self):
		batch, tasks_a, tasks_c = self._planned_batch_with()
		a_item = frappe.db.get_value("Masar Batch Item", {"task": tasks_a[0]}, "name")
		as_user("outsider")
		visible = frappe.get_list("Masar Batch Item", pluck="name", limit_page_length=0)
		self.assertNotIn(a_item, visible)
		self.assertTrue(
			set(visible) >= set(frappe.get_all("Masar Batch Item", {"task": ["in", tasks_c]}, pluck="name"))
		)
		with self.assertRaises(frappe.PermissionError):
			frappe.client.get("Masar Batch Item", a_item)
		as_user("a_manager")  # even the owner cannot write through generic APIs
		with self.assertRaises(frappe.PermissionError):
			frappe.client.set_value("Masar Batch", batch, "status", "Finished")
		with self.assertRaises(frappe.PermissionError):
			frappe.client.insert(
				{"doctype": "Masar Batch Item", "batch": batch, "task": tasks_a[0], "space": self.world["A"]}
			)
		with self.assertRaises(frappe.PermissionError):
			frappe.client.delete("Masar Batch Item", a_item)

	def test_M_search_and_filters_do_not_reveal_batches(self):
		from frappe.desk.search import search_link

		batch, *_ = self._planned_batch_with()
		as_user("b_member")
		self.assertNotIn(batch, [r["value"] for r in search_link("Masar Batch", "Batch")])
		with self.assertRaises(frappe.DoesNotExistError):
			task_service.list_tasks(self.world["B"], batch=batch)

	def test_F_revoked_membership_removes_access_immediately(self):
		batch, *_ = self._planned_batch_with()
		as_user("outsider")
		self.assertEqual(batches.get_batch(batch)["progress"]["total"], 1)
		frappe.set_user("Administrator")
		space = frappe.get_doc("Masar Space", self.C)
		space.set("members", [m for m in space.members if m.user != email("outsider")])
		space.save(ignore_permissions=True)
		as_user("outsider")
		with self.assertRaises(frappe.DoesNotExistError):
			batches.get_batch(batch)
		self.assertNotIn(batch, [b["name"] for b in batches.list_batches()["items"]])

	def test_space_tab_counts_only_that_space(self):
		batch, tasks_a, tasks_c = self._planned_batch_with(a=3, c=2)
		batches.start_batch(batch)
		row = next(
			b for b in batches.list_batches(status="Active", space=self.C)["items"] if b["name"] == batch
		)
		self.assertEqual(row["progress"]["total"], 2)
		row = next(
			b
			for b in batches.list_batches(status="Active", space=self.world["A"])["items"]
			if b["name"] == batch
		)
		self.assertEqual(row["progress"]["total"], 3)


class TestBatchAuthority(BatchCase):
	def test_C_D_unauthorized_and_mixed_assignments_change_nothing(self):
		batch, *_ = self._planned_batch_with(a=1, c=0)
		as_user("b_member")
		b_task = _task(self.world["B"], "B task")
		with self.assertRaises(frappe.DoesNotExistError):  # cannot even see another owner's Batch
			batches.move_tasks([b_task], batch)
		as_user("a_manager")
		a_task = _task(self.world["A"], "A mixed")
		with self.assertRaises(frappe.DoesNotExistError):  # B task is invisible: whole request refused
			task_service.bulk_update([a_task, b_task], "set_batch", batch)
		self.assertFalse(frappe.db.exists("Masar Batch Item", {"task": a_task}))
		as_user("a_member")  # a Member cannot plan, even their own Space's tasks
		with self.assertRaises(frappe.PermissionError):
			batches.move_tasks([a_task], batch)

	def test_G_owner_without_authority_over_every_space_is_denied(self):
		batch, *_ = self._planned_batch_with()
		frappe.set_user("Administrator")
		_set_role(self.C, "a_manager", "Member")
		as_user("a_manager")
		self.assertTrue(batches.get_batch(batch)["ownerLacksAuthority"])
		for call in (
			lambda: batches.start_batch(batch),
			lambda: batches.update_batch(batch, {"batchName": "x"}),
			lambda: batches.move_tasks([_task(self.world["A"], "late")], batch),
		):
			with self.assertRaises(frappe.PermissionError):
				call()

	def test_ownership_transfer_and_recovery(self):
		frappe.set_user("Administrator")
		space = make_space(f"Shared {frappe.generate_hash(length=6)}", ["a_manager", "ab_member"], [])
		clear_membership_cache()
		as_user("a_manager")
		batch = self._batch()
		batches.move_tasks([_task(space, "shared")], batch)
		with self.assertRaises(frappe.ValidationError):  # new owner must manage every Space in it
			batches.transfer_ownership(batch, email("outsider"))
		# The owner loses authority: a full-scope Manager may claim the Batch.
		frappe.set_user("Administrator")
		_set_role(space, "a_manager", "Member")
		as_user("ab_member")
		self.assertTrue(batches.get_batch(batch)["canClaim"])
		claimed = batches.transfer_ownership(batch, email("ab_member"), expected_owner=email("a_manager"))
		self.assertTrue(claimed["isOwner"] and claimed["canManage"])
		as_user("a_member")
		with self.assertRaises(frappe.DoesNotExistError):  # cannot even see it
			batches.transfer_ownership(batch, email("a_member"))


class TestBatchLifecycle(BatchCase):
	def test_start_is_explicit_idempotent_and_changes_no_task(self):
		batch, tasks_a, _ = self._planned_batch_with()
		key = _key()
		started = batches.start_batch(batch, key)
		self.assertEqual(started["status"], "Active")
		self.assertIsNotNone(started["startedAt"])
		self.assertEqual(batches.start_batch(batch, key)["status"], "Active")  # replay
		with self.assertRaises(MasarConflictError):
			batches.start_batch(batch, _key())
		self.assertEqual(
			frappe.db.count("Masar Activity", {"reference_name": batch, "event": "batch_started"}), 1
		)
		self.assertEqual(frappe.db.get_value("Masar Task", tasks_a[0], "is_completed"), 0)
		with self.assertRaises(frappe.PermissionError):  # metadata is fixed once started
			batches.update_batch(batch, {"batchName": "x"})
		second = self._batch("Parallel")
		batches.move_tasks([_task(self.world["A"], "parallel")], second)
		self.assertEqual(batches.start_batch(second)["status"], "Active")  # several Active Batches

	def test_H_one_current_batch_per_task(self):
		first, tasks_a, _ = self._planned_batch_with(a=1, c=0)
		second = self._batch("Second")
		batches.move_tasks(tasks_a, second)  # a move, never a second membership
		self.assertEqual(frappe.db.count("Masar Batch Item", {"current_task": tasks_a[0]}), 1)
		self.assertEqual(task_service.get_detail(tasks_a[0])["batch"]["name"], second)
		with self.assertRaises(MasarConflictError):  # stale expectation
			task_service.bulk_update(tasks_a, "set_batch", first, expected={tasks_a[0]: first})
		frappe.set_user("Administrator")
		with self.assertRaises((frappe.UniqueValidationError, frappe.DuplicateEntryError)):  # database guard
			frappe.get_doc(
				{
					"doctype": "Masar Batch Item",
					"batch": first,
					"task": tasks_a[0],
					"space": self.world["A"],
					"current_task": tasks_a[0],
				}
			).insert(ignore_permissions=True)

	def test_J_K_scope_changes_finish_snapshot_and_history(self):
		batch, tasks_a, tasks_c = self._planned_batch_with(a=2, c=2)
		batches.start_batch(batch)
		late = _task(self.world["A"], "late")
		batches.move_tasks([late], batch)  # scope change after start
		batches.move_tasks([tasks_c[1]], None)  # removed during the Batch
		task_service.set_completed(tasks_a[0], True)
		dest = self._batch("Next sprint", start="2026-11-09")
		preview = batches.finish_preview(batch)
		self.assertEqual((preview["completed"], preview["unfinished"]), (1, 3))
		self.assertIn(dest, [d["name"] for d in preview["destinations"]])
		result = batches.finish_batch(batch, "Batch", dest, _key())
		self.assertEqual((result["completed"], result["carriedOver"], result["returned"]), (1, 3, 0))
		self.assertEqual(result["batch"]["status"], "Finished")
		progress = result["batch"]["progress"]
		self.assertEqual(
			(progress["total"], progress["completed"], progress["addedAfterStart"], progress["removed"]),
			(4, 1, 1, 1),
		)
		# Carried Tasks are current in the destination exactly once; nothing was duplicated or completed.
		self.assertEqual(
			frappe.db.count("Masar Batch Item", {"batch": dest, "current_task": ["is", "set"]}), 3
		)
		self.assertEqual(frappe.db.count("Masar Task", {"title": "late"}), 1)
		self.assertEqual(frappe.db.get_value("Masar Task", tasks_a[1], "is_completed"), 0)
		# K: reopening and completing after the finish never changes the frozen result.
		task_service.set_completed(tasks_a[0], False)
		task_service.set_completed(tasks_a[1], True)
		after = batches.get_batch(batch)["progress"]
		self.assertEqual((after["total"], after["completed"]), (4, 1))
		history = {h["task"]["name"]: h for h in batches.batch_history(batch) if h["task"]}
		self.assertEqual(history[tasks_a[0]]["outcome"], "Completed")
		self.assertTrue(history[tasks_a[0]]["completedAtFinish"])
		self.assertEqual(history[tasks_a[1]]["outcome"], "Carried Over")
		self.assertEqual(history[tasks_a[1]]["carriedTo"]["name"], dest)
		self.assertEqual(history[tasks_c[1]]["outcome"], "Removed")
		self.assertTrue(history[late]["addedAfterStart"])
		# Finished Batches are read-only planning records.
		with self.assertRaises(frappe.PermissionError):
			batches.move_tasks([_task(self.world["A"], "too late")], batch)

	def test_finish_returns_unfinished_work_and_closed_spaces(self):
		batch, tasks_a, tasks_c = self._planned_batch_with(a=1, c=1)
		batches.start_batch(batch)
		dest = self._batch("Dest")
		space_service.set_status(self.C, "Closed")
		result = batches.finish_batch(batch, "Batch", dest, _key())
		self.assertEqual((result["carriedOver"], result["returned"]), (1, 1))  # Closed Space → unbatched
		self.assertEqual(task_service.get_detail(tasks_c[0])["batch"], None)
		other = self._batch("Other")
		batches.move_tasks([_task(self.world["A"], "o")], other)
		batches.start_batch(other)
		result = batches.finish_batch(other, "Unbatched", None, _key())
		self.assertEqual(result["returned"], 1)
		self.assertEqual(
			task_service.list_tasks(self.world["A"], batch="none", q="o", completed="all")["items"][0][
				"batch"
			],
			None,
		)

	def test_N_lifecycle_validation(self):
		batch, *_ = self._planned_batch_with()
		with self.assertRaises(frappe.ValidationError):  # Planned cannot be finished
			batches.finish_batch(batch, "Unbatched", None, _key())
		batches.start_batch(batch)
		with self.assertRaises(frappe.ValidationError):  # destination must be Planned
			active = self._batch("Active dest")
			batches.move_tasks([_task(self.world["A"], "x")], active)
			batches.start_batch(active)
			batches.finish_batch(batch, "Batch", active, _key())
		with self.assertRaises(frappe.ValidationError):
			batches.finish_batch(batch, "Somewhere", None, _key())
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			batches.finish_batch(batch, "Unbatched", None, _key())

	def test_I_O_repeated_and_retried_finish_is_applied_once(self):
		batch, *_ = self._planned_batch_with(a=2, c=1)
		batches.start_batch(batch)
		key = _key()
		attempts = []

		def finish_then_fail_once():
			attempts.append(1)
			result = batches.finish_batch(batch, "Unbatched", None, key)
			if len(attempts) == 1:
				raise frappe.QueryDeadlockError("1020 after the work, before commit")
			return result

		with http_write():
			result = context.masar_write(finish_then_fail_once)()
		self.assertEqual(len(attempts), 2)
		self.assertEqual(result["returned"], 3)
		replay = batches.finish_batch(batch, "Unbatched", None, key)  # lost response: same answer
		self.assertEqual(replay["returned"], 3)
		with self.assertRaises(MasarConflictError):  # a different finish of the same Batch
			batches.finish_batch(batch, "Unbatched", None, _key())
		# Another viewer replaying the finisher's key learns nothing beyond a conflict, and the key
		# is not readable through generic document APIs.
		as_user("outsider")
		with self.assertRaises(MasarConflictError):
			batches.finish_batch(batch, "Unbatched", None, key)
		self.assertIsNone(frappe.client.get("Masar Batch", batch).get("finish_request_id"))  # masked
		self.assertNotIn(
			key, frappe.as_json(frappe.get_list("Masar Batch", fields=["*"], limit_page_length=0))
		)
		as_user("a_manager")
		self.assertEqual(frappe.db.count("Masar Batch Item", {"batch": batch}), 3)
		self.assertEqual(
			frappe.db.count("Masar Activity", {"reference_name": batch, "event": "batch_finished"}), 1
		)

	def test_deleting_a_task_keeps_batch_history(self):
		batch, tasks_a, _ = self._planned_batch_with(a=2, c=0)
		batches.start_batch(batch)
		task_service.set_completed(tasks_a[0], True)
		result = batches.finish_batch(batch, "Unbatched", None, _key())
		task_service.delete(tasks_a[0])
		after = batches.get_batch(batch)["progress"]
		self.assertEqual((after["total"], after["completed"]), (2, 1))
		self.assertEqual(result["completed"], 1)
		history = batches.batch_history(batch)
		self.assertEqual(sum(1 for h in history if h["task"] is None), 1)


class TestBatchFilters(BatchCase):
	def test_batch_filters_combine_with_existing_filters(self):
		batch, tasks_a, _ = self._planned_batch_with(a=2, c=1)
		feature = planning_service.create_feature(self.world["A"], "Batch feature")["name"]
		task_service.update(tasks_a[0], {"feature": feature, "priority": "High"})
		loose = _task(self.world["A"], "Unbatched one")

		def names(**f):
			return {
				t["name"] for t in task_service.list_tasks(self.world["A"], completed="all", **f)["items"]
			}

		self.assertEqual(names(batch=batch), set(tasks_a))
		self.assertEqual(names(batch=batch, feature=feature, priority="High"), {tasks_a[0]})
		self.assertIn(loose, names(batch="none"))
		self.assertFalse(names(batch="none") & set(tasks_a))
		self.assertEqual(names(batch="any") & set(tasks_a + [loose]), set(tasks_a))
		work = {
			t["name"]
			for t in task_service.my_work(batch=batch, completed="all", assigned_to_me=False)["items"]
		}
		self.assertTrue(work >= set(tasks_a))
