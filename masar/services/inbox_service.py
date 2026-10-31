"""The notification list behind the bell (client revision 5), with e-mail and push delivery.

Where notifications come from:
- Task and Space history (`record_activity`): every path that assigns, changes an owner, marks a Task
  Overdue, adds a member, changes a role or transfers a Space already writes one history entry, so the
  notification is derived from that entry in the same transaction (`from_activity`).
- Comments (`for_comment`): mentioned people, and the Task's assignees and owner.

Delivery:
- The list entry is written in the caller's transaction, so it exists exactly when the change does.
- E-mail goes through Frappe's Email Queue (sent by Frappe's own scheduler, after commit). Comment and
  mention e-mails keep their own pipeline (notification_service, ADR-056), so they are not sent twice.
  People can turn Masar e-mails off for themselves (preference `emailNotifications`).
- One push per request wakes the recipients' installed apps after commit (push_service).

People never notify themselves, and entries about a Space disappear from the list once the person
leaves that Space (the same rule as every other Space content).
"""

import frappe
from frappe import _
from frappe.email.doctype.email_account.email_account import EmailAccount
from frappe.query_builder.functions import Count
from frappe.utils import add_to_date, cint, formatdate, get_url, now_datetime

from masar.permissions import get_user_spaces, is_masar_user, require_masar_user
from masar.services.personal import preference_service
from masar.services.serializers import iso_datetime, user_refs
from masar.utils.context import masar_service

ASSIGNED = "Assigned"
TASK_OWNER = "Task Owner"
OVERDUE = "Overdue"
MENTION = "Mention"
COMMENT = "Comment"
SPACE_MEMBER = "Space Member"
SPACE_ROLE = "Space Role"
SPACE_OWNER = "Space Owner"
# Comment and mention e-mails are sent by notification_service (ADR-056).
EMAILED_BY_COMMENT_PIPELINE = {MENTION, COMMENT}
PAGE_SIZE = 30
EMAIL_PREFERENCE = "masar_email_notifications"


def emails_enabled(user: str) -> bool:
	# The stored row, not Frappe's defaults cache, which can hold an old value (QA-D05).
	return preference_service.stored_values(user)["emailNotifications"] != "0"


# --------------------------------------------------------------------------- creating


def _titles(task: str | None, space: str | None) -> tuple[str | None, str | None]:
	task_title = frappe.db.get_value("Masar Task", task, "title") if task else None
	space_title = frappe.db.get_value("Masar Space", space, "title") if space else None
	return task_title, space_title


def _name(user: str | None) -> str:
	if not user or user in ("Administrator", "Guest"):
		return "Masar"
	return frappe.db.get_value("User", user, "full_name") or user


def _request_state() -> dict:
	"""Per transaction: who was notified about what (to keep one entry per change) and whom to push.
	Cleared on commit and on rollback, so a write retried after a deadlock (masar_write) starts afresh."""
	state = getattr(frappe.local, "masar_inbox", None)
	if state is None:
		state = frappe.local.masar_inbox = {"notified": set(), "push": set()}

		def push_after_commit():
			users = sorted(state["push"])
			frappe.local.masar_inbox = None
			if users and frappe.db.exists("Masar Push Subscription", {"user": ["in", users]}):
				frappe.enqueue("masar.services.push_service.push_to_users", queue="short", users=users)

		def forget():
			frappe.local.masar_inbox = None

		frappe.db.after_commit.add(push_after_commit)
		frappe.db.after_rollback.add(forget)
	return state


