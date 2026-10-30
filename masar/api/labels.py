import frappe

from masar.services import label_service
from masar.utils.context import masar_write


@frappe.whitelist(methods=["GET"])
def list(space: str):
	return label_service.list_labels(space)


@frappe.whitelist(methods=["POST"])
@masar_write
def create(space: str, title: str, color: str = "neutral"):
	return label_service.create(space, title, color)


@frappe.whitelist(methods=["POST"])
@masar_write
def update(label: str, title: str | None = None, color: str | None = None):
	return label_service.update(label, title, color)


@frappe.whitelist(methods=["POST"])
@masar_write
def delete(label: str):
	return label_service.delete(label)
