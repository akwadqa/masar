"""Stabilization round 2 (QA-D05): preferences are read from the stored rows, so a stale entry in
Frappe's defaults cache, left there by a request that ran while a save was still open, cannot bring
an old value back."""

import frappe
from frappe.tests import IntegrationTestCase

from masar.services import inbox_service
from masar.services.personal import preference_service
from masar.tests.fixtures import as_user, build_world, email

KEYS = preference_service.KEYS


def _poison_cache(user: str, values: dict):
	"""What a concurrent request leaves behind: Frappe's cached defaults of `user` with old values."""
	frappe.client_cache.set_value(f"defaults::{user}", frappe._dict({KEYS[k]: v for k, v in values.items()}))


class TestPreferencePersistence(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		frappe.set_user("Administrator")
		for key in ("a_member", "a_manager"):
			for column in KEYS.values():
				frappe.defaults.clear_user_default(column, email(key))
		as_user("a_member")

	def test_a_stale_defaults_cache_does_not_bring_old_values_back(self):
		user = email("a_member")
		saved = preference_service.set_preferences(
			theme="teal",
			appearance="dark",
			full_width=False,
			email_notifications=False,
			pinned_spaces=[self.world["A"]],
		)
		_poison_cache(
			user,
			{
				"theme": "ink",
				"appearance": "light",
				"fullWidth": "1",
				"emailNotifications": "1",
				"pinnedSpaces": "[]",
			},
		)
		# The cause, as Frappe sees it: its cached read now answers with the old value ...
		self.assertEqual(frappe.defaults.get_user_default(KEYS["theme"], user), "ink")
		# ... while the Workspace reads the stored rows.
		expected = {
			"theme": "teal",
			"appearance": "dark",
			"fullWidth": False,
			"emailNotifications": False,
			"pinnedSpaces": [self.world["A"]],
		}
		self.assertEqual(saved, expected)
		self.assertEqual(preference_service.get_preferences(), expected)
		self.assertFalse(inbox_service.emails_enabled(user))

	def test_saving_the_same_value_again_is_read_back_despite_a_stale_cache(self):
		# Frappe skips the write (and its cache clearing) when the row already holds the value.
		user = email("a_member")
		preference_service.set_preferences(email_notifications=False)
		_poison_cache(user, {"emailNotifications": "1"})
		self.assertFalse(preference_service.set_preferences(email_notifications=False)["emailNotifications"])
		self.assertFalse(inbox_service.emails_enabled(user))

	def test_partial_updates_keep_the_other_preferences(self):
		preference_service.set_preferences(
			theme="teal", appearance="dark", full_width=False, email_notifications=False
		)
		self.assertEqual(preference_service.set_preferences(appearance="system")["theme"], "teal")
		prefs = preference_service.get_preferences()
		self.assertEqual(
			(prefs["theme"], prefs["appearance"], prefs["fullWidth"], prefs["emailNotifications"]),
			("teal", "system", False, False),
		)

	def test_preferences_stay_with_their_user(self):
		preference_service.set_preferences(theme="ink", email_notifications=False)
		as_user("a_manager")
		self.assertEqual(preference_service.get_preferences()["theme"], "violet")
		self.assertTrue(preference_service.get_preferences()["emailNotifications"])
		self.assertTrue(inbox_service.emails_enabled(email("a_manager")))
		self.assertFalse(inbox_service.emails_enabled(email("a_member")))

	def test_defaults_without_stored_rows(self):
		self.assertEqual(
			preference_service.get_preferences(),
			{
				"theme": "violet",
				"appearance": "light",
				"fullWidth": True,
				"pinnedSpaces": [],
				"emailNotifications": True,
			},
		)
		self.assertTrue(inbox_service.emails_enabled(email("a_member")))

	def test_the_newest_row_wins_if_a_key_was_stored_twice(self):
		user = email("a_member")
		for value in ("ink", "teal"):
			frappe.get_doc(
				{
					"doctype": "DefaultValue",
					"parent": user,
					"parenttype": "__default",
					"parentfield": "system_defaults",
					"defkey": KEYS["theme"],
					"defvalue": value,
				}
			).insert(ignore_permissions=True)
		self.assertEqual(preference_service.get_preferences()["theme"], "teal")

	def test_frappes_cache_is_cleared_again_after_the_commit(self):
		user = email("a_member")
		preference_service.set_preferences(theme="teal")
		_poison_cache(user, {"theme": "ink"})
		frappe.db.after_commit.run()
		self.assertEqual(frappe.defaults.get_user_default(KEYS["theme"], user), "teal")
		self.assertEqual(preference_service.get_preferences()["theme"], "teal")
