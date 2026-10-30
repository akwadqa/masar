"""Client revision 4: Masar beside the other apps of a Frappe / ERPNext site, and the All Tasks label
filter across Spaces."""

import frappe
from frappe.tests import IntegrationTestCase

from masar.api.session import check_app_permission
from masar.services import label_service, task_service
from masar.tests.fixtures import as_user, build_world, email


def _task(space, title):
	return task_service.create(space, title, f"r4-{frappe.generate_hash(length=10)}")["task"]["name"]


class TestAppsScreen(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_masar_is_listed_on_the_apps_screen_for_its_users_only(self):
		entries = frappe.get_hooks("add_to_apps_screen", app_name="masar")
		self.assertEqual([(e["name"], e["route"]) for e in entries], [("masar", "/masar")])
		as_user("a_member")
		self.assertTrue(check_app_permission())
		frappe.set_user(email("no_role"))
		self.assertFalse(check_app_permission())
		frappe.set_user("Guest")
		self.assertFalse(check_app_permission())

	def test_nothing_changes_the_site_login_or_logo(self):
		"""Masar must not change the login page, the site logo or the home page of other apps."""
		hooks = frappe.get_hooks(app_name="masar")
		for hook in (
			"app_logo_url",
			"website_context",
			"home_page",
			"role_home_page",
			"get_website_user_home_page",
			"on_login",
			"on_session_creation",
			"boot_session",
			"update_website_context",
			"website_redirects",
		):
			self.assertFalse(hooks.get(hook), hook)
		self.assertEqual(
			hooks.get("website_route_rules"), [{"from_route": "/masar/<path:app_path>", "to_route": "masar"}]
		)


class TestLabelFilterNeedsOneSpace(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_label_filter_in_all_tasks_needs_one_space(self):
		as_user("a_manager")
		label = label_service.create(self.world["A"], f"One {frappe.generate_hash(length=5)}")["label"]
		task = _task(self.world["A"], "Labelled once")
		task_service.add_label(task, label["name"])
		as_user("ab_member")
		found = task_service.my_work(spaces_filter=[self.world["A"]], label=[label["name"]])["items"]
		self.assertEqual([t["name"] for t in found], [task])
		with self.assertRaises(frappe.ValidationError):
			task_service.my_work(label=[label["name"]])
		with self.assertRaises(frappe.ValidationError):
			task_service.my_work(spaces_filter=[self.world["A"], self.world["B"]], label=[label["name"]])
		with self.assertRaises(frappe.ValidationError):
			task_service.my_work(spaces_filter=[self.world["B"]], label=[label["name"]])


class TestListParameters(IntegrationTestCase):
	def test_json_array_and_comma_separated_values(self):
		from masar.api.tasks import _list

		self.assertEqual(_list('["a", "b", 3]'), ["a", "b"])
		self.assertEqual(_list("a,b"), ["a", "b"])
		self.assertIsNone(_list(""))


class TestDeskEntry(IntegrationTestCase):
	def test_desktop_icon_grid_gets_one_masar_entry(self):
		from masar.install import ensure_desktop_icon

		previous = frappe.db.get_single_value("Desktop Settings", "desktop_page")
		existing = frappe.get_all("Desktop Icon", filters={"app": "masar", "icon_type": "App"}, pluck="name")
		try:
			frappe.db.delete("Desktop Icon", {"name": ["in", existing or [""]]})
			frappe.db.set_single_value("Desktop Settings", "desktop_page", "Apps")
			ensure_desktop_icon()
			self.assertFalse(frappe.db.exists("Desktop Icon", {"app": "masar"}))  # Apps screen reads the hook
			frappe.db.set_single_value("Desktop Settings", "desktop_page", "Desktop Icons")
			ensure_desktop_icon()
			ensure_desktop_icon()  # idempotent
			icons = frappe.get_all("Desktop Icon", filters={"app": "masar"}, fields=["label", "icon_type", "link"])
			self.assertEqual(icons, [{"label": "Masar", "icon_type": "App", "link": "/masar"}])
		finally:
			frappe.db.delete("Desktop Icon", {"app": "masar"})
			frappe.db.set_single_value("Desktop Settings", "desktop_page", previous or "Apps")
