import frappe
from frappe.utils import sbool

from masar.services import action_service
from masar.utils.context import masar_write


@frappe.whitelist(methods=["GET"])
def list(task: str):
	return action_service.list_actions(task)


@frappe.whitelist(methods=["POST"])
@masar_write
def add(task: str, title: str, client_request_id: str | None = None):
	return action_service.add(task, title, client_request_id)


@frappe.whitelist(methods=["POST"])
@masar_write
def update(action: str, title: str, base_title: str | None = None):
	return action_service.update(action, title, base_title)


@frappe.whitelist(methods=["POST"])
@masar_write
def set_done(action: str, done):
	return action_service.set_done(action, sbool(done))


@frappe.whitelist(methods=["POST"])
@masar_write
def move(action: str, before: str | None = None, after: str | None = None):
	return action_service.move(action, before or None, after or None)


@frappe.whitelist(methods=["POST"])
@masar_write
def delete(action: str):
	return action_service.delete(action)


@frappe.whitelist(methods=["POST"])
@masar_write
def promote(action: str):
	return action_service.promote(action)
