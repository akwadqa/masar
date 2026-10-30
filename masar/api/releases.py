import frappe
from frappe.utils import sbool

from masar.services import planning_service
from masar.utils.context import masar_write


@frappe.whitelist(methods=["GET"])
def list(space: str, status: str | None = None, q: str | None = None):
	return planning_service.list_releases(space, status or None, q or None)


@frappe.whitelist(methods=["GET"])
def list_mine(spaces=None):
	return planning_service.list_my_releases(frappe.parse_json(spaces) if spaces else None)


@frappe.whitelist(methods=["GET"])
def get(release: str):
	return planning_service.get_release(release)


@frappe.whitelist(methods=["POST"])
@masar_write
def create(space: str, release_name: str, release_date: str | None = None, notes: str | None = None):
	return planning_service.create_release(space, release_name, release_date or None, notes)


@frappe.whitelist(methods=["POST"])
@masar_write
def update(release: str, changes, base=None):
	return planning_service.update_release(
		release, frappe.parse_json(changes), frappe.parse_json(base) if base else None
	)


@frappe.whitelist(methods=["POST"])
@masar_write
def set_status(release: str, status: str, expected_status: str | None = None):
	return planning_service.set_release_status(release, status, expected_status or None)


@frappe.whitelist(methods=["POST"])
@masar_write
def delete(release: str, detach=False):
	return planning_service.delete_release(release, sbool(detach))
