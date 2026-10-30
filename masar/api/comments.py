import frappe
from frappe.utils import sbool

from masar.services import comment_service, timeline_service
from masar.utils.context import masar_write


@frappe.whitelist(methods=["GET"])
def timeline(task: str, view: str = "all", before=None, after=None, anchor=None, limit: int = 30):
	return timeline_service.timeline(task, view, before or None, after or None, anchor or None, limit)


@frappe.whitelist(methods=["GET"])
def get(comment: str):
	return comment_service.get_comment(comment)


@frappe.whitelist(methods=["GET"])
def mention_candidates(task: str, query: str = ""):
	return comment_service.mention_candidates(task, query)


@frappe.whitelist(methods=["POST"])
@masar_write
def create(task: str, content: str, client_request_id: str, attachments=None):
	return comment_service.create(
		task, content, client_request_id, frappe.parse_json(attachments) if attachments else None
	)


@frappe.whitelist(methods=["POST"])
@masar_write
def update(comment: str, content: str, base_modified: str | None = None):
	return comment_service.update(comment, content, base_modified or None)


@frappe.whitelist(methods=["POST"])
@masar_write
def delete(comment: str):
	return comment_service.delete(comment)


@frappe.whitelist(methods=["POST"])
@masar_write
def react(comment: str, emoji: str, active=True):
	return comment_service.react(comment, emoji, sbool(active))
