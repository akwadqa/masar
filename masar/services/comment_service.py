"""Task comments, mentions and reactions (ADR-051 … ADR-053, ADR-056).

Rules (provisional moderation policy, ADR-051):
- Members of the Task's Space read comments; writing follows the Space lifecycle (ADR-026).
- Authors edit and delete their own comments; Managers may also delete (never edit) others' comments.
- Deletion is soft: the content is erased, the row and its metadata stay as evidence.
The author is always the session user.
"""

import json
import re

import frappe
from frappe import _
from frappe.utils import now_datetime

from masar.exceptions import MasarConflictError, MasarRequestReuseError
from masar.permissions import (
	MANAGER,
	can_write_tasks,
	get_space_role,
	get_space_status,
	not_found,
	require_masar_user,
	require_task_access,
	require_task_write,
)
from masar.services import inbox_service
from masar.services.activity import record_activity
from masar.services.rich_text import plain_text, sanitize_comment
from masar.services.serializers import iso_datetime, user_refs
from masar.utils.context import concurrent_duplicate, masar_service

REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
# One coherent, small reaction set (ADR-053). Stored by key; rendered as emoji by the Workspace.
REACTIONS = ("thumbs_up", "heart", "tada", "smile", "eyes", "check")


def space_members(space: str) -> set[str]:
	"""Users who may be mentioned / notified: current, enabled members of the Space."""
	member = frappe.qb.DocType("Masar Space Member")
	user = frappe.qb.DocType("User")
	rows = (
		frappe.qb.from_(member)
		.join(user)
		.on(user.name == member.user)
		.select(member.user)
		.where((member.parent == space) & (member.parenttype == "Masar Space") & (user.enabled == 1))
		.run()
	)
	return {u for (u,) in rows}


def _writable_task(task_name: str):
	task = require_task_access(task_name)
	require_task_write(task.space, get_space_role(task.space))
	return task


def _comment(comment_name: str, *, lock: bool = False):
	"""A comment of a Task the caller may read, else 404 (same answer for missing comments)."""
	require_masar_user()
	row = (
		frappe.db.get_value("Masar Comment", comment_name, ["task", "space"], as_dict=True)
		if comment_name
		else None
	)
	if not row or get_space_role(row.space) is None:
		not_found("Comment")
	return frappe.get_doc("Masar Comment", comment_name, for_update=lock)


# --------------------------------------------------------------------------- serialisation


def serialise_comments(rows: list) -> list[dict]:
	"""Fixed number of queries for any page: authors, reactions, attachments."""
	if not rows:
		return []
	names = [r.name for r in rows]
	refs = user_refs([r.author for r in rows] + [r.deleted_by for r in rows if r.get("deleted_by")])
	me = frappe.session.user
	reaction = frappe.qb.DocType("Masar Comment Reaction")
	reactions: dict[str, dict[str, dict]] = {}
	for comment, emoji, user in (
		frappe.qb.from_(reaction)
		.select(reaction.comment, reaction.emoji, reaction.user)
		.where(reaction.comment.isin(names))
		.orderby(reaction.creation)
		.run()
	):
		entry = reactions.setdefault(comment, {}).setdefault(
			emoji, {"emoji": emoji, "count": 0, "mine": False, "users": []}
		)
		entry["count"] += 1
		entry["mine"] = entry["mine"] or user == me
		entry["users"].append(user)
	all_users = {u for per in reactions.values() for e in per.values() for u in e["users"]}
	refs.update(user_refs(list(all_users - set(refs))))
	files = frappe.qb.DocType("Masar Attachment")
	attachments: dict[str, list] = {}
	for row in (
		frappe.qb.from_(files)
		.select(
			files.name,
			files.comment,
			files.file_name,
			files.file_url,
			files.file_size,
			files.is_image,
			files.content_type,
		)
		.where(files.comment.isin(names))
		.orderby(files.creation)
		.run(as_dict=True)
	):
		attachments.setdefault(row.comment, []).append(attachment_row(row))
	role_cache: dict[str, str | None] = {}
	result = []
	for r in rows:
		role = role_cache.setdefault(r.space, get_space_role(r.space))
		writable = can_write_tasks(get_space_status(r.space), role)
		deleted = bool(r.is_deleted)
		result.append(
			{
				"name": r.name,
				"task": r.task,
				"author": refs.get(r.author),
				"content": None if deleted else r.content,
				"createdAt": iso_datetime(r.creation),
				"editedAt": iso_datetime(r.edited_at),
				"modified": iso_datetime(r.modified),
				"isDeleted": deleted,
				"deletedAt": iso_datetime(r.get("deleted_at")),
				"deletedBy": refs.get(r.deleted_by) if deleted and r.get("deleted_by") else None,
				"reactions": [
					{**e, "users": [refs[u]["fullName"] for u in e["users"] if u in refs]}
					for e in sorted(
						reactions.get(r.name, {}).values(),
						key=lambda e: REACTIONS.index(e["emoji"]) if e["emoji"] in REACTIONS else 99,
					)
				],
				"attachments": [] if deleted else attachments.get(r.name, []),
				"permissions": {
					"canEdit": writable and not deleted and r.author == me,
					"canDelete": writable and not deleted and (r.author == me or role == MANAGER),
					"canReact": writable and not deleted,
				},
			}
		)
	return result