def _notify(
	recipients,
	kind: str,
	*,
	space: str | None,
	task: str | None,
	subject: str,
	email: dict,
	detail=None,
	link=None,
	actor=None,
):
	"""Write one list entry per recipient (never the actor), queue its e-mail and its push."""
	actor = actor or frappe.session.user
	state = _request_state()
	for recipient in sorted({r for r in recipients if r}):
		if recipient == actor or not is_masar_user(recipient):
			continue
		# Assigning someone to a Task without assignees also makes them its owner: one entry, not two.
		if kind == TASK_OWNER and (recipient, task, ASSIGNED) in state["notified"]:
			continue
		state["notified"].add((recipient, task, kind))
		with masar_service():
			row = frappe.get_doc(
				{
					"doctype": "Masar Notification",
					"recipient": recipient,
					"kind": kind,
					"actor": actor if actor not in ("Administrator", "Guest") else None,
					"space": space,
					"task": task,
					"subject": subject[:280],
					"detail": detail,
					"link": link,
				}
			).insert(ignore_permissions=True)
			if kind not in EMAILED_BY_COMMENT_PIPELINE:
				row.db_set("email_status", _send_email(row, recipient, email), update_modified=False)
		state["push"].add(recipient)


def _send_email(row, recipient: str, email: dict) -> str:
	if not emails_enabled(recipient):
		return "Muted"
	address = frappe.db.get_value("User", recipient, "email")
	if not address:
		return "No address"
	if not outgoing_email_configured():
		# QA-D07: without an outgoing account frappe.sendmail raises OutgoingEmailError on every
		# notification. That is a known setup state, not a failure: record "Not sent", log nothing.
		return "Not sent"
	try:
		frappe.sendmail(
			recipients=[address],
			subject=f"[Masar] {row.subject}",
			template="masar_notification",
			args=email_args(recipient=recipient, link=row.link, **email),
			reference_doctype="Masar Notification",
			reference_name=row.name,
		)
	except Exception:
		# A configured account that fails is a real failure: logged, and it never undoes the change itself.
		frappe.log_error(title="Masar notification e-mail")
		return "Not sent"
	return "Queued"


def outgoing_email_configured() -> bool:
	"""Whether frappe.sendmail has an outgoing account for Masar Notifications: Frappe's own lookup
	(an enabled default outgoing account, the site config's mail settings, or muted e-mail, which Frappe
	handles itself), without its error. Frappe caches the answer per request."""
	return bool(EmailAccount.find_outgoing(match_by_doctype="Masar Notification"))


def email_args(
	*,
	recipient: str,
	link: str | None,
	heading: str,
	intro: str,
	cta: str,
	reason: str,
	context=None,
	quote=None,
	tone="violet",
) -> dict:
	"""Arguments of templates/emails/masar_notification.html, which escapes every value."""
	return {
		"heading": heading,
		"intro": intro,
		"context": context,  # {"label", "title", "meta"}
		"quote": quote,
		"cta_label": cta,
		"cta_url": get_url(f"/masar{link}") if link else get_url("/masar"),
		"reason": reason,
		"settings_url": get_url("/masar/my-day?notifications=1"),
		"recipient_name": _name(recipient).split(" ")[0],
		"tone": tone,
		"logo_url": get_url("/assets/masar/images/masar-icon-192.png"),
	}


def from_activity(doctype: str, name: str, space: str | None, event: str, data: dict):
	"""Called by record_activity for every history entry; most events notify nobody."""
	actor = frappe.session.user
	if doctype == "Masar Task":
		if event == "assigned":
			_task_notification(ASSIGNED, [data.get("user")], name, space, actor)
		elif event == "owner_changed" and data.get("to"):
			_task_notification(TASK_OWNER, [data["to"]], name, space, actor)
		elif event == "field_changed" and data.get("field") == "status" and data.get("to") == "Overdue":
			assignees = frappe.get_all(  # system job: the Task's own assignees
				"Masar Task Assignee", filters={"parent": name, "parenttype": "Masar Task"}, pluck="user"
			)
			_task_notification(OVERDUE, assignees, name, space, actor)
	elif doctype == "Masar Space":
		if event == "member_added":
			_space_notification(SPACE_MEMBER, data.get("user"), name, actor, role=data.get("role"))
		elif event == "role_changed":
			_space_notification(SPACE_ROLE, data.get("user"), name, actor, role=data.get("to"))
		elif event == "ownership_transferred":
			_space_notification(SPACE_OWNER, data.get("to"), name, actor)
			_space_notification(SPACE_OWNER, data.get("from"), name, actor, new_owner=data.get("to"))
		elif event == "space_created" and data.get("owner") != actor:
			_space_notification(SPACE_OWNER, data.get("owner"), name, actor)


