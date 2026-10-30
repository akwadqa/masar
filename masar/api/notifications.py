"""The notification list behind the bell, and push subscriptions (client revision 5). Every endpoint
acts on the session user's own entries only."""

import frappe
from frappe.utils import sbool

from masar.services import inbox_service, push_service
from masar.utils.context import masar_write


@frappe.whitelist(methods=["GET"])
def list(unread_only=None, before: str | None = None, limit: int = 30):  # noqa: A001
	"""Masar user. Newest first; `before` continues from `nextBefore`."""
	return inbox_service.list_notifications(sbool(unread_only), before or None, limit=limit)


@frappe.whitelist(methods=["GET"])
def unread_count():
	"""Masar user. Unread entries (the bell badge)."""
	return {"unread": inbox_service.unread_count()}


@frappe.whitelist(methods=["GET"])
def latest():
	"""Masar user. Newest unread entries of the last minutes, read by the service worker after a push."""
	return inbox_service.latest_unread()


@frappe.whitelist(methods=["POST"])
@masar_write
def mark_read(names=None, read=True, all_unread=False):
	"""Masar user. Mark own entries read or unread, or every unread entry read."""
	return inbox_service.mark_read(
		frappe.parse_json(names) if names else None, sbool(read), sbool(all_unread)
	)


@frappe.whitelist(methods=["GET"])
def push_key():
	"""Masar user. The application server key for PushManager.subscribe."""
	return {"publicKey": push_service.public_key()}


@frappe.whitelist(methods=["POST"])
@masar_write
def subscribe_push(endpoint: str, user_agent: str | None = None):
	"""Masar user. Receive push notifications on this browser or installed app."""
	return push_service.subscribe(endpoint, user_agent)


@frappe.whitelist(methods=["POST"])
@masar_write
def unsubscribe_push(endpoint: str):
	"""Masar user. Stop push notifications on this browser."""
	return push_service.unsubscribe(endpoint)
