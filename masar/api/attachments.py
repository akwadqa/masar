import frappe

from masar.services import attachment_service
from masar.utils.context import masar_write


@frappe.whitelist(methods=["GET"])
def list(task: str):
	return attachment_service.list_attachments(task)


@frappe.whitelist(methods=["POST"])
@masar_write
def upload(task: str, purpose: str = "Task"):
	"""Multipart form upload (field `file`)."""
	return attachment_service.upload(task, purpose)


@frappe.whitelist(methods=["POST"])
@masar_write
def delete(attachment: str):
	return attachment_service.delete(attachment)