def _task_notification(kind: str, recipients: list, task: str, space: str | None, actor: str):
	task_title, space_title = _titles(task, space)
	if not task_title:
		return
	who = _name(actor)
	due = frappe.db.get_value("Masar Task", task, "due_date")
	meta = " · ".join(filter(None, [space_title, _("Due {0}").format(formatdate(due)) if due else None]))
	context = {"label": _("Task"), "title": task_title, "meta": meta}
	if kind == ASSIGNED:
		subject = _("{0} assigned you to “{1}”").format(who, task_title)
		email = {
			"heading": _("You have a new task"),
			"intro": _("{0} assigned you to a task in {1}.").format(who, space_title),
			"reason": _("You receive this because you were assigned to this task."),
		}
	elif kind == TASK_OWNER:
		subject = _("{0} made you the owner of “{1}”").format(who, task_title)
		email = {
			"heading": _("You now own a task"),
			"intro": _(
				"{0} made you the owner of a task in {1}. You are responsible for seeing it through."
			).format(who, space_title),
			"reason": _("You receive this because you are the owner of this task."),
		}
	else:
		subject = _("“{0}” is overdue").format(task_title)
		email = {
			"heading": _("A task is overdue"),
			"intro": _("This task passed its due date and is not finished yet."),
			"reason": _("You receive this because you are assigned to this task."),
			"tone": "danger",
		}
	email.update({"cta": _("Open task"), "context": context})
	_notify(
		recipients,
		kind,
		space=space,
		task=task,
		subject=subject,
		detail=meta or None,
		link=f"/tasks/{task}",
		email=email,
		actor=actor,
	)


def _space_notification(kind: str, recipient: str | None, space: str, actor: str, role=None, new_owner=None):
	if not recipient:
		return
	space_title = frappe.db.get_value("Masar Space", space, "title")
	who = _name(actor)
	context = {"label": _("Space"), "title": space_title, "meta": _(role) if role else None}
	if kind == SPACE_MEMBER:
		subject = _("{0} added you to the Space “{1}”").format(who, space_title)
		email = {
			"heading": _("Welcome to {0}").format(space_title),
			"intro": _(
				"{0} added you to this Space as {1}. Its tasks, Batches and roadmap are now open to you."
			).format(who, _(role or "Member")),
			"reason": _("You receive this because you were added to this Space."),
			"cta": _("Open Space"),
		}
	elif kind == SPACE_ROLE:
		subject = _("{0} changed your role in “{1}” to {2}").format(who, space_title, _(role))
		email = {
			"heading": _("Your role changed"),
			"intro": _("{0} changed your role in this Space to {1}.").format(who, _(role)),
			"reason": _("You receive this because you are a member of this Space."),
			"cta": _("Open Space"),
		}
	elif new_owner:
		subject = _("{0} transferred ownership of “{1}” to {2}").format(who, space_title, _name(new_owner))
		email = {
			"heading": _("Space ownership transferred"),
			"intro": _("{0} transferred ownership of this Space to {1}. You stay a member.").format(
				who, _name(new_owner)
			),
			"reason": _("You receive this because you owned this Space."),
			"cta": _("Open Space"),
		}
	else:
		subject = _("{0} made you the owner of the Space “{1}”").format(who, space_title)
		email = {
			"heading": _("You now own a Space"),
			"intro": _(
				"{0} made you the owner of this Space. You manage its members, settings and lifecycle."
			).format(who),
			"reason": _("You receive this because you are the owner of this Space."),
			"cta": _("Open Space"),
		}
	email["context"] = context
	_notify(
		[recipient],
		kind,
		space=space,
		task=None,
		subject=subject,
		detail=context["meta"],
		link=f"/spaces/{space}/tasks",
		email=email,
		actor=actor,
	)


