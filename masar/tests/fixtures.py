"""Deterministic test world (docs/08-testing-quality.md §2).

Spaces A and B. Users:
  a_manager  Manager of A          a_member  Member of A
  b_member   Manager of B          ab_member Member of A and B
  outsider   Masar User, no Space  admin     Masar Admin, no Space
"""

import frappe

from masar.permissions import clear_membership_cache

DOMAIN = "masar-test.invalid"
USERS = {
	"a_manager": ["Masar User"],
	"a_member": ["Masar User"],
	"b_member": ["Masar User"],
	"ab_member": ["Masar User"],
	"outsider": ["Masar User"],
	"admin": ["Masar User", "Masar Admin"],
	"no_role": [],
	"desk_admin": ["System Manager"],
}


def email(key: str) -> str:
	return f"{key}@{DOMAIN}"


def ensure_user(key: str, roles: list[str]) -> str:
	name = email(key)
	if not frappe.db.exists("User", name):
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": name,
				"first_name": key.replace("_", " ").title(),
				"send_welcome_email": 0,
				"roles": [{"role": r} for r in roles],
			}
		)
		user.insert(ignore_permissions=True)
	return name


def make_space(title: str, managers: list[str], members: list[str]) -> str:
	doc = frappe.get_doc(
		{
			"doctype": "Masar Space",
			"title": title,
			"space_owner": email(managers[0]),
			"status": "In Progress",
			"space_type": "Internal",
			"department": "ERP",
			"members": [{"user": email(u), "role": "Manager"} for u in managers]
			+ [{"user": email(u), "role": "Member"} for u in members],
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def build_world() -> dict:
	frappe.set_user("Administrator")
	for key, roles in USERS.items():
		ensure_user(key, roles)
	world = {
		"A": make_space("Space A", ["a_manager"], ["a_member", "ab_member"]),
		"B": make_space("Space B", ["b_member"], ["ab_member"]),
	}
	clear_membership_cache()
	return world


def as_user(key: str):
	clear_membership_cache()
	frappe.set_user(email(key) if key != "Administrator" else key)


def unassigned_task(space: str, title: str, client_request_id: str) -> str:
	"""A new Task: owned by its creator, with no assignee (nobody is assigned automatically)."""
	from masar.services import task_service

	return task_service.create(space, title, client_request_id)["task"]["name"]
