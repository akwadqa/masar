"""Comment e-mail notifications (ADR-056).

States, kept apart on purpose:
1. Event created — the comment and its `comment_added` history entry (comment transaction).
2. Queued — this job, enqueued only after that transaction committed (never for a rolled-back or
   repeated create), writes one `Masar Comment Notification` per recipient (unique per comment+recipient).
3. Delivery attempted — the Email Queue entry is sent immediately after the recipient is re-checked.
4. Sent / Failed — recorded per recipient (Failed keeps the error, e.g. no outgoing e-mail account).

Recipients (client revision 6, 2026-11-01; reverses ADR-056's "every member, including the author"):
the Task's owner and assignees and the mentioned members, never the author. Other members of the Space
get the comment in their bell and as a push only (inbox_service.for_comment). Recipients are rebuilt at
delivery time from the Task and current membership, so a member removed in between receives nothing.
Mentioned members get the "mentioned you" message instead of the general one — never both.
"""

import json

import frappe
from frappe import _
from frappe.utils import now_datetime

from masar.services.comment_service import preview, space_members
from masar.services.inbox_service import email_args, emails_enabled, owner_and_assignees
from masar.utils.context import masar_service


def notify_comment(comment: str, commit: bool = True):
	doc = frappe.db.get_value(
		"Masar Comment",
		comment,
		["name", "task", "space", "author", "content", "mentions", "is_deleted", "notified_at"],
		as_dict=True,
	)
	if not doc or doc.notified_at:
		return {"skipped": "already processed or missing"}
	frappe.db.set_value("Masar Comment", comment, "notified_at", now_datetime(), update_modified=False)
	_commit(commit)  # claim the comment first, so a duplicate job does nothing
	if doc.is_deleted:
		return {"skipped": "comment deleted before delivery"}
	task_title = frappe.db.get_value("Masar Task", doc.task, "title")
	if not task_title:
		return {"skipped": "task deleted before delivery"}
	author = frappe.db.get_value("User", doc.author, "full_name") or doc.author
	mentioned = set(json.loads(doc.mentions or "[]"))
	recipients = (set(owner_and_assignees(doc.task)) | mentioned) & (space_members(doc.space) - {doc.author})
	results = {"Queued": 0, "Sent": 0, "Failed": 0, "Skipped": 0}
	for recipient in sorted(recipients):
		results[_deliver(doc, recipient, recipient in mentioned, task_title, author, commit)] += 1
	return results


def _commit(commit: bool):
	"""Background jobs commit per recipient so each state is durable; integration tests pass False."""
	if commit:
		frappe.db.commit()


def _deliver(doc, recipient: str, mentioned: bool, task_title: str, author: str, commit: bool) -> str:
	email = frappe.db.get_value("User", recipient, "email")
	record = {
		"doctype": "Masar Comment Notification",
		"comment": doc.name,
		"task": doc.task,
		"space": doc.space,
		"recipient": recipient,
		"kind": "Mention" if mentioned else "Comment",
		"status": "Queued",
	}
	if frappe.db.exists("Masar Comment Notification", {"comment": doc.name, "recipient": recipient}):
		return "Skipped"  # already handled (duplicate job)
	with masar_service():
		row = frappe.get_doc(record).insert(ignore_permissions=True)
	_commit(commit)
	# Membership is checked again right before the attempt (it may have changed while queued).
	if recipient not in space_members(doc.space) or not email:
		row.db_set({"status": "Skipped", "error": "No longer a member, or no e-mail address"})
		_commit(commit)
		return "Skipped"
	if not emails_enabled(recipient):
		row.db_set({"status": "Skipped", "error": "E-mail notifications turned off by the recipient"})
		_commit(commit)
		return "Skipped"
	space_title = frappe.db.get_value("Masar Space", doc.space, "title")
	subject = (
		_("{0} mentioned you on “{1}”").format(author, task_title)
		if mentioned
		else _("{0} commented on “{1}”").format(author, task_title)
	)
	# Same template as every other Masar e-mail (client revision 5); the link opens /masar/tasks/...
	args = email_args(
		recipient=recipient,
		link=f"/tasks/{doc.task}?comment={doc.name}",
		heading=_("You were mentioned") if mentioned else _("New comment"),
		intro=(
			_("{0} mentioned you in a comment.") if mentioned else _("{0} commented on a task in your Space.")
		).format(author),
		context={"label": _("Task"), "title": task_title, "meta": space_title},
		quote=preview(doc),
		cta=_("Reply in Masar"),
		reason=_("You receive this because you were mentioned in it.")
		if mentioned
		else _("You receive this because you own or are assigned to this task."),
	)
	try:
		# Build the Email Queue entry without Frappe's deferred "send after commit", then send it here,
		# straight after the membership check, and record Frappe's own result for this recipient.
		queue = frappe.sendmail(
			recipients=[email],
			subject=f"[Masar] {subject}",
			template="masar_notification",
			args=args,
			reference_doctype="Masar Comment",
			reference_name=doc.name,
			now=False,
		)
		_commit(commit)
		if not commit:
			# Inside a caller's transaction (integration tests): Frappe's sender commits on its own, so
			# stop at Queued. Real sending is verified end to end against the mail sink.
			return "Queued"
		if queue:
			queue.send()
		result = (
			frappe.db.get_value("Email Queue", queue.name, ["status", "error"], as_dict=True)
			if queue
			else None
		)
		if result and result.status == "Sent":
			row.db_set({"status": "Sent", "attempted_at": now_datetime(), "error": None})
			status = "Sent"
		else:
			reason = (
				result.error if result else None
			) or f"Email Queue status: {result.status if result else 'not created'}"
			row.db_set({"status": "Failed", "attempted_at": now_datetime(), "error": str(reason)[:500]})
			status = "Failed"
	except Exception as error:
		if commit:
			frappe.db.rollback()
		row.db_set({"status": "Failed", "attempted_at": now_datetime(), "error": str(error)[:500]})
		status = "Failed"
	_commit(commit)
	return status
