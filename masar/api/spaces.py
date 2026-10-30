import frappe

from masar.services import space_service
from masar.utils.context import masar_write


@frappe.whitelist(methods=["GET"])
def list(scope: str = "mine"):
	return space_service.list_for_user(scope)


@frappe.whitelist(methods=["GET"])
def get(space: str):
	return space_service.get_detail(space)


@frappe.whitelist(methods=["GET"])
def members(space: str):
	return space_service.members(space)


@frappe.whitelist(methods=["GET"])
def categories():
	"""Masar user. The shared Space category list (client revision 5)."""
	return space_service.categories()


@frappe.whitelist(methods=["GET"])
def user_candidates(query: str = "", space: str | None = None):
	return space_service.user_candidates(query, space or None)


@frappe.whitelist(methods=["GET"])
def removal_impact(space: str, user: str):
	return space_service.removal_impact(space, user)


@frappe.whitelist(methods=["POST"])
@masar_write
def create(data):
	return space_service.create(frappe.parse_json(data))


@frappe.whitelist(methods=["POST"])
@masar_write
def update(space: str, changes, base=None):
	return space_service.update_details(
		space, frappe.parse_json(changes), frappe.parse_json(base) if base else None
	)


@frappe.whitelist(methods=["POST"])
@masar_write
def set_status(space: str, status: str, expected_status: str | None = None):
	return space_service.set_status(space, status, expected_status)


@frappe.whitelist(methods=["POST"])
@masar_write
def add_member(space: str, user: str, role: str = "Member"):
	return space_service.add_member(space, user, role)


@frappe.whitelist(methods=["POST"])
@masar_write
def change_role(space: str, user: str, role: str):
	return space_service.change_role(space, user, role)


@frappe.whitelist(methods=["POST"])
@masar_write
def remove_member(space: str, user: str):
	return space_service.remove_member(space, user)


@frappe.whitelist(methods=["POST"])
@masar_write
def transfer_ownership(space: str, new_owner: str, expected_owner: str | None = None):
	return space_service.transfer_ownership(space, new_owner, expected_owner)
