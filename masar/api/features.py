import frappe
from frappe.utils import sbool

from masar.services import planning_service
from masar.utils.context import masar_write


@frappe.whitelist(methods=["GET"])
def list(space: str):
	return planning_service.list_features(space)


@frappe.whitelist(methods=["GET"])
def list_mine(spaces=None):
	return planning_service.list_my_features(frappe.parse_json(spaces) if spaces else None)


@frappe.whitelist(methods=["GET"])
def get(feature: str):
	return planning_service.get_feature(feature)


@frappe.whitelist(methods=["POST"])
@masar_write
def create(
	space: str,
	title: str,
	roadmap: str = "Later",
	description: str | None = None,
	client_request_id: str | None = None,
):
	return planning_service.create_feature(space, title, roadmap, description, client_request_id or None)


@frappe.whitelist(methods=["POST"])
@masar_write
def update(feature: str, changes, base=None):
	return planning_service.update_feature(
		feature, frappe.parse_json(changes), frappe.parse_json(base) if base else None
	)


@frappe.whitelist(methods=["POST"])
@masar_write
def move(
	feature: str,
	roadmap: str,
	before: str | None = None,
	after: str | None = None,
	expected_roadmap: str | None = None,
):
	return planning_service.move_feature(
		feature, roadmap, before or None, after or None, expected_roadmap or None
	)


@frappe.whitelist(methods=["POST"])
@masar_write
def delete(feature: str, detach=False):
	return planning_service.delete_feature(feature, sbool(detach))
