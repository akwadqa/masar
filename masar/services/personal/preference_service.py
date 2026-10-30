"""Per-user Workspace preferences (client revision): design theme, light/dark appearance, full-width
pages and pinned Spaces. Stored as Frappe user defaults, so every account keeps its own choice on any device.

Reads go to the stored rows, not to Frappe's defaults cache (QA-D05). Frappe clears that cache while
the saving transaction is still open; a request running at the same moment (the Workspace boot, a
second tab, another worker) then reads the old row and caches it again, and nothing clears it after
the commit, so the old value came back. A read of the rows always returns the committed value, and
in the saving request its own new value."""

import json

import frappe
from frappe import _
from frappe.cache_manager import clear_defaults_cache
from frappe.query_builder import DocType

from masar.permissions import get_user_spaces, require_masar_user

THEMES = ("ink", "violet", "teal")
APPEARANCES = ("light", "dark", "system")
DEFAULT_THEME = "violet"
DEFAULT_APPEARANCE = "light"
MAX_PINNED = 12
KEYS = {
	"theme": "masar_theme",
	"appearance": "masar_appearance",
	"fullWidth": "masar_full_width",
	"pinnedSpaces": "masar_pinned_spaces",
	# Read by inbox_service.emails_enabled (client revision 5).
	"emailNotifications": "masar_email_notifications",
}


def stored_values(user: str) -> dict:
	"""The stored preference values of `user` (None where nothing is stored), in one query. Should a
	key have more than one row, the newest wins."""
	table = DocType("DefaultValue")
	rows = (
		frappe.qb.from_(table)
		.select(table.defkey, table.defvalue)
		.where((table.parent == user) & table.defkey.isin(list(KEYS.values())))
		.orderby(table.creation)
		.run(as_dict=True)
	)
	by_column = {row.defkey: row.defvalue for row in rows}
	return {key: by_column.get(column) for key, column in KEYS.items()}


def get_preferences() -> dict:
	"""Pinned Spaces are always intersected with current memberships: access removal hides them."""
	stored = stored_values(frappe.session.user)
	authorised = set(get_user_spaces())
	pinned = [name for name in _parse_list(stored["pinnedSpaces"]) if name in authorised]
	return {
		# Defaults (client revision 3): Violet Workspace, Light, full-width pages. A person's own
		# stored choice always wins.
		"theme": stored["theme"] if stored["theme"] in THEMES else DEFAULT_THEME,
		"appearance": stored["appearance"] if stored["appearance"] in APPEARANCES else DEFAULT_APPEARANCE,
		"fullWidth": stored["fullWidth"] != "0",
		"pinnedSpaces": pinned,
		"emailNotifications": stored["emailNotifications"] != "0",
	}


def set_preferences(
	theme: str | None = None,
	appearance: str | None = None,
	pinned_spaces=None,
	full_width=None,
	email_notifications=None,
) -> dict:
	require_masar_user()
	if email_notifications is not None:
		_store("emailNotifications", "1" if email_notifications in (True, 1, "1", "true") else "0")
	if full_width is not None:
		_store("fullWidth", "1" if full_width in (True, 1, "1", "true") else "0")
	if theme is not None:
		_store("theme", _choice(theme, THEMES, "theme"))
	if appearance is not None:
		_store("appearance", _choice(appearance, APPEARANCES, "appearance"))
	if pinned_spaces is not None:
		_store("pinnedSpaces", json.dumps(_valid_pins(pinned_spaces)))
	# Other readers of Frappe's defaults cache may have cached the old rows meanwhile: clear it again
	# once the new rows are committed.
	user = frappe.session.user
	frappe.db.after_commit.add(lambda: clear_defaults_cache(user))
	return get_preferences()


def _valid_pins(value) -> list[str]:
	names = _parse_list(value)
	authorised = set(get_user_spaces())
	unknown = [name for name in names if name not in authorised]
	if unknown:
		frappe.throw(_("You can only pin Spaces you belong to."), frappe.PermissionError)
	return list(dict.fromkeys(names))[:MAX_PINNED]


def _store(key: str, value: str):
	frappe.defaults.set_user_default(KEYS[key], value, frappe.session.user)


def _choice(value: str, allowed: tuple, label: str) -> str:
	if value not in allowed:
		frappe.throw(_("Unknown {0}.").format(_(label)))
	return value


def _parse_list(value) -> list[str]:
	if isinstance(value, list):
		return [str(item) for item in value]
	try:
		parsed = json.loads(value or "[]")
	except ValueError:
		return []
	return [str(item) for item in parsed] if isinstance(parsed, list) else []
