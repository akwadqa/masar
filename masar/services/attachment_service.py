"""Private Task attachments (ADR-054, ADR-055).

Storage is Frappe's File (always `is_private`, attached to the Masar Task); `Masar Attachment` records
the Task, optional Comment, size and detected type. Downloads go through Frappe's /private/files handler,
which consults `masar.permissions.file_has_permission`, so access follows current Space membership.
"""

import os
import re
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

from masar.permissions import (
	get_space_role,
	not_found,
	require_masar_user,
	require_task_access,
	require_task_write,
)
from masar.services.activity import record_activity
from masar.services.comment_service import attachment_row
from masar.utils.context import masar_service

DEFAULT_MAX_MB = 10
ABANDONED_AFTER = timedelta(hours=24)

# Detected type → (allowed extensions, content type, is_image). The type is decided from the file's
# own bytes; the browser's MIME type and the filename are never trusted on their own.
SIGNATURES = (
	(b"\x89PNG\r\n\x1a\n", ("png",), "image/png", True),
	(b"\xff\xd8\xff", ("jpg", "jpeg"), "image/jpeg", True),
	(b"GIF87a", ("gif",), "image/gif", True),
	(b"GIF89a", ("gif",), "image/gif", True),
	(b"%PDF-", ("pdf",), "application/pdf", False),
	(
		b"PK\x03\x04",
		("docx", "xlsx", "pptx", "zip", "odt", "ods", "odp"),
		"application/zip",
		False,
	),
)
TEXT_EXTENSIONS = ("txt", "csv", "md", "log", "json")
OFFICE_TYPES = {
	"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"odt": "application/vnd.oasis.opendocument.text",
	"ods": "application/vnd.oasis.opendocument.spreadsheet",
	"odp": "application/vnd.oasis.opendocument.presentation",
}


def max_bytes() -> int:
	return cint(frappe.conf.get("masar_attachment_max_mb") or DEFAULT_MAX_MB) * 1024 * 1024


def safe_name(name: str) -> str:
	"""Base name only, no path separators or control characters, bounded length."""
	name = os.path.basename((name or "").replace("\\", "/")).strip()
	name = re.sub(r"[\x00-\x1f/\\%?#<>:\"|*]", "_", name)
	name = re.sub(r"\s+", " ", name).lstrip(".") or "file"
	stem, ext = os.path.splitext(name)
	return f"{stem[:120]}{ext[:12].lower()}"


def detect(content: bytes, file_name: str) -> tuple[str, bool]:
	"""Return (content_type, is_image) or raise when the bytes do not match an allowed type."""
	ext = os.path.splitext(file_name)[1].lstrip(".").lower()
	if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
		if ext == "webp":
			return "image/webp", True
	for magic, extensions, content_type, is_image in SIGNATURES:
		if content.startswith(magic):
			if ext in extensions:
				return OFFICE_TYPES.get(ext, content_type), is_image
			break
	if ext in TEXT_EXTENSIONS and b"\x00" not in content:
		try:
			content.decode("utf-8")
			return ("text/csv" if ext == "csv" else "text/plain"), False
		except UnicodeDecodeError:
			pass
	frappe.throw(
		_(
			"This file type is not supported. Use images (PNG, JPEG, GIF, WebP), PDF, Office documents, ZIP or plain text, and make sure the extension matches the file."
		)
	)


