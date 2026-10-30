import frappe
from frappe.utils import sbool

from masar.services import time_service
from masar.utils.context import masar_write


@frappe.whitelist(methods=["GET"])
def summary(task: str):
	return time_service.summary(task)


@frappe.whitelist(methods=["GET"])
def get(entry: str):
	return time_service.get_entry(entry)


@frappe.whitelist(methods=["POST"])
@masar_write
def log(
	task: str,
	duration,
	client_request_id: str,
	work_date: str | None = None,
	description: str | None = None,
	remaining=None,
	set_remaining=False,
	base_remaining=None,
):
	return time_service.log_time(
		task,
		duration,
		client_request_id,
		work_date or None,
		description,
		remaining,
		sbool(set_remaining),
		base_remaining,
	)


@frappe.whitelist(methods=["POST"])
@masar_write
def update(entry: str, changes, base_modified: str | None = None):
	return time_service.update_entry(entry, frappe.parse_json(changes), base_modified or None)


@frappe.whitelist(methods=["POST"])
@masar_write
def void(entry: str, reason: str | None = None):
	return time_service.void_entry(entry, reason)
