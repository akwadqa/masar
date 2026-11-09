"""Live updates (specs/realtime.md): who receives which event, Space boundaries, and rollback."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from masar.services import comment_service, realtime_service, space_service, task_service
from masar.tests.fixtures import as_user, build_world, email, unassigned_task


def _published(run) -> list[tuple[str, dict, str]]:
	"""Run `run`, then publish what it queued (as a commit would) and return (event, message, room)."""
	with patch("frappe.publish_realtime") as publish:
		run()
		realtime_service._flush()
	return [(c.args[0], c.args[1], c.kwargs["room"]) for c in publish.call_args_list]


def _receivers(published, event) -> set[str]:
	return {room.removeprefix("user:") for name, _message, room in published if name == event}


def _rooms(published, event) -> set[str]:
	return {room for name, _message, room in published if name == event}


def _task(world, key):
	return unassigned_task(world["A"], f"Live {key}", f"rt-{key}-{frappe.generate_hash(length=8)}")


class TestRealtime(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		frappe.local.masar_realtime = None
		frappe.local.masar_inbox = None
		as_user("a_manager")

	def tearDown(self):
		frappe.local.masar_realtime = None
		frappe.set_user("Administrator")

	def _fresh(self):
		frappe.local.masar_realtime = None
		frappe.local.masar_inbox = None

	def test_space_change_reaches_its_members_only(self):
		published = _published(lambda: _task(self.world, "space"))
		receivers = _receivers(published, realtime_service.SPACE_CHANGED)
		self.assertEqual(receivers, {email("a_manager"), email("a_member"), email("ab_member")})
		self.assertNotIn(email("b_member"), receivers)
		self.assertNotIn(email("outsider"), receivers)
		# Ids only: the payload names the Space and nothing else.
		messages = [m for name, m, _r in published if name == realtime_service.SPACE_CHANGED]
		self.assertTrue(all(m == {"space": self.world["A"]} for m in messages))

	def test_one_event_per_member_for_many_changes(self):
		published = _published(lambda: [_task(self.world, f"bulk{i}") for i in range(3)])
		rooms = [r for name, _m, r in published if name == realtime_service.SPACE_CHANGED]
		self.assertEqual(sorted(rooms), sorted(set(rooms)))

	def test_deleted_task_is_announced(self):
		task = _task(self.world, "del")
		self._fresh()
		published = _published(lambda: task_service.delete(task))
		self.assertIn(email("a_member"), _receivers(published, realtime_service.SPACE_CHANGED))

	def test_notification_event_goes_to_the_recipient_not_the_actor(self):
		task = _task(self.world, "asg")
		self._fresh()
		published = _published(lambda: task_service.add_assignee(task, email("a_member")))
		receivers = _receivers(published, realtime_service.NOTIFICATION)
		self.assertIn(email("a_member"), receivers)
		self.assertNotIn(email("a_manager"), receivers)
		self.assertTrue(all(m == {} for name, m, _r in published if name == realtime_service.NOTIFICATION))

	def test_comment_and_reaction_refresh_the_task_room_only(self):
		task = _task(self.world, "talk")
		self._fresh()
		published = _published(
			lambda: comment_service.create(task, "<p>Hello</p>", f"rt-c-{frappe.generate_hash(length=8)}")
		)
		self.assertEqual(_rooms(published, realtime_service.TIMELINE), {f"doc:Masar Task/{task}"})
		comment = frappe.get_all("Masar Comment", filters={"task": task}, pluck="name")[0]
		self._fresh()
		published = _published(lambda: comment_service.react(comment, "heart", True))
		self.assertEqual(_rooms(published, realtime_service.TIMELINE), {f"doc:Masar Task/{task}"})

	def test_typing_and_editing_go_to_the_task_room_at_once(self):
		task = _task(self.world, "type")
		with patch("frappe.publish_realtime") as publish:
			comment_service.typing(task)
			task_service.editing(task, "title", True)
		events = {c.args[0]: (c.args[1], c.kwargs["room"]) for c in publish.call_args_list}
		self.assertEqual(
			events[realtime_service.TYPING],
			({"task": task, "user": email("a_manager")}, f"doc:Masar Task/{task}"),
		)
		self.assertEqual(events[realtime_service.EDITING][0]["field"], "title")
		self.assertTrue(events[realtime_service.EDITING][0]["active"])

	def test_typing_and_editing_need_membership_and_a_known_field(self):
		task = _task(self.world, "deny")
		as_user("outsider")
		with patch("frappe.publish_realtime") as publish:
			self.assertRaises(frappe.DoesNotExistError, comment_service.typing, task)
			self.assertRaises(frappe.DoesNotExistError, task_service.editing, task, "title", True)
		publish.assert_not_called()
		as_user("a_member")
		self.assertRaises(frappe.ValidationError, task_service.editing, task, "status", True)

	def test_people_names_only_those_sharing_a_space(self):
		as_user("a_member")
		names = {
			p["name"]
			for p in space_service.people([email("a_manager"), email("b_member"), email("outsider")])
		}
		self.assertEqual(names, {email("a_manager")})
		as_user("ab_member")
		names = {p["name"] for p in space_service.people([email("a_manager"), email("b_member")])}
		self.assertEqual(names, {email("a_manager"), email("b_member")})

	def test_rollback_announces_nothing(self):
		with patch("frappe.publish_realtime") as publish:
			realtime_service.space_changed(self.world["A"])
			realtime_service.task_changed("anything")
			frappe.db.after_rollback.run()
			realtime_service._flush()
		publish.assert_not_called()
		self.assertIsNone(frappe.local.masar_realtime)

	def test_nothing_is_published_before_commit(self):
		with patch("frappe.publish_realtime") as publish:
			realtime_service.space_changed(self.world["A"])
			realtime_service.users_notified([email("a_member")])
		publish.assert_not_called()
