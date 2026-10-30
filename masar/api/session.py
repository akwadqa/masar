import frappe
from frappe.sessions import get_csrf_token
from frappe.utils import now_datetime

from masar.permissions import is_masar_user, is_space_admin
from masar.services import space_service
from masar.services.personal import preference_service
from masar.utils.context import masar_write
from masar.services.serializers import iso_datetime

MASAR_ROLES = ("Masar User", "Masar Planner", "Masar Admin")


def check_app_permission() -> bool:
	"""Apps screen (hooks.add_to_apps_screen): Masar is shown to people who may use it."""
	return frappe.session.user != "Guest" and is_masar_user()


@frappe.whitelist(allow_guest=True, methods=["GET"])
def boot():
	"""Session bootstrap for the Workspace. Also generates the session CSRF token, which makes
	Frappe enforce CSRF for every later write of this session (Phase 0 finding R-25).
	Guests receive only {"authenticated": false}."""
	user = frappe.session.user
	if user == "Guest":
		return {"authenticated": False}

	csrf_token = get_csrf_token()
	user_doc = frappe.get_cached_doc("User", user)
	roles = set(frappe.get_roles(user))
	masar_user = is_masar_user(user)
	return {
		"authenticated": True,
		"user": user,
		"fullName": user_doc.full_name or user,
		"userImage": user_doc.user_image,
		"isMasarUser": masar_user,
		"roles": [role for role in MASAR_ROLES if role in roles],
		# Desk access is decided by Frappe (System User type); the Workspace only links to it.
		"hasDeskAccess": user_doc.user_type == "System User",
		"canCreateSpaces": masar_user and is_space_admin(user),
		"spaces": space_service.list_for_user() if masar_user else [],
		"preferences": preference_service.get_preferences() if masar_user else None,
		"csrfToken": csrf_token,
		"timezone": frappe.utils.get_system_timezone(),
		"serverTime": iso_datetime(now_datetime()),
	}


@frappe.whitelist(methods=["POST"])
@masar_write
def set_preferences(
	theme: str | None = None,
	appearance: str | None = None,
	pinned_spaces=None,
	full_width=None,
	email_notifications=None,
):
	"""Save the session user's own Workspace preferences (theme, appearance, full width, pinned Spaces,
	e-mail notifications)."""
	return preference_service.set_preferences(
		theme, appearance, pinned_spaces, full_width, email_notifications
	)


@frappe.whitelist(allow_guest=True, methods=["GET"])
def version():
	"""Deployment identity and API contract (ADR-059): the commit this backend image was built from
	(written into the image by deploy-backend.sh) and the names of all Masar API methods. Release
	tooling checks that every method the Workspace release calls exists before activating it.
	Exposes no data, only code identity."""
	import json
	import os

	info_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "build_info.json")
	commit = None
	if os.path.exists(info_path):
		with open(info_path) as handle:
			commit = json.load(handle).get("commit")
	# Whitelisting happens at import time and workers import API modules lazily: import them all first.
	import importlib
	import pkgutil

	import masar.api

	for module in pkgutil.iter_modules(masar.api.__path__):
		importlib.import_module(f"masar.api.{module.name}")
	methods = sorted(
		f"{fn.__module__}.{fn.__name__}"
		for fn in frappe.whitelisted
		if getattr(fn, "__module__", "").startswith("masar.api.")
	)
	return {"commit": commit, "apiMethods": methods}
