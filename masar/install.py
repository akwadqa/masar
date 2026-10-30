import frappe

# Masar roles never grant Frappe Desk access: users holding only these roles become
# "Website User" (Frappe derives user_type from Role.desk_access) and /desk rejects them.
# Company administrators receive Desk through standard Frappe roles such as System Manager.
#   Masar User    - can use the Masar Workspace; content access is decided by Space membership
#   Masar Planner - can edit, start and finish any Batch
#   Masar Admin   - Masar application administrator: creates Spaces and manages membership
MASAR_ROLES = ("Masar User", "Masar Planner", "Masar Admin")


def after_install():
	ensure_roles()
	ensure_desktop_icon()


def after_migrate():
	ensure_roles()
	ensure_desktop_icon()


# Site-wide settings (System Settings, Website Settings, the login page) belong to the site and its other
# apps: Masar never changes them (client revision 4). Until revision 3, password-reset link expiry was
# filled in here; on a site where it is empty, administrators set it in System Settings.


def ensure_desktop_icon():
	"""Masar in Frappe Desk (client revision 4). On a site whose desktop is the Apps screen (the v16
	default), Desk lists Masar straight from `add_to_apps_screen` in hooks.py. A site that switched its
	desktop to the Desktop Icon grid reads `Desktop Icon` rows instead, which Frappe seeds only when an
	app is installed; this adds Masar's own App icon there if it is missing. Other apps' icons and the
	user's arrangement are never touched."""
	from frappe.desk.doctype.desktop_settings.desktop_settings import is_desktop_icons_page

	if not is_desktop_icons_page():
		return
	if frappe.db.exists("Desktop Icon", {"icon_type": "App", "app": "masar"}) or frappe.db.exists(
		"Desktop Icon", "Masar"
	):
		return
	entry = frappe.get_hooks("add_to_apps_screen", app_name="masar")[0]
	icon = frappe.new_doc("Desktop Icon")
	icon.update(
		{
			"label": "Masar",
			"icon_type": "App",
			"app": "masar",
			"link_type": "External",
			"link": entry["route"],
			"logo_url": entry["logo"],
		}
	)
	icon.insert(ignore_permissions=True)


def ensure_roles():
	"""Idempotent: create missing roles and re-assert desk_access = 0 on every migrate."""
	for role_name in MASAR_ROLES:
		if frappe.db.exists("Role", role_name):
			if frappe.db.get_value("Role", role_name, "desk_access"):
				role = frappe.get_doc("Role", role_name)
				role.desk_access = 0
				role.save(ignore_permissions=True)
			continue
		frappe.get_doc({"doctype": "Role", "role_name": role_name, "desk_access": 0}).insert(
			ignore_permissions=True
		)
