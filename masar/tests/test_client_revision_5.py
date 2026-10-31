"""Client revision 5: the creator owns a new Task, wider Task search, attachment indicator, Space
categories, the notification list with e-mail and push, and the service worker at /masar/sw.js."""

import base64
import email as email_parser
import json
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, nowdate

from masar.services import (
	action_service,
	attachment_service,
	comment_service,
	inbox_service,
	push_service,
	space_service,
	task_service,
)
from masar.tests.fixtures import as_user, build_world, email

PNG = base64.b64decode(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _task(space, title="Task"):
	return task_service.create(space, title, f"r5-{frappe.generate_hash(length=10)}")["task"]["name"]


def _inbox(key):
	as_user(key)
	return inbox_service.list_notifications()["items"]


def _html_of(message: str) -> str:
	"""The HTML part of an Email Queue message, decoded (it is stored as quoted-printable MIME)."""
	for part in email_parser.message_from_string(message).walk():
		if part.get_content_type() == "text/html":
			return part.get_payload(decode=True).decode()
	return ""


def _mention(key):
	return f'<span data-type="mention" data-id="{email(key)}" data-label="{key}">@{key}</span>'


class TestCreatorOwnsNewTask(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_creator_is_owner_nobody_is_assigned_and_owner_can_hand_over(self):
		as_user("a_member")
		task = task_service.get_detail(_task(self.world["A"], "Mine"))
		self.assertEqual(task["taskOwner"], email("a_member"))
		self.assertEqual(task["assignees"], [])  # assignment is always a person's choice
		task_service.add_assignee(task["name"], email("a_member"))
		task_service.add_assignee(task["name"], email("ab_member"))
		task = task_service.set_owner(task["name"], email("ab_member"))
		self.assertEqual(task["taskOwner"], email("ab_member"))
		task = task_service.remove_assignee(task["name"], email("a_member"))
		self.assertEqual(task["taskOwner"], email("ab_member"))


class TestSearchAndAttachments(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def tearDown(self):
		frappe.set_user("Administrator")

	def _found(self, term):
		return {t["name"] for t in task_service.my_work(q=term)["items"]}

	def test_search_covers_description_comments_and_actions(self):
		as_user("ab_member")
		key = frappe.generate_hash(length=8)
		by_title = _task(self.world["A"], f"Title {key}")
		by_description = _task(self.world["A"], "Plain one")
		task_service.update(by_description, {"description": f"Notes about {key}-desc"})
		by_comment = _task(self.world["A"], "Plain two")
		comment_service.create(by_comment, f"<p>Discussed {key}-comment</p>", f"c-{key}-1")
		by_action = _task(self.world["B"], "Plain three")
		action_service.add(by_action, f"Step {key}-action")
		deleted = _task(self.world["A"], "Plain four")
		gone = comment_service.create(deleted, f"<p>{key}-gone</p>", f"c-{key}-2")["comment"]
		comment_service.delete(gone["name"])

		self.assertEqual(self._found(key), {by_title, by_description, by_comment, by_action})
		self.assertEqual(self._found(f"{key}-comment"), {by_comment})
		self.assertEqual(self._found(f"{key}-gone"), set())
		# Content of Spaces the person does not belong to is never searched.
		as_user("a_member")
		self.assertEqual(self._found(f"{key}-action"), set())

	def test_rows_count_shown_attachments_only(self):
		as_user("a_member")
		task = _task(self.world["A"], "With file")
		plain = _task(self.world["A"], "Without file")
		attachment_service.store(frappe.get_doc("Masar Task", task), "shot.png", PNG, "Task")
		# A file still waiting in the comment composer does not count.
		attachment_service.store(frappe.get_doc("Masar Task", plain), "draft.png", PNG, "Comment")
		rows = {t["name"]: t for t in task_service.list_tasks(self.world["A"])["items"]}
		self.assertEqual(rows[task]["attachmentCount"], 1)
		self.assertEqual(rows[plain]["attachmentCount"], 0)


class TestSpaceCategories(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_new_category_joins_the_list_and_existing_ones_are_reused(self):
		name = f"Client work {frappe.generate_hash(length=5)}"
		as_user("a_manager")
		detail = space_service.update_details(self.world["A"], {"category": f"  {name} "})
		self.assertEqual(detail["category"], name)
		self.assertIn(name, space_service.categories())
		as_user("b_member")
		detail = space_service.update_details(self.world["B"], {"category": name.upper()})
		self.assertEqual(detail["category"], name)
		self.assertEqual(frappe.db.count("Masar Space Category", {"category_name": name}), 1)

	def test_patch_turns_typed_categories_into_entries(self):
		from masar.patches.v10 import space_categories

		name = f"Typed {frappe.generate_hash(length=5)}"
		frappe.db.set_value("Masar Space", self.world["A"], "category", name)
		space_categories.execute()
		space_categories.execute()
		self.assertEqual(frappe.db.count("Masar Space Category", {"category_name": name}), 1)


class TestNotifications(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		frappe.db.delete("Masar Notification")
		frappe.local.masar_inbox = None  # tests share one "request"; each test starts afresh
		for key in ("a_member", "ab_member", "a_manager", "b_member"):
			frappe.defaults.clear_user_default(inbox_service.EMAIL_PREFERENCE, email(key))

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_assignment_notifies_the_assignee_once_and_never_the_actor(self):
		as_user("a_member")
		task = _task(self.world["A"], "Shared work")
		self.assertEqual(_inbox("a_member"), [], "creating a Task notifies nobody")
		as_user("a_member")
		task_service.remove_assignee(task, email("a_member"))
		task_service.add_assignee(task, email("ab_member"))  # the creator stays the owner (I-TASK-2)
		items = _inbox("ab_member")
		self.assertEqual([i["kind"] for i in items], ["Assigned"])
		self.assertEqual(items[0]["actor"]["name"], email("a_member"))
		self.assertEqual(items[0]["link"], f"/tasks/{task}")
		self.assertFalse(items[0]["isRead"])
		self.assertEqual(_inbox("a_member"), [])

	def test_owner_change_and_overdue(self):
		as_user("a_member")
		task = _task(self.world["A"], "Late work")
		task_service.add_assignee(task, email("ab_member"))
		task_service.set_owner(task, email("ab_member"))
		frappe.set_user("Administrator")
		frappe.db.delete("Masar Notification")
		frappe.db.set_value("Masar Task", task, "due_date", add_days(nowdate(), -1))
		task_service.mark_overdue()
		for key in ("a_member", "ab_member"):
			self.assertEqual([i["kind"] for i in _inbox(key)], ["Overdue"], key)
		self.assertIsNone(_inbox("a_member")[0]["actor"])

	def test_space_membership_role_and_ownership(self):
		as_user("a_manager")
		space_service.add_member(self.world["A"], email("b_member"))
		space_service.change_role(self.world["A"], email("b_member"), "Manager")
		space_service.transfer_ownership(self.world["A"], email("b_member"))
		self.assertEqual(
			[i["kind"] for i in _inbox("b_member")], ["Space Owner", "Space Role", "Space Member"]
		)
		as_user("b_member")
		space_service.transfer_ownership(self.world["A"], email("a_manager"))
		self.assertEqual([i["kind"] for i in _inbox("a_manager")], ["Space Owner"])
		as_user("a_manager")
		space_service.remove_member(self.world["A"], email("b_member"))
		self.assertEqual(_inbox("b_member"), [], "entries about a Space leave with its membership")

	def test_comment_notifies_mentions_then_assignees(self):
		as_user("a_member")
		task = _task(self.world["A"], "Discussion")
		task_service.add_assignee(task, email("ab_member"))
		as_user("a_manager")
		comment_service.create(task, f"<p>Please check {_mention('ab_member')}</p>", "r5-comment-0001")
		self.assertEqual([i["kind"] for i in _inbox("ab_member")], ["Mention", "Assigned"])
		self.assertEqual([i["kind"] for i in _inbox("a_member")], ["Comment"])
		self.assertIn("Please check", _inbox("a_member")[0]["detail"])

	def test_read_state_is_personal(self):
		as_user("a_member")
		task = _task(self.world["A"], "Read me")
		task_service.add_assignee(task, email("ab_member"))
		mine = _inbox("ab_member")[0]["name"]
		as_user("a_member")
		self.assertEqual(inbox_service.mark_read([mine])["unread"], 0)
		as_user("ab_member")
		self.assertEqual(inbox_service.unread_count(), 1)
		inbox_service.mark_read([mine])
		self.assertEqual(inbox_service.unread_count(), 0)
		inbox_service.mark_read([mine], read=False)
		self.assertEqual(inbox_service.unread_count(), 1)
		inbox_service.mark_read(all_unread=True)
		self.assertEqual(inbox_service.unread_count(), 0)
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			frappe.get_list("Masar Notification", filters={"name": mine})
		with self.assertRaises(frappe.PermissionError):
			frappe.get_doc("Masar Notification", mine).check_permission("read")

	def test_email_uses_the_template_and_respects_the_mute(self):
		as_user("a_member")
		task = _task(self.world["A"], "Mail me")
		task_service.add_assignee(task, email("ab_member"))
		row = frappe.get_all(
			"Masar Notification", filters={"recipient": email("ab_member")}, fields=["name", "email_status"]
		)[0]
		self.assertEqual(row.email_status, "Queued")
		message = _html_of(
			frappe.get_all(
				"Email Queue",
				filters={"reference_doctype": "Masar Notification", "reference_name": row.name},
				pluck="message",
			)[0]
		)
		self.assertIn("You have a new task", message)
		self.assertIn(f"/masar/tasks/{task}", message)
		self.assertIn("Manage e-mail notifications", message)

		frappe.defaults.set_user_default(inbox_service.EMAIL_PREFERENCE, "0", email("a_manager"))
		as_user("ab_member")
		task_service.add_assignee(task, email("a_manager"))
		status = frappe.db.get_value(
			"Masar Notification", {"recipient": email("a_manager"), "kind": "Assigned"}, "email_status"
		)
		self.assertEqual(status, "Muted")

	def test_escaped_text_in_email(self):
		as_user("a_member")
		task = _task(self.world["A"], "<b>Bold</b> & co")
		task_service.add_assignee(task, email("ab_member"))
		name = frappe.db.get_value("Masar Notification", {"recipient": email("ab_member")}, "name")
		message = _html_of(frappe.db.get_value("Email Queue", {"reference_name": name}, "message"))
		self.assertNotIn("<b>Bold</b>", message)
		self.assertIn("&lt;b&gt;Bold&lt;/b&gt;", message)


class TestPush(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_only_browser_push_services_are_accepted(self):
		as_user("a_member")
		for endpoint in ("http://fcm.googleapis.com/x", "https://evil.example/x", "https://localhost/x"):
			with self.assertRaises(frappe.ValidationError):
				push_service.subscribe(endpoint)
		push_service.subscribe("https://web.push.apple.com/abc")
		as_user("ab_member")  # the same browser, after someone else signed in
		push_service.subscribe("https://web.push.apple.com/abc")
		self.assertEqual(
			frappe.get_all("Masar Push Subscription", filters={"endpoint": "https://web.push.apple.com/abc"}, pluck="user"),
			[email("ab_member")],
		)

	def test_vapid_signature_verifies_with_the_public_key(self):
		header = push_service._vapid_header("https://fcm.googleapis.com/fcm/send/abc")
		token = header.split("t=")[1].split(",")[0]
		key = header.split("k=")[1]
		signing_input, signature = token.rsplit(".", 1)
		raw = base64.urlsafe_b64decode(signature + "==")
		public = ec.EllipticCurvePublicKey.from_encoded_point(
			ec.SECP256R1(), base64.urlsafe_b64decode(key + "==")
		)
		public.verify(
			encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
			signing_input.encode(),
			ec.ECDSA(hashes.SHA256()),
		)
		claims = json.loads(base64.urlsafe_b64decode(signing_input.split(".")[1] + "=="))
		self.assertEqual(claims["aud"], "https://fcm.googleapis.com")

	def test_gone_endpoints_are_removed(self):
		as_user("a_member")
		push_service.subscribe("https://fcm.googleapis.com/fcm/send/gone")
		frappe.set_user("Administrator")
		with patch("masar.services.push_service.requests.post", return_value=SimpleNamespace(status_code=410, ok=False)) as post:
			push_service.push_to_users([email("a_member")])
		self.assertEqual(post.call_args.kwargs["headers"]["Content-Length"], "0")
		self.assertFalse(frappe.db.exists("Masar Push Subscription", {"user": email("a_member")}))


class TestServiceWorker(IntegrationTestCase):
	def test_worker_is_served_at_masar_sw_js(self):
		from masar.pwa import ServiceWorkerPage

		frappe.local.request = SimpleNamespace(path="/masar/sw.js")
		try:
			page = ServiceWorkerPage("masar")
			self.assertTrue(page.can_render())
			response = page.render()
			self.assertEqual(response.mimetype, "text/javascript")
			self.assertIn(b"push", response.get_data())
			frappe.local.request = SimpleNamespace(path="/masar/tasks")
			self.assertFalse(ServiceWorkerPage("masar").can_render())
		finally:
			del frappe.local.request
