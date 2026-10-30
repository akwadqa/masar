"""The Masar Workspace at /masar (client revision 4). The page itself is the static Workspace build
(www/masar.html, written by frontend/scripts/install-into-app.mjs); signed-out visitors go to Frappe's
own login page and come back here afterwards."""

from urllib.parse import quote

import frappe

no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		request = getattr(frappe, "request", None)
		path = request.full_path.rstrip("?") if request else "/masar"
		frappe.local.flags.redirect_location = f"/login?redirect-to={quote(path, safe='/')}"
		raise frappe.Redirect
	context.no_cache = 1
	return context
