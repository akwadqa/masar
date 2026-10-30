"""Stabilization round 3: without an outgoing e-mail account a notification records "Not sent" without
calling frappe.sendmail or writing an Error Log entry; with an account it is queued as before, and a
genuine failure of a configured account is still logged (QA-D07). Removing a test identity also removes
its personal settings, and only those (QA-M01)."""

from unittest.mock import patch

import frappe
from frappe.email.doctype.email_account.email_account import EmailAccount
from frappe.tests import IntegrationTestCase

from masar.services import inbox_service, task_service
from masar.services.personal import preference_service
from masar.tests.fixtures import as_user, build_world, email
from masar.utils import seed

LOG_TITLE = "Masar notification e-mail"


def _task(space, title):
	return task_service.create(space, title, f"r3-{frappe.generate_hash(length=10)}")["task"]["name"]


def _error_logs() -> int:
	return frappe.db.count("Error Log", {"method": LOG_TITLE})


class TestNotificationEmailWithoutOutgoingAccount(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		frappe.db.delete("Masar Notification")
		frappe.local.masar_inbox = None
		for key in ("a_member", "ab_member", "a_manager"):
			frappe.defaults.clear_user_default(inbox_service.EMAIL_PREFERENCE, email(key))

	def tearDown(self):
		frappe.set_user("Administrator")

	def _assign(self, title: str) -> str:
		as_user("a_member")
		task = _task(self.world["A"], title)
		task_service.add_assignee(task, email("ab_member"))
		return task

	def _row(self, task: str):
		return frappe.db.get_value(
			"Masar Notification",
			{"recipient": email("ab_member"), "task": task, "kind": "Assigned"},
			["name", "email_status"],
			as_dict=True,
		)

	def test_no_outgoing_account_records_not_sent_without_sendmail_or_error_log(self):
		logs = _error_logs()
		with (
			patch.object(EmailAccount, "find_outgoing", return_value=None),
			patch("frappe.sendmail") as sendmail,
		):
			task = self._assign("No mail server")
		sendmail.assert_not_called()
		self.assertEqual(_error_logs(), logs, "a missing outgoing account is not an error")
		row = self._row(task)
		self.assertEqual(row.email_status, "Not sent", "nothing is claimed as sent")
		# The in-app notification and the push for it are unaffected.
		as_user("ab_member")
		self.assertIn(task, [item["task"] for item in inbox_service.list_notifications()["items"]])
		self.assertIn(email("ab_member"), frappe.local.masar_inbox["push"])

	def test_configured_account_queues_the_email_as_before(self):
		with (
			patch.object(EmailAccount, "find_outgoing", return_value=EmailAccount.create_dummy()),
			patch("frappe.sendmail") as sendmail,
		):
			task = self._assign("Mail server present")
		sendmail.assert_called_once()
		self.assertEqual(
			sendmail.call_args.kwargs["recipients"],
			[frappe.db.get_value("User", email("ab_member"), "email")],
		)
		self.assertEqual(self._row(task).email_status, "Queued")

	def test_a_failing_configured_account_is_still_logged(self):
		logs = _error_logs()
		with (
			patch.object(EmailAccount, "find_outgoing", return_value=EmailAccount.create_dummy()),
			patch(
				"frappe.sendmail",
				side_effect=frappe.OutgoingEmailError("Could not connect to outgoing email server"),
			),
		):
			task = self._assign("Mail server down")
		self.assertEqual(_error_logs(), logs + 1)
		self.assertEqual(self._row(task).email_status, "Not sent")

	def test_muted_recipients_are_not_looked_up_or_mailed(self):
		frappe.defaults.set_user_default(inbox_service.EMAIL_PREFERENCE, "0", email("ab_member"))
		with (
			patch.object(EmailAccount, "find_outgoing", return_value=None) as lookup,
			patch("frappe.sendmail") as sendmail,
		):
			task = self._assign("Muted person")
		lookup.assert_not_called()
		sendmail.assert_not_called()
		self.assertEqual(self._row(task).email_status, "Muted")

	def test_the_check_uses_frappes_own_lookup(self):
		with patch.object(EmailAccount, "find_outgoing", return_value=None) as lookup:
			self.assertFalse(inbox_service.outgoing_email_configured())
		lookup.assert_called_once_with(match_by_doctype="Masar Notification")
		with patch.object(EmailAccount, "find_outgoing", return_value=EmailAccount.create_dummy()):
			self.assertTrue(inbox_service.outgoing_email_configured())


class TestFixtureCleanupRemovesPreferences(IntegrationTestCase):
	"""Runs inside the test transaction with its own temporary identity; the site's real QA identities
	and remove_e2e_fixtures' commit are not touched."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		frappe.set_user("Administrator")
		self.identity = f"r3-cleanup-{frappe.generate_hash(length=6)}@{seed.DOMAIN}"
		frappe.get_doc(
			{"doctype": "User", "email": self.identity, "first_name": "Cleanup", "send_welcome_email": 0}
		).insert(ignore_permissions=True)
		for user in (self.identity, email("a_member")):
			for column, value in (
				("masar_theme", "teal"),
				("masar_email_notifications", "0"),
				("time_zone", "Asia/Qatar"),
			):
				frappe.defaults.set_user_default(column, value, user)

	def _defaults(self, user: str) -> int:
		return frappe.db.count("DefaultValue", {"parent": user})

	def test_removing_a_test_identity_removes_its_preferences_and_nobody_elses(self):
		other_before = self._defaults(email("a_member"))
		global_before = frappe.db.count("DefaultValue", {"parent": ["in", ["__default", "__global"]]})
		self.assertEqual(self._defaults(self.identity), 3)
		seed._remove_identity(self.identity)
		self.assertFalse(frappe.db.exists("User", self.identity))
		self.assertEqual(self._defaults(self.identity), 0)
		self.assertEqual(self._defaults(email("a_member")), other_before, "another user's settings stay")
		self.assertEqual(
			frappe.db.count("DefaultValue", {"parent": ["in", ["__default", "__global"]]}), global_before
		)
		as_user("a_member")
		self.assertEqual(preference_service.get_preferences()["theme"], "teal")

	def test_only_test_identities_can_be_removed(self):
		with self.assertRaises(frappe.ValidationError):
			seed._remove_identity(email("a_member"))
		self.assertTrue(frappe.db.exists("User", email("a_member")))

	def test_leftover_check_counts_what_a_test_identity_still_holds(self):
		before = seed.e2e_leftovers()
		self.assertEqual(
			set(before),
			{
				"fixtures_enabled",
				"users",
				"spaces",
				"sprints",
				"tasks",
				"files",
				"notifications",
				"push_subscriptions",
				"preferences",
			},
		)
		seed._remove_identity(self.identity)
		after = seed.e2e_leftovers()
		self.assertEqual(after["users"], before["users"] - 1)
		self.assertEqual(after["preferences"], before["preferences"] - 3)