def attachment_row(row) -> dict:
	return {
		"name": row.name,
		"fileName": row.file_name,
		"url": row.file_url,
		"size": row.file_size,
		"isImage": bool(row.is_image),
		"contentType": row.content_type,
	}


COMMENT_FIELDS = (
	"name",
	"task",
	"space",
	"author",
	"content",
	"creation",
	"modified",
	"edited_at",
	"is_deleted",
	"deleted_at",
	"deleted_by",
)


def get_comment(comment_name: str) -> dict:
	doc = _comment(comment_name)
	return serialise_comments([frappe._dict({f: doc.get(f) for f in COMMENT_FIELDS})])[0]


# --------------------------------------------------------------------------- writes


def _pending_uploads(task: str, names: list[str]) -> list:
	"""Composer uploads the caller made for this Task and has not yet attached to a comment."""
	names = [n for n in (names or []) if isinstance(n, str)][:20]
	if not names:
		return []
	rows = frappe.get_all(  # restricted below to the caller's own pending uploads of this Task
		"Masar Attachment",
		filters={"name": ["in", names]},
		fields=["name", "task", "comment", "owner", "file_url", "purpose"],
	)
	if len(rows) != len(set(names)) or any(
		r.task != task or r.comment or r.owner != frappe.session.user or r.purpose != "Comment" for r in rows
	):
		frappe.throw(_("An attached file does not belong to this task."))
	return rows


def _find_created(key: str, task: str):
	existing = frappe.db.get_value(
		"Masar Comment",
		{"owner": frappe.session.user, "client_request_id": key},
		["name", "task"],
		as_dict=True,
	)
	if existing and existing.task != task:
		frappe.throw(_("This request id was already used for a different comment."), MasarRequestReuseError)
	return existing.name if existing else None


def create(
	task_name: str, content: str, client_request_id: str, attachments: list[str] | None = None
) -> dict:
	"""Post a comment. Idempotent per (author, client_request_id): a repeat after a lost response
	returns the same comment and queues no second notification (ADR-042, ADR-056)."""
	if not client_request_id or not REQUEST_ID.match(client_request_id):
		frappe.throw(_("A valid client request id is required."))
	task = _writable_task(task_name)
	existing = _find_created(client_request_id, task.name)
	if existing:
		return {"comment": get_comment(existing), "created": False}
	pending = _pending_uploads(task.name, attachments or [])
	html, mentioned = sanitize_comment(
		content, members=space_members(task.space), image_urls={p.file_url for p in pending}
	)
	doc = frappe.get_doc(
		{
			"doctype": "Masar Comment",
			"task": task.name,
			"space": task.space,
			"author": frappe.session.user,
			"content": html,
			"mentions": json.dumps(mentioned),
			"client_request_id": client_request_id,
		}
	)
	frappe.db.savepoint("masar_comment_create")
	try:
		with masar_service():
			doc.insert()
			for p in pending:
				frappe.db.set_value("Masar Attachment", p.name, "comment", doc.name, update_modified=False)
			_refresh_count(task.name)
			record_activity(task, "comment_added", {"comment": doc.name}, space=task.space)
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		frappe.db.rollback(save_point="masar_comment_create")
		existing = _find_created(client_request_id, task.name)
		if not existing:
			concurrent_duplicate()
		return {"comment": get_comment(existing), "created": False}
	# Bell entries for mentioned people, the owner and assignees, and the other members (client revision 6).
	inbox_service.for_comment(task, doc.name, mentioned, preview(doc))
	# Notifications are built after commit, from the then-current membership (ADR-056).
	frappe.enqueue(
		"masar.services.notification_service.notify_comment",
		queue="short",
		comment=doc.name,
		enqueue_after_commit=True,
		job_id=f"masar-comment-notify-{doc.name}",
		deduplicate=True,
	)
	return {"comment": get_comment(doc.name), "created": True}


