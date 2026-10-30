"""Demo dataset tooling: safety guards, scoped deletion, the simulation clock and a deterministic plan."""

import random

import frappe
import frappe.utils.data
from frappe.tests import IntegrationTestCase

from masar.demo import engine
from masar.services import task_service
from masar.tests.fixtures import as_user, build_world, make_space


class TestDemoGuards(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_destructive_commands_need_the_site_name(self):
		with self.assertRaises(frappe.ValidationError):
			engine.reset(confirm="another-site", dry_run=1)
		with self.assertRaises(frappe.ValidationError):
			engine.seed(confirm=None, credentials_file="/nonexistent", dry_run=1)

	def test_reset_is_a_dry_run_by_default_and_protects_system_users(self):
		before = frappe.db.count("Masar Space")
		plan = engine.reset(confirm=frappe.local.site)
		self.assertTrue(plan["dry_run"])
		self.assertEqual(frappe.db.count("Masar Space"), before)
		with self.assertRaises(frappe.ValidationError):
			engine.reset(confirm=frappe.local.site, dry_run=1, users=["Administrator"])

	def test_seed_refuses_a_site_that_already_has_spaces(self):
		self.assertGreater(frappe.db.count("Masar Space"), 0)
		with self.assertRaises(frappe.ValidationError):
			engine.seed(confirm=frappe.local.site, credentials_file="/nonexistent", dry_run=1)

	def test_delete_scope_removes_only_the_given_space(self):
		keep = make_space("Demo scope keep", ["a_manager"], ["a_member"])
		drop = make_space("Demo scope drop", ["a_manager"], ["a_member"])
		as_user("a_manager")
		kept = task_service.create(keep, "Kept task", "demo-scope-keep-0001")["task"]["name"]
		task_service.create(drop, "Dropped task", "demo-scope-drop-0001")
		frappe.set_user("Administrator")
		result = engine.delete_scope([drop], [])
		self.assertEqual(result["tasks"], 1)
		self.assertFalse(frappe.db.exists("Masar Space", drop))
		self.assertFalse(frappe.db.exists("Masar Task", {"space": drop}))
		self.assertTrue(frappe.db.exists("Masar Task", kept))
		self.assertTrue(frappe.db.exists("Masar Space", self.world["A"]))


class TestSimulationClock(IntegrationTestCase):
	def test_clock_is_restored_after_an_error(self):
		original_now, original_enqueue = frappe.utils.data.now_datetime, frappe.enqueue
		clock = engine._Clock()
		clock.moment = frappe.utils.data.now_datetime().replace(year=2026, month=9, day=1, hour=9)
		with self.assertRaises(RuntimeError), engine._simulation(clock):
			self.assertEqual(frappe.utils.data.now_datetime().day, 1)
			self.assertIsNone(frappe.enqueue(engine.NOTIFY_JOB, comment="x"))
			raise RuntimeError("stop")
		self.assertIs(frappe.utils.data.now_datetime, original_now)
		self.assertIs(frappe.enqueue, original_enqueue)

	def test_plan_is_deterministic(self):
		today = frappe.utils.getdate("2026-10-28")
		labels = []
		for _ in range(2):
			planner = engine._Planner(today, random.Random(engine.D.RANDOM_SEED))
			engine._plan(planner)
			labels.append(sorted((day, phase, label) for day, phase, label, _ in planner.events))
		self.assertEqual(labels[0], labels[1])
		self.assertGreater(len(labels[0]), 500)
