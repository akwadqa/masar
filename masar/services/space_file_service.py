"""Private Space files: BRDs, customer-provided documents and other project material.

Storage is Frappe's File (always `is_private`, attached to the Masar Space); `Masar Space File` records
the Space, size and detected type. Space members read them; Space Managers add and remove them.
Downloads go through Frappe's /private/files handler, which consults
`masar.permissions.file_has_permission`, so access follows current Space membership. Uploads are checked
like Task attachments (type detected from the file's own bytes); the size limit is Frappe's own
(System Settings → Max File Size).
"""

import frappe
from frappe import _
from frappe.core.api.file import get_max_file_size

from masar.permissions import MANAGER, not_found, require_space_access
from masar.services.activity import record_activity
from masar.services.attachment_service import detect, safe_name
from masar.services.serializers import iso_datetime, user_refs
from masar.utils.context import masar_service

FIELDS = ["name", "file_name", "file_url", "file_size", "is_image", "content_type", "owner", "creation"]


def _row(row, refs: dict, can_manage: bool) -> dict:
	return {
		"name": row.name,
		"fileName": row.file_name,
		"url": row.file_url,
		"size": row.file_size or 0,
		"isImage": bool(row.is_image),
		"contentType": row.content_type,
		"uploadedBy": refs.get(row.owner),
		"uploadedAt": iso_datetime(row.creation),
		"canDelete": can_manage,
	}


def list_files(space_name: str) -> list[dict]:
	role = require_space_access(space_name)
	rows = frappe.get_all(
		"Masar Space File", filters={"space": space_name}, fields=FIELDS, order_by="creation desc"
	)
	refs = user_refs([r.owner for r in rows])
	return [_row(r, refs, role == MANAGER) for r in rows]


def upload(space_name: str) -> dict:
	"""Multipart upload (field `file`) by a Space Manager."""
	require_space_access(space_name, MANAGER)
	request = getattr(frappe.local, "request", None)
	stream = request.files.get("file") if request is not None else None
	if not stream:
		frappe.throw(_("Choose a file to upload."))
	limit = get_max_file_size()
	if request.content_length and request.content_length > limit + 64 * 1024:
		frappe.throw(_("Files are limited to {0} MB.").format(limit // (1024 * 1024)))
	content = stream.stream.read(limit + 1)
	if len(content) > limit:
		frappe.throw(_("Files are limited to {0} MB.").format(limit // (1024 * 1024)))
	if not content:
		frappe.throw(_("The file is empty."))
	return store(space_name, safe_name(stream.filename), content)


def store(space_name: str, file_name: str, content: bytes) -> dict:
	content_type, is_image = detect(content, file_name)
	space = frappe._dict(doctype="Masar Space", name=space_name)
	with masar_service():
		file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": file_name,
				"content": content,
				"is_private": 1,
				"attached_to_doctype": "Masar Space",
				"attached_to_name": space_name,
				"folder": "Home/Attachments",
			}
		)
		file.flags.ignore_permissions = True  # Manager access was checked above
		file.insert()
		doc = frappe.get_doc(
			{
				"doctype": "Masar Space File",
				"space": space_name,
				"file": file.name,
				"file_url": file.file_url,
				"file_name": file_name,
				"file_size": len(content),
				"content_type": content_type,
				"is_image": 1 if is_image else 0,
			}
		).insert(ignore_permissions=True)
		record_activity(space, "attachment_added", {"fileName": file_name}, space=space_name)
	row = frappe.db.get_value("Masar Space File", doc.name, FIELDS, as_dict=True)
	return _row(row, user_refs([row.owner]), True)


def delete(space_file: str) -> dict:
	"""Remove a Space file (Space Managers). Frappe deletes the bytes once no File refers to them."""
	row = frappe.db.get_value("Masar Space File", space_file, ["space", "file", "file_name"], as_dict=True)
	if not row:
		not_found("File")
	require_space_access(row.space, MANAGER)
	with masar_service():
		remove_space_files([space_file])
		space = frappe._dict(doctype="Masar Space", name=row.space)
		record_activity(space, "attachment_removed", {"fileName": row.file_name}, space=row.space)
	return {"name": space_file, "deleted": True}


def remove_space_files(names: list[str]) -> None:
	"""Delete Space file records and their Frappe Files. Callers have authorised the change."""
	for name in names:
		file = frappe.db.get_value("Masar Space File", name, "file")
		frappe.db.delete("Masar Space File", {"name": name})
		if file and frappe.db.exists("File", file):
			frappe.delete_doc("File", file, ignore_permissions=True, force=True)