def for_comment(task, comment: str, mentioned: list[str], excerpt: str):
	"""A new comment: mentioned members, then the Task's assignees and owner (never the author)."""
	who = _name(frappe.session.user)
	link = f"/tasks/{task.name}?comment={comment}"
	short = (excerpt[:200] + "…") if len(excerpt) > 200 else excerpt
	email = {}  # comment e-mails are sent by notification_service
	_notify(
		mentioned,
		MENTION,
		space=task.space,
		task=task.name,
		subject=_("{0} mentioned you on “{1}”").format(who, task.title),
		detail=short,
		link=link,
		email=email,
	)
	followers = {row.user for row in task.assignees} | ({task.task_owner} if task.task_owner else set())
	_notify(
		followers - set(mentioned),
		COMMENT,
		space=task.space,
		task=task.name,
		subject=_("{0} commented on “{1}”").format(who, task.title),
		detail=short,
		link=link,
		email=email,
	)


# --------------------------------------------------------------------------- reading


def _visible(query, row, user: str):
	"""Own entries, about Spaces the person still belongs to (or about no Space)."""
	spaces = list(get_user_spaces(user)) or [""]
	return query.where((row.recipient == user) & (row.space.isnull() | row.space.isin(spaces)))


def list_notifications(
	unread_only: bool = False, before: str | None = None, since=None, limit: int = PAGE_SIZE
) -> dict:
	require_masar_user()
	user = frappe.session.user
	limit = max(1, min(cint(limit) or PAGE_SIZE, 100))
	row = frappe.qb.DocType("Masar Notification")
	query = _visible(frappe.qb.from_(row), row, user).select(
		row.name,
		row.kind,
		row.actor,
		row.space,
		row.task,
		row.subject,
		row.detail,
		row.link,
		row.is_read,
		row.creation,
	)
	if unread_only:
		query = query.where(row.is_read == 0)
	if before:
		query = query.where(row.creation < before)
	if since:
		query = query.where(row.creation >= since)
	rows = query.orderby(row.creation, order=frappe.qb.desc).limit(limit + 1).run(as_dict=True)
	more = len(rows) > limit
	rows = rows[:limit]
	refs = user_refs([r.actor for r in rows])
	return {
		"items": [
			{
				"name": r.name,
				"kind": r.kind,
				"actor": refs.get(r.actor),
				"space": r.space,
				"task": r.task,
				"subject": r.subject,
				"detail": r.detail,
				"link": r.link,
				"isRead": bool(r.is_read),
				"at": iso_datetime(r.creation),
			}
			for r in rows
		],
		"nextBefore": str(rows[-1].creation) if more else None,
		"unread": unread_count(),
	}


def unread_count() -> int:
	require_masar_user()
	row = frappe.qb.DocType("Masar Notification")
	query = _visible(frappe.qb.from_(row), row, frappe.session.user).where(row.is_read == 0)
	return query.select(Count("*")).run()[0][0]


def latest_unread(minutes: int = 15) -> list[dict]:
	"""For the service worker after a push: the newest unread entries of the last minutes."""
	return list_notifications(unread_only=True, since=add_to_date(now_datetime(), minutes=-minutes), limit=5)[
		"items"
	]


def mark_read(names: list[str] | None = None, read: bool = True, all_unread: bool = False) -> dict:
	"""Mark the caller's own entries read or unread; anyone else's names are ignored."""
	require_masar_user()
	user = frappe.session.user
	row = frappe.qb.DocType("Masar Notification")
	update = (
		frappe.qb.update(row)
		.set(row.is_read, 1 if read else 0)
		.set(row.read_at, now_datetime() if read else None)
	)
	if all_unread:
		update = update.where((row.recipient == user) & (row.is_read == 0))
	else:
		names = [n for n in (names or []) if isinstance(n, str)][: PAGE_SIZE * 4]
		if not names:
			return {"unread": unread_count()}
		update = update.where((row.recipient == user) & row.name.isin(names))
	with masar_service():
		update.run()
	return {"unread": unread_count()}
