"""Phase 6: comments, mentions, reactions, private attachments, timeline and notifications.
Security matrix A–R (backend parts) with real authorization; uploads use a real multipart file object."""

import json
import quopri
from io import BytesIO
from types import SimpleNamespace

import frappe
import frappe.client
from frappe.tests import IntegrationTestCase
from werkzeug.datastructures import FileStorage

from masar.exceptions import MasarConflictError, MasarRequestReuseError
from masar.permissions import clear_membership_cache
from masar.services import attachment_service as attachments
from masar.services import comment_service as comments
from masar.services import notification_service, space_service, task_service, timeline_service
from masar.services.rich_text import sanitize_comment
from masar.tests.fixtures import as_user, build_world, email, make_space

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x00" * 64


def _key():
	return f"c-{frappe.generate_hash(length=16)}"


def _task(space, title="Discussed"):
	return task_service.create(space, title, _key())["task"]["name"]


def _upload(task, name="shot.png", content=None, purpose="Task"):
	# Unique bytes: Frappe stores identical content once and shares the URL between File rows.
	content = content if content is not None else PNG + frappe.generate_hash(length=16).encode()
	frappe.local.request = SimpleNamespace(
		files={"file": FileStorage(stream=BytesIO(content), filename=name)}, content_length=len(content)
	)
	try:
		return attachments.upload(task, purpose)
	finally:
		del frappe.local.request


def _comment(task, text="Hello", key=None, files=None):
	return comments.create(task, f"<p>{text}</p>", key or _key(), files)["comment"]


