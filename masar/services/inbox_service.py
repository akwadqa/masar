"""The notification list behind the bell (client revision 5), with e-mail and push delivery.

Where notifications come from:
- Task and Space history (`record_activity`): every path that assigns, changes an owner or a status,
  marks a Task Overdue, adds a member, changes a role or transfers a Space already writes one history
  entry, so the notification is derived from that entry in the same transaction (`from_activity`).
- Comments (`for_comment`) and reactions (`for_reaction`).

Who hears about what (client revision 6, 2026-11-01/02; specs/client-revision-6.md):
- New comment: mentioned people, the Task's owner and assignees (who also get the e-mail, sent by
  notification_service), and every other member of the Space (bell and push only).
- Status change: the Task's owner and assignees. A bulk change sends one summary per person.
- Assignment: the new assignee. Owner change: the new owner. Overdue: the owner and the assignees.
- Reaction: the comment's author only, without e-mail.
- Space events: the person concerned.

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
STATUS = "Status"
REACTION = "Reaction"
# Comment and mention e-mails are sent by notification_service (ADR-056); reactions are never e-mailed
# (client revision 6).
NOT_EMAILED_HERE = {MENTION, COMMENT, REACTION}
# Shown in subjects (stored keys, rendered as emoji by the Workspace; comment_service.REACTIONS).
REACTION_EMOJI = {"thumbs_up": "👍", "heart": "❤️", "tada": "🎉", "smile": "😄", "eyes": "👀", "check": "✅"}
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
			if kind not in NOT_EMAILED_HERE:
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


def _current_members(space: str | None) -> set[str]:
	from masar.services.comment_service import space_members  # comment_service imports this module

	return space_members(space) if space else set()


def owner_and_assignees(task: str) -> list[str]:
	"""The people a Task's status concerns: its owner and its assignees, as stored now, who are still
	current, enabled members of its Space. Masar keeps the owner when they leave the Space (I-TASK-2),
	so without this check a former member would get e-mail about the Task."""
	row = frappe.db.get_value("Masar Task", task, ["task_owner", "space"], as_dict=True)
	if not row:
		return []
	assignees = frappe.get_all(  # Masar's own lookup for notifications, after the change was authorised
		"Masar Task Assignee", filters={"parent": task, "parenttype": "Masar Task"}, pluck="user"
	)
	members = _current_members(row.space)
	return [user for user in {*assignees, row.task_owner} if user and user in members]


def from_activity(doctype: str, name: str, space: str | None, event: str, data: dict):
	"""Called by record_activity for every history entry; most events notify nobody."""
	actor = frappe.session.user
	if doctype == "Masar Task":
		if event == "assigned":
			_task_notification(ASSIGNED, [data.get("user")], name, space, actor)
		elif event == "owner_changed" and data.get("to"):
			_task_notification(TASK_OWNER, [data["to"]], name, space, actor)
		elif event == "field_changed" and data.get("field") == "status" and data.get("to") == "Overdue":
			_task_notification(OVERDUE, owner_and_assignees(name), name, space, actor)
		elif event == "field_changed" and data.get("field") == "status" and data.get("to"):
			change = {"task": name, "space": space, "from": data.get("from"), "to": data["to"]}
			collected = getattr(frappe.local, "masar_status_changes", None)
			if collected is not None:
				collected.append(change)  # a bulk change: one summary per person when it ends
			else:
				_status_notification(change, owner_and_assignees(name), actor)
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


def _status_notification(change: dict, recipients: list, actor: str):
	task, space = change["task"], change["space"]
	task_title, space_title = _titles(task, space)
	if not task_title:
		return
	who = _name(actor)
	old, new = _(change["from"] or "Open"), _(change["to"])
	_notify(
		recipients,
		STATUS,
		space=space,
		task=task,
		subject=_("{0} changed “{1}” to {2}").format(who, task_title, new),
		detail=_("{0} → {1}").format(old, new),
		link=f"/tasks/{task}",
		email={
			"heading": _("Task status changed"),
			"intro": _("{0} changed the status of a task in {1} from {2} to {3}.").format(
				who, space_title, old, new
			),
			"reason": _("You receive this because you own or are assigned to this task."),
			"cta": _("Open task"),
			"context": {"label": _("Task"), "title": task_title, "meta": space_title},
		},
		actor=actor,
	)


class collect_status_changes:
	"""Bulk edits (task_service.bulk_update): status changes made inside are collected and, when the
	block ends without an error, each person concerned gets one notification: the usual one when only
	one of their Tasks changed, otherwise a summary (client revision 6, 2026-11-01)."""

	def __enter__(self):
		self.outer = getattr(frappe.local, "masar_status_changes", None)
		frappe.local.masar_status_changes = [] if self.outer is None else self.outer
		return self

	def __exit__(self, error_type, error, traceback):
		changes = frappe.local.masar_status_changes
		frappe.local.masar_status_changes = self.outer
		if error_type is None and self.outer is None and changes:
			_notify_status_changes(changes, frappe.session.user)
		return False


def _notify_status_changes(changes: list[dict], actor: str):
	by_person: dict[str, list[dict]] = {}
	for change in changes:
		for person in set(owner_and_assignees(change["task"])):
			by_person.setdefault(person, []).append(change)
	for person, own in sorted(by_person.items()):
		if len(own) == 1:
			_status_notification(own[0], [person], actor)
		else:
			_status_summary(person, own, actor)


def _status_summary(person: str, changes: list[dict], actor: str):
	who = _name(actor)
	count = len(changes)
	spaces = {c["space"] for c in changes}
	space = spaces.pop() if len(spaces) == 1 else None
	lines = [
		_("{0}: {1}").format(frappe.db.get_value("Masar Task", c["task"], "title") or c["task"], _(c["to"]))
		for c in changes
	]
	shown = "; ".join(lines[:10]) + ("; …" if count > 10 else "")
	_notify(
		[person],
		STATUS,
		space=space,
		task=None,
		subject=_("{0} changed the status of {1} tasks").format(who, count),
		detail=shown[:500],
		link=f"/spaces/{space}/tasks" if space else "/tasks",
		email={
			"heading": _("Task statuses changed"),
			"intro": _("{0} changed the status of {1} tasks you own or are assigned to.").format(who, count),
			"reason": _("You receive this because you own or are assigned to these tasks."),
			"cta": _("Open tasks"),
			"quote": shown,
		},
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
	"""A new comment: mentioned members, the Task's assignees and owner, then every other member of the
	Space (client revision 6). Never the author. The e-mails are sent by notification_service."""
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
	# Everyone else in the Space: the Task's owner and assignees also get the e-mail (notification_service),
	# the other members only this entry and its push.
	_notify(
		_current_members(task.space) - set(mentioned),
		COMMENT,
		space=task.space,
		task=task.name,
		subject=_("{0} commented on “{1}”").format(who, task.title),
		detail=short,
		link=link,
		email=email,
	)


def for_reaction(comment, emoji: str):
	"""A reaction to a comment: its author only, bell and push without e-mail (client revision 6)."""
	task_title = frappe.db.get_value("Masar Task", comment.task, "title")
	if not task_title or comment.author not in _current_members(comment.space):
		return
	who = _name(frappe.session.user)
	_notify(
		[comment.author],
		REACTION,
		space=comment.space,
		task=comment.task,
		subject=_("{0} reacted {1} to your comment on “{2}”").format(
			who, REACTION_EMOJI.get(emoji, ""), task_title
		),
		detail=None,
		link=f"/tasks/{comment.task}?comment={comment.name}",
		email={},
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