def update(comment_name: str, content: str, base_modified: str | None = None) -> dict:
	"""Authors edit their own words; nobody edits someone else's (ADR-051). `base_modified` is the
	version the editor started from; a newer stored version is a conflict, never overwritten."""
	doc = _comment(comment_name, lock=True)
	require_task_write(doc.space, get_space_role(doc.space))
	if doc.is_deleted:
		frappe.throw(_("This comment was deleted."), frappe.PermissionError)
	if doc.author != frappe.session.user:
		frappe.throw(_("Only the author can edit a comment."), frappe.PermissionError)
	if base_modified and iso_datetime(doc.modified) != base_modified:
		frappe.local.response["conflicts"] = [{"field": "content", "current": iso_datetime(doc.modified)}]
		frappe.throw(_("This comment changed meanwhile. Review the latest version."), MasarConflictError)
	kept = frappe.get_all("Masar Attachment", filters={"comment": doc.name}, pluck="file_url")  # same comment
	html, mentioned = sanitize_comment(content, members=space_members(doc.space), image_urls=set(kept))
	if html == doc.content:
		return get_comment(doc.name)
	doc.content = html
	doc.mentions = json.dumps(mentioned)
	doc.edited_at = now_datetime()
	with masar_service():
		doc.save()
		record_activity(
			frappe._dict(doctype="Masar Task", name=doc.task, space=doc.space),
			"comment_edited",
			{"comment": doc.name},
			space=doc.space,
		)
	return get_comment(doc.name)


def delete(comment_name: str) -> dict:
	"""Soft delete by the author, or moderation by a Space Manager (ADR-051). The text and the
	comment's files are removed; the row keeps author, times and who deleted it."""
	from masar.services.attachment_service import remove_files

	doc = _comment(comment_name, lock=True)
	role = get_space_role(doc.space)
	require_task_write(doc.space, role)
	if doc.is_deleted:
		return get_comment(doc.name)
	moderated = doc.author != frappe.session.user
	if moderated and role != MANAGER:
		frappe.throw(_("Only the author or a Space Manager can delete this comment."), frappe.PermissionError)
	doc.is_deleted = 1
	doc.deleted_at = now_datetime()
	doc.deleted_by = frappe.session.user
	doc.content = None
	doc.mentions = None
	with masar_service():
		doc.save()
		remove_files(frappe.get_all("Masar Attachment", filters={"comment": doc.name}, pluck="name"))
		frappe.db.delete("Masar Comment Reaction", {"comment": doc.name})
		_refresh_count(doc.task)
		record_activity(
			frappe._dict(doctype="Masar Task", name=doc.task, space=doc.space),
			"comment_deleted",
			{"comment": doc.name, "author": doc.author, "moderated": moderated},
			space=doc.space,
		)
	return get_comment(doc.name)


def react(comment_name: str, emoji: str, active: bool) -> dict:
	"""Set-style: add or remove the caller's own reaction. The unique (comment, user, emoji) index
	makes concurrent duplicates collapse into one (ADR-053)."""
	if emoji not in REACTIONS:
		frappe.throw(_("Unsupported reaction."))
	doc = _comment(comment_name)
	require_task_write(doc.space, get_space_role(doc.space))
	if doc.is_deleted:
		frappe.throw(_("This comment was deleted."), frappe.PermissionError)
	key = {"comment": doc.name, "user": frappe.session.user, "emoji": emoji}
	existing = frappe.db.get_value("Masar Comment Reaction", key, "name")
	with masar_service():
		if active and not existing:
			frappe.db.savepoint("masar_reaction")
			try:
				frappe.get_doc(
					{"doctype": "Masar Comment Reaction", "task": doc.task, "space": doc.space, **key}
				).insert()
			except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
				frappe.db.rollback(save_point="masar_reaction")  # a concurrent identical reaction won
			else:
				# The comment's author hears about it, without e-mail (client revision 6).
				inbox_service.for_reaction(doc, emoji)
		elif not active and existing:
			frappe.delete_doc("Masar Comment Reaction", existing)
	return get_comment(doc.name)


def mention_candidates(task_name: str, query: str = "", limit: int = 8) -> list[dict]:
	"""People who can be mentioned on this Task: current members of its Space only."""
	task = require_task_access(task_name)
	members = space_members(task.space)
	refs = user_refs(list(members))
	term = (query or "").strip().casefold()
	matches = [
		r
		for r in refs.values()
		if not term or term in r["fullName"].casefold() or term in r["name"].casefold()
	]
	matches.sort(key=lambda r: (not r["fullName"].casefold().startswith(term), r["fullName"].casefold()))
	return matches[: max(1, min(int(limit or 8), 20))]


def _refresh_count(task: str):
	count = frappe.db.count("Masar Comment", {"task": task, "is_deleted": 0})
	frappe.db.set_value("Masar Task", task, "comment_count", count, update_modified=False)


def preview(comment) -> str:
	return plain_text(comment.content, limit=280)