class CollaborationCase(IntegrationTestCase):
	"""A fresh Space per test (a_manager M; a_member, ab_member) so membership changes elsewhere in the
	suite never leak in · Space B: b_member (M), ab_member."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.world = build_world()

	def setUp(self):
		frappe.set_user("Administrator")
		self.A = make_space(
			f"Collab {frappe.generate_hash(length=8)}", ["a_manager"], ["a_member", "ab_member"]
		)
		clear_membership_cache()
		as_user("a_manager")
		self.task = _task(self.A)

	def tearDown(self):
		frappe.local.response.pop("conflicts", None)
		frappe.set_user("Administrator")


class TestComments(CollaborationCase):
	def test_create_list_and_idempotency_N(self):
		key = _key()
		first = comments.create(self.task, "<p>First</p>", key)
		again = comments.create(self.task, "<p>First</p>", key)  # lost response, repeated
		self.assertEqual((first["created"], again["created"]), (True, False))
		self.assertEqual(first["comment"]["name"], again["comment"]["name"])
		self.assertEqual(frappe.db.count("Masar Comment", {"client_request_id": key}), 1)
		other = _task(self.A, "Other")
		with self.assertRaises(MasarRequestReuseError):
			comments.create(other, "<p>First</p>", key)
		self.assertEqual(first["comment"]["author"]["name"], email("a_manager"))
		self.assertEqual(frappe.db.get_value("Masar Task", self.task, "comment_count"), 1)
		with self.assertRaises(frappe.ValidationError):
			comments.create(self.task, "<p> </p><p><br></p>", _key())

	def test_A_B_outsiders_cannot_read_or_write(self):
		comment = _comment(self.task)["name"]
		as_user("b_member")
		for call in (
			lambda: timeline_service.timeline(self.task),
			lambda: comments.get_comment(comment),
			lambda: comments.create(self.task, "<p>x</p>", _key()),
			lambda: comments.update(comment, "<p>x</p>"),
			lambda: comments.delete(comment),
			lambda: comments.react(comment, "thumbs_up", True),
			lambda: comments.mention_candidates(self.task),
		):
			with self.assertRaises(frappe.DoesNotExistError):
				call()
		self.assertNotIn(comment, frappe.get_list("Masar Comment", pluck="name", limit_page_length=0))

	def test_C_D_ownership_and_moderation(self):
		as_user("a_member")
		mine = _comment(self.task, "Member words")
		edited = comments.update(mine["name"], "<p>Member words, edited</p>", base_modified=mine["modified"])
		self.assertIsNotNone(edited["editedAt"])
		with self.assertRaises(MasarConflictError):  # stale editor
			comments.update(mine["name"], "<p>Overwrite</p>", base_modified=mine["modified"])
		as_user("ab_member")
		with self.assertRaises(frappe.PermissionError):
			comments.update(mine["name"], "<p>Not mine</p>")
		with self.assertRaises(frappe.PermissionError):
			comments.delete(mine["name"])
		as_user("a_manager")
		with self.assertRaises(frappe.PermissionError):  # moderators delete, never edit
			comments.update(mine["name"], "<p>Rewritten by manager</p>")
		deleted = comments.delete(mine["name"])
		self.assertTrue(deleted["isDeleted"])
		self.assertIsNone(deleted["content"])
		self.assertEqual(deleted["author"]["name"], email("a_member"))
		self.assertEqual(deleted["deletedBy"]["name"], email("a_manager"))
		self.assertIsNone(frappe.db.get_value("Masar Comment", mine["name"], "content"))
		evidence = frappe.get_all(
			"Masar Activity", filters={"reference_name": self.task, "event": "comment_deleted"}, pluck="data"
		)
		self.assertTrue(json.loads(evidence[0])["moderated"])

	def test_E_lifecycle(self):
		as_user("admin")
		space = space_service.create({"title": f"Lifecycle {_key()}", "owner": email("a_manager")})["name"]
		as_user("a_manager")
		space_service.add_member(space, email("a_member"), "Member")
		task = _task(space)
		posted = _comment(task)
		space_service.set_status(space, "Completed")
		as_user("a_member")
		with self.assertRaises(frappe.PermissionError):
			comments.create(task, "<p>late</p>", _key())
		as_user("a_manager")
		_comment(task, "Manager wrap-up")
		space_service.set_status(space, "Closed")
		for call in (
			lambda: comments.create(task, "<p>closed</p>", _key()),
			lambda: comments.react(posted["name"], "heart", True),
			lambda: comments.delete(posted["name"]),
		):
			with self.assertRaises(frappe.PermissionError):
				call()

	def test_F_mentions_are_members_only(self):
		candidates = {c["name"] for c in comments.mention_candidates(self.task)}
		self.assertEqual(candidates, {email(u) for u in ("a_manager", "a_member", "ab_member")})
		html = (
			f'<p>Hi <span data-type="mention" data-id="{email("a_member")}" data-label="A Member">@A Member</span> '
			f'and <span data-type="mention" data-id="{email("b_member")}">@B</span></p>'
		)
		posted = comments.create(self.task, html, _key())["comment"]
		self.assertIn(f'data-id="{email("a_member")}"', posted["content"])
		self.assertNotIn(email("b_member"), posted["content"])  # forged / non-member: plain text
		self.assertEqual(
			json.loads(frappe.db.get_value("Masar Comment", posted["name"], "mentions")), [email("a_member")]
		)

	def test_L_xss_payloads_are_neutralised(self):
		members, images = {email("a_member")}, set()
		payloads = [
			"<p>x<script>alert(1)</script></p>",
			'<p onclick="alert(1)">x</p>',
			'<p><a href="javascript:alert(1)">x</a></p>',
			'<p><a href="data:text/html;base64,PHNjcmlwdD4=">x</a></p>',
			'<p>x<img src="x" onerror="alert(1)"></p>',
			'<p>x<img src="https://evil.example/track.png"></p>',
			"<svg><script>alert(1)</script></svg><p>x</p>",
			'<iframe src="https://evil.example"></iframe><p>x</p>',
			'<p style="background:url(javascript:alert(1))">x</p>',
			'<p><span data-type="mention" data-id="x" onmouseover="alert(1)">@x</span></p>',
			"<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math><p>x</p>",
		]
		for payload in payloads:
			clean, _ = sanitize_comment(payload, members=members, image_urls=images)
			for bad in (
				"<script",
				"onerror",
				"onclick",
				"onmouseover",
				"javascript:",
				"data:text",
				"<iframe",
				"<svg",
				"style=",
				"evil.example",
			):
				self.assertNotIn(bad, clean.lower(), payload)
		safe, _ = sanitize_comment(
			'<p><a href="https://example.com">link</a></p>', members=members, image_urls=images
		)
		self.assertIn('rel="noopener noreferrer nofollow"', safe)

	def test_M_reactions_are_unique_and_own(self):
		comment = _comment(self.task)["name"]
		comments.react(comment, "thumbs_up", True)
		comments.react(comment, "thumbs_up", True)  # repeat
		comments.react(comment, "heart", True)
		as_user("a_member")
		state = comments.react(comment, "thumbs_up", True)
		thumbs = next(r for r in state["reactions"] if r["emoji"] == "thumbs_up")
		self.assertEqual((thumbs["count"], thumbs["mine"]), (2, True))
		comments.react(comment, "heart", False)  # removing someone else's reaction is a no-op
		self.assertEqual(frappe.db.count("Masar Comment Reaction", {"comment": comment, "emoji": "heart"}), 1)
		with self.assertRaises(frappe.ValidationError):
			comments.react(comment, "skull", True)
		frappe.set_user("Administrator")
		with self.assertRaises((frappe.UniqueValidationError, frappe.DuplicateEntryError)):  # database guard
			frappe.get_doc(
				{
					"doctype": "Masar Comment Reaction",
					"comment": comment,
					"task": self.task,
					"space": self.A,
					"user": email("a_member"),
					"emoji": "thumbs_up",
				}
			).insert(ignore_permissions=True)

	def test_P_generic_apis_cannot_bypass(self):
		comment = _comment(self.task)["name"]
		as_user("a_member")  # even a member cannot write through generic APIs
		with self.assertRaises(frappe.PermissionError):
			frappe.client.set_value("Masar Comment", comment, "content", "<p>forged</p>")
		with self.assertRaises(frappe.PermissionError):
			frappe.client.insert(
				{
					"doctype": "Masar Comment",
					"task": self.task,
					"space": self.A,
					"author": email("a_manager"),
					"content": "x",
				}
			)
		with self.assertRaises(frappe.PermissionError):
			frappe.client.delete("Masar Comment", comment)
		with self.assertRaises(frappe.PermissionError):  # delivery records are administrators' data
			frappe.get_list("Masar Comment Notification", pluck="name")
		as_user("b_member")
		with self.assertRaises(frappe.PermissionError):
			frappe.client.get("Masar Comment", comment)


class TestTimeline(CollaborationCase):
	def test_ordering_pagination_and_history(self):
		task_service.update(self.task, {"priority": "High"})
		names = [_comment(self.task, f"Comment {i}")["name"] for i in range(7)]
		task_service.set_completed(self.task, True)
		page = timeline_service.timeline(self.task, "all", limit=4)
		self.assertEqual(len(page["items"]), 4)
		self.assertEqual(page["items"][-1]["history"]["field"], "status")  # newest last
		older = timeline_service.timeline(self.task, "all", before=page["earlierCursor"], limit=4)
		ids = [i["id"] for i in older["items"] + page["items"]]
		self.assertEqual(len(ids), len(set(ids)))
		only = timeline_service.timeline(self.task, "comments", limit=50)
		self.assertEqual([i["comment"]["name"] for i in only["items"]], names)
		history = timeline_service.timeline(self.task, "history", limit=50)["items"]
		events = [i["history"]["event"] for i in history]
		self.assertIn("field_changed", events)
		self.assertNotIn("comment_added", events)
		worklog = timeline_service.timeline(self.task, "worklog")
		self.assertEqual((worklog["items"], worklog["worklogAvailable"]), ([], True))  # Phase 7: real source

	def test_H_anchor_reaches_old_comments(self):
		names = [_comment(self.task, f"Old {i}")["name"] for i in range(12)]
		page = timeline_service.timeline(self.task, "comments", anchor=names[1], limit=5)
		self.assertEqual(page["items"][0]["comment"]["name"], names[1])
		self.assertIsNotNone(page["earlierCursor"])
		self.assertIsNotNone(page["laterCursor"])
		later = timeline_service.timeline(self.task, "comments", after=page["laterCursor"], limit=50)
		self.assertEqual([i["comment"]["name"] for i in later["items"]], names[6:])
		other = _task(self.A, "Elsewhere")
		with self.assertRaises(frappe.DoesNotExistError):  # comment of another task
			timeline_service.timeline(other, anchor=names[1])
		as_user("b_member")
		with self.assertRaises(frappe.DoesNotExistError):
			timeline_service.timeline(self.task, anchor=names[1])

	def test_Q_history_names_only_what_the_viewer_may_see(self):
		from masar.services import batch_service

		batch = batch_service.create_batch("Visible batch", "2026-11-02", preset="one_week")["batch"]["name"]
		batch_service.move_tasks([self.task], batch)
		as_user("a_member")
		history = [i["history"] for i in timeline_service.timeline(self.task, "history")["items"]]
		added = next(h for h in history if h["event"] == "batch_added")
		self.assertEqual(added["batch"], "Visible batch")
		payload = frappe.as_json(history)
		self.assertNotIn(self.world["B"], payload)


class TestAttachments(CollaborationCase):
	def test_upload_list_download_permission_and_delete(self):
		row = _upload(self.task)
		self.assertTrue(row["isImage"])
		self.assertTrue(row["url"].startswith("/private/files/"))
		file_doc = frappe.get_doc("File", frappe.db.get_value("Masar Attachment", row["name"], "file"))
		self.assertEqual((file_doc.is_private, file_doc.attached_to_doctype), (1, "Masar Task"))
		as_user("a_member")
		self.assertEqual([a["name"] for a in attachments.list_attachments(self.task)], [row["name"]])
		self.assertTrue(frappe.has_permission("File", "read", doc=file_doc))
		with self.assertRaises(frappe.PermissionError):  # not the uploader, not a Manager
			attachments.delete(row["name"])
		as_user("a_manager")
		attachments.delete(row["name"])
		self.assertFalse(frappe.db.exists("File", file_doc.name))

	def test_I_J_outsiders_cannot_download_or_upload(self):
		row = _upload(self.task)
		file_doc = frappe.get_doc("File", frappe.db.get_value("Masar Attachment", row["name"], "file"))
		as_user("b_member")
		self.assertFalse(frappe.has_permission("File", "read", doc=file_doc))
		from frappe.core.doctype.file.utils import find_file_by_url

		self.assertIsNone(find_file_by_url(file_doc.file_url))  # the /private/files handler's lookup
		self.assertNotIn(file_doc.name, frappe.get_list("File", pluck="name", limit_page_length=0))
		with self.assertRaises(frappe.DoesNotExistError):
			_upload(self.task)
		with self.assertRaises(frappe.DoesNotExistError):
			attachments.list_attachments(self.task)

	def test_G_revoked_uploader_loses_access(self):
		as_user("ab_member")
		row = _upload(self.task, "mine.png")
		comment = _comment(self.task, "Before removal")["name"]
		file_doc = frappe.get_doc("File", frappe.db.get_value("Masar Attachment", row["name"], "file"))
		self.assertTrue(frappe.has_permission("File", "read", doc=file_doc))
		frappe.set_user("Administrator")
		space = frappe.get_doc("Masar Space", self.A)
		space.set("members", [m for m in space.members if m.user != email("ab_member")])
		space.save(ignore_permissions=True)
		as_user("ab_member")
		# Frappe would let the uploader read their own file; Masar denies it after removal.
		self.assertFalse(frappe.has_permission("File", "read", doc=file_doc))
		from frappe.core.doctype.file.utils import find_file_by_url

		self.assertIsNone(find_file_by_url(file_doc.file_url))
		for call in (
			lambda: timeline_service.timeline(self.task, anchor=comment),
			lambda: comments.get_comment(comment),
			lambda: attachments.list_attachments(self.task),
		):
			with self.assertRaises(frappe.DoesNotExistError):
				call()
		frappe.set_user("Administrator")
		space = frappe.get_doc("Masar Space", self.A)
		clear_membership_cache()

	def test_K_pasted_files_bind_only_to_their_own_task_and_uploader(self):
		pending = _upload(self.task, "paste.png", purpose="Comment")
		other_task = _task(self.A, "Other")
		with self.assertRaises(frappe.ValidationError):  # file uploaded for another task
			comments.create(other_task, f'<p><img src="{pending["url"]}"></p>', _key(), [pending["name"]])
		as_user("a_member")
		with self.assertRaises(frappe.ValidationError):  # someone else's pending upload
			comments.create(self.task, f'<p><img src="{pending["url"]}"></p>', _key(), [pending["name"]])
		as_user("a_manager")
		posted = comments.create(
			self.task, f'<p>See <img src="{pending["url"]}"></p>', _key(), [pending["name"]]
		)["comment"]
		self.assertIn(pending["url"], posted["content"])
		self.assertEqual([a["name"] for a in posted["attachments"]], [pending["name"]])
		# An image URL that is not one of this comment's files is dropped.
		stray = comments.create(self.task, '<p>x<img src="/private/files/someone-else.png"></p>', _key())[
			"comment"
		]
		self.assertNotIn("<img", stray["content"])
		# Deleting the comment removes its files.
		comments.delete(posted["name"])
		self.assertFalse(frappe.db.exists("Masar Attachment", pending["name"]))

	def test_file_validation(self):
		for name, content in (
			("evil.svg", b"<svg onload=alert(1)>"),
			("page.html", b"<html><script>x</script>"),
			("fake.png", b"MZ\x90\x00 not a png"),
			("doc.pdf", PNG),  # extension does not match the bytes
			("../../etc/passwd.txt", b"\x00binary"),
		):
			with self.assertRaises(frappe.ValidationError, msg=name):
				_upload(self.task, name, content)
		row = _upload(self.task, "../../notes.txt", b"plain text")
		self.assertEqual(row["fileName"], "notes.txt")
		frappe.conf.masar_attachment_max_mb = 1
		try:
			with self.assertRaises(frappe.ValidationError):
				_upload(self.task, "big.png", PNG + b"\x00" * (1024 * 1024 + 10))
		finally:
			del frappe.conf.masar_attachment_max_mb

	def test_abandoned_composer_uploads_are_cleaned(self):
		pending = _upload(self.task, "abandoned.png", purpose="Comment")
		frappe.db.set_value("Masar Attachment", pending["name"], "creation", "2026-01-01 00:00:00")
		frappe.set_user("Administrator")
		self.assertGreaterEqual(attachments.cleanup_abandoned_uploads(commit=False), 1)
		self.assertFalse(frappe.db.exists("Masar Attachment", pending["name"]))


class TestNotifications(CollaborationCase):
	def test_notification_link_opens_the_workspace_at_masar(self):
		comment = comments.create(self.task, "<p>Link check</p>", _key())["comment"]["name"]
		frappe.set_user("Administrator")
		notification_service.notify_comment(comment, commit=False)
		messages = frappe.get_all(
			"Email Queue", filters={"reference_doctype": "Masar Comment", "reference_name": comment}, pluck="message"
		)
		self.assertTrue(messages)
		for message in messages:
			decoded = quopri.decodestring(message.encode()).decode(errors="replace")
			self.assertIn(f"/masar/tasks/{self.task}?comment={comment}", decoded)

	def test_O_recipients_are_current_members_once_each(self):
		html = f'<p><span data-type="mention" data-id="{email("a_member")}">@A</span> and again <span data-type="mention" data-id="{email("a_member")}">@A</span></p>'
		comment = comments.create(self.task, html, _key())["comment"]["name"]
		# ab_member is removed after the comment, before the job runs.
		frappe.set_user("Administrator")
		space = frappe.get_doc("Masar Space", self.A)
		space.set("members", [m for m in space.members if m.user != email("ab_member")])
		space.save(ignore_permissions=True)
		clear_membership_cache()
		notification_service.notify_comment(comment, commit=False)
		rows = frappe.get_all(
			"Masar Comment Notification", filters={"comment": comment}, fields=["recipient", "kind", "status"]
		)
		recipients = {r.recipient: r for r in rows}
		self.assertEqual(set(recipients), {email("a_manager"), email("a_member")})
		self.assertEqual(recipients[email("a_member")].kind, "Mention")
		self.assertTrue(all(r.status == "Queued" for r in rows))  # sending is exercised by the E2E mail test
		self.assertEqual(
			notification_service.notify_comment(comment, commit=False),
			{"skipped": "already processed or missing"},
		)
		self.assertEqual(frappe.db.count("Masar Comment Notification", {"comment": comment}), 2)
		space = frappe.get_doc("Masar Space", self.A)
		clear_membership_cache()

	def test_deleted_comment_sends_nothing(self):
		comment = _comment(self.task)["name"]
		comments.delete(comment)
		self.assertEqual(
			notification_service.notify_comment(comment, commit=False),
			{"skipped": "comment deleted before delivery"},
		)


class TestSessionExpiry(CollaborationCase):
	def test_R_guest_requests_fail_safely(self):
		comment = _comment(self.task)["name"]
		frappe.set_user("Guest")
		for call in (
			lambda: comments.create(self.task, "<p>x</p>", _key()),
			lambda: comments.update(comment, "<p>x</p>"),
			lambda: timeline_service.timeline(self.task),
		):
			with self.assertRaises(frappe.PermissionError):
				call()
		self.assertEqual(frappe.db.count("Masar Comment", {"task": self.task}), 1)
