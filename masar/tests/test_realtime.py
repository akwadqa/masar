"""Live updates (specs/realtime.md): who receives which event, Space boundaries, and rollback."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from masar.services import realtime_service, task_service
from masar.tests.fixtures import as_user, build_world, email, unassigned_task


def _published(run) -> list[tuple[str, dict, str]]:
	"""Run `run`, then publish what it queued (as a commit would) and return (event, message, user)."""
	with patch("frappe.publish_realtime") as publish:
		run()
		realtime_service._flush()
	return [(c.args[0], c.args[1], c.kwargs["user"]) for c in publish.call_args_list]


def _receivers(published, event) -> set[str]:
	return {user for name, _message, user in published if name == event}


class TestRealtime(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		frappe.local.masar_realtime = None
		as_user("a_manager")

	def tearDown(self):
		frappe.local.masar_realtime = None
		frappe.set_user("Administrator")

	def test_space_change_reaches_its_members_only(self):
		published = _published(
			lambda: unassigned_task(self.world["A"], "Live", f"rt-{frappe.generate_hash(length=8)}")
		)
		receivers = _receivers(published, realtime_service.SPACE_CHANGED)
		self.assertEqual(receivers, {email("a_manager"), email("a_member"), email("ab_member")})
		self.assertNotIn(email("b_member"), receivers)
		self.assertNotIn(email("outsider"), receivers)
		# Ids only: the payload names the Space and nothing else.
		messages = [m for name, m, _u in published if name == realtime_service.SPACE_CHANGED]
		self.assertTrue(all(m == {"space": self.world["A"]} for m in messages))

	def test_one_event_per_member_for_many_changes(self):
		def many():
			for i in range(3):
				unassigned_task(self.world["A"], f"Bulk {i}", f"rt-bulk-{i}-{frappe.generate_hash(length=8)}")

		published = _published(many)
		space_events = [u for name, _m, u in published if name == realtime_service.SPACE_CHANGED]
		self.assertEqual(sorted(space_events), sorted(set(space_events)))

	def test_deleted_task_is_announced(self):
		task = unassigned_task(self.world["A"], "Short-lived", f"rt-del-{frappe.generate_hash(length=8)}")
		frappe.local.masar_realtime = None
		published = _published(lambda: task_service.delete(task))
		self.assertIn(email("a_member"), _receivers(published, realtime_service.SPACE_CHANGED))

	def test_notification_event_goes_to_the_recipient_not_the_actor(self):
		task = unassigned_task(self.world["A"], "Hand over", f"rt-asg-{frappe.generate_hash(length=8)}")
		frappe.local.masar_realtime = None
		frappe.local.masar_inbox = None
		published = _published(lambda: task_service.add_assignee(task, email("a_member")))
		receivers = _receivers(published, realtime_service.NOTIFICATION)
		self.assertIn(email("a_member"), receivers)
		self.assertNotIn(email("a_manager"), receivers)
		self.assertTrue(all(m == {} for name, m, _u in published if name == realtime_service.NOTIFICATION))

	def test_rollback_announces_nothing(self):
		with patch("frappe.publish_realtime") as publish:
			realtime_service.space_changed(self.world["A"])
			frappe.db.after_rollback.run()
			realtime_service._flush()
		publish.assert_not_called()
		self.assertIsNone(frappe.local.masar_realtime)

	def test_nothing_is_published_before_commit(self):
		with patch("frappe.publish_realtime") as publish:
			realtime_service.space_changed(self.world["A"])
			realtime_service.users_notified([email("a_member")])
		publish.assert_not_called()