def upload(task_name: str, purpose: str = "Task") -> dict:
	"""Multipart upload (field `file`). Task files are attached at once; composer files stay pending
	until a comment references them (cleaned up after 24 h otherwise)."""
	if purpose not in ("Task", "Comment"):
		frappe.throw(_("Unknown attachment purpose."))
	task = require_task_access(task_name)
	require_task_write(task.space, get_space_role(task.space))
	request = getattr(frappe.local, "request", None)
	stream = request.files.get("file") if request is not None else None
	if not stream:
		frappe.throw(_("Choose a file to upload."))
	limit = max_bytes()
	if request.content_length and request.content_length > limit + 64 * 1024:
		frappe.throw(_("Files are limited to {0} MB.").format(limit // (1024 * 1024)))
	content = stream.stream.read(limit + 1)
	if len(content) > limit:
		frappe.throw(_("Files are limited to {0} MB.").format(limit // (1024 * 1024)))
	if not content:
		frappe.throw(_("The file is empty."))
	return store(task, safe_name(stream.filename), content, purpose)


def store(task, file_name: str, content: bytes, purpose: str) -> dict:
	content_type, is_image = detect(content, file_name)
	with masar_service():
		file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": file_name,
				"content": content,
				"is_private": 1,
				"attached_to_doctype": "Masar Task",
				"attached_to_name": task.name,
				"folder": "Home/Attachments",
			}
		)
		file.flags.ignore_permissions = True  # Task write access was checked above
		file.insert()
		doc = frappe.get_doc(
			{
				"doctype": "Masar Attachment",
				"task": task.name,
				"space": task.space,
				"purpose": purpose,
				"file": file.name,
				"file_url": file.file_url,
				"file_name": file_name,
				"file_size": len(content),
				"content_type": content_type,
				"is_image": 1 if is_image else 0,
			}
		)
		doc.insert()
		if purpose == "Task":
			record_activity(task, "attachment_added", {"fileName": file_name}, space=task.space)
	return attachment_row(doc)


def list_attachments(task_name: str) -> list[dict]:
	"""Task files and files of live comments (pending composer uploads are private to the uploader)."""
	task = require_task_access(task_name)
	att = frappe.qb.DocType("Masar Attachment")
	rows = (
		frappe.qb.from_(att)
		.select(
			att.name,
			att.file_name,
			att.file_url,
			att.file_size,
			att.is_image,
			att.content_type,
			att.comment,
			att.owner,
			att.creation,
		)
		.where((att.task == task.name) & ((att.purpose == "Task") | att.comment.isnotnull()))
		.orderby(att.creation)
		.run(as_dict=True)
	)
	from masar.permissions import MANAGER, can_write_tasks, get_space_status
	from masar.services.serializers import iso_datetime, user_refs

	role = get_space_role(task.space)
	writable = can_write_tasks(get_space_status(task.space), role)
	refs = user_refs([r.owner for r in rows])
	return [
		{
			**attachment_row(r),
			"comment": r.comment,
			"uploadedBy": refs.get(r.owner),
			"uploadedAt": iso_datetime(r.creation),
			"canDelete": writable and not r.comment and (r.owner == frappe.session.user or role == MANAGER),
		}
		for r in rows
	]


def delete(attachment_name: str) -> dict:
	"""Remove a Task file: its uploader or a Space Manager. Comment files go with their comment."""
	from masar.permissions import MANAGER

	require_masar_user()
	row = frappe.db.get_value(
		"Masar Attachment", attachment_name, ["task", "space", "owner", "comment", "file_name"], as_dict=True
	)
	if not row or get_space_role(row.space) is None:
		not_found("Attachment")
	role = get_space_role(row.space)
	require_task_write(row.space, role)
	if row.comment:
		frappe.throw(_("This file belongs to a comment. Delete the comment to remove it."))
	if row.owner != frappe.session.user and role != MANAGER:
		frappe.throw(_("Only the uploader or a Space Manager can remove this file."), frappe.PermissionError)
	with masar_service():
		remove_files([attachment_name])
		record_activity(
			frappe._dict(doctype="Masar Task", name=row.task, space=row.space),
			"attachment_removed",
			{"fileName": row.file_name},
			space=row.space,
		)
	return {"name": attachment_name, "deleted": True}


def remove_files(attachment_names: list[str]):
	"""Delete attachments and their File records (Frappe removes the bytes once no File refers to them).
	Callers have authorised the change."""
	for name in attachment_names:
		file = frappe.db.get_value("Masar Attachment", name, "file")
		frappe.db.delete("Masar Attachment", {"name": name})
		if file and frappe.db.exists("File", file):
			frappe.delete_doc("File", file, ignore_permissions=True, force=True)


def cleanup_abandoned_uploads(commit: bool = True):
	"""Scheduled daily: composer uploads never attached to a comment within 24 h are removed."""
	cutoff = now_datetime() - ABANDONED_AFTER
	names = frappe.get_all(
		"Masar Attachment",
		filters={"purpose": "Comment", "comment": ["is", "not set"], "creation": ["<", cutoff]},
		pluck="name",
	)
	with masar_service():
		remove_files(names)
	if commit:  # the scheduler commits; callers inside a transaction (tests) do not
		frappe.db.commit()
	return len(names)
