"""Web Push for the installed Workspace (client revision 5).

Pushes carry no payload: they only wake the service worker, which then reads the person's newest
unread notifications from the server with their own session (`masar.api.notifications.latest`). So no
notification text passes through the browser vendors' push services, no payload encryption is needed,
and a stale push never shows something the person may no longer see. Only the VAPID signature
(RFC 8292, ES256) is required; `cryptography` already ships with Frappe.

The VAPID key pair is created once per site and kept in site_config.json, the way Frappe keeps its own
encryption key.
"""

import base64
import hashlib
import json
import time
from urllib.parse import urlsplit

import frappe
import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from frappe import _
from frappe.utils import now_datetime

from masar.permissions import require_masar_user
from masar.utils.context import masar_service

PRIVATE_KEY_CONF = "masar_vapid_private_key"
MAX_SUBSCRIPTIONS_PER_USER = 10
TTL_SECONDS = 24 * 60 * 60
# Push services are third parties: an endpoint must be HTTPS on one of the browser vendors' services.
ALLOWED_PUSH_HOSTS = (
	"fcm.googleapis.com",
	"updates.push.services.mozilla.com",
	".push.apple.com",
	".notify.windows.com",
	"push.services.mozilla.com",
)


def _b64url(data: bytes) -> str:
	return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _private_key() -> ec.EllipticCurvePrivateKey:
	pem = frappe.conf.get(PRIVATE_KEY_CONF)
	if not pem:
		from frappe.installer import update_site_config

		key = ec.generate_private_key(ec.SECP256R1())
		pem = key.private_bytes(
			serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
		).decode()
		update_site_config(PRIVATE_KEY_CONF, pem)
		frappe.local.conf[PRIVATE_KEY_CONF] = pem
	return serialization.load_pem_private_key(pem.encode(), password=None)


def public_key() -> str:
	"""The application server key browsers subscribe with (uncompressed P-256 point, base64url)."""
	point = (
		_private_key()
		.public_key()
		.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
	)
	return _b64url(point)


def _vapid_header(endpoint: str) -> str:
	parts = urlsplit(endpoint)
	claims = {
		"aud": f"{parts.scheme}://{parts.netloc}",
		"exp": int(time.time()) + 12 * 60 * 60,
		"sub": f"mailto:{frappe.get_hooks('app_email')[0]}",
	}
	signing_input = (
		f"{_b64url(json.dumps({'typ': 'JWT', 'alg': 'ES256'}).encode())}."
		f"{_b64url(json.dumps(claims, separators=(',', ':')).encode())}"
	)
	r, s = decode_dss_signature(_private_key().sign(signing_input.encode(), ec.ECDSA(hashes.SHA256())))
	token = f"{signing_input}.{_b64url(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
	return f"vapid t={token}, k={public_key()}"


def _valid_endpoint(endpoint: str) -> bool:
	parts = urlsplit(endpoint or "")
	host = parts.hostname or ""
	return parts.scheme == "https" and any(
		host == allowed.lstrip(".") or (allowed.startswith(".") and host.endswith(allowed))
		for allowed in ALLOWED_PUSH_HOSTS
	)


# --------------------------------------------------------------------------- subscriptions


def subscribe(endpoint: str, user_agent: str | None = None) -> dict:
	"""Register this browser for the session user. An endpoint belongs to one browser profile, so a
	browser re-subscribing after someone else signed in there moves to the new person."""
	require_masar_user()
	if not _valid_endpoint(endpoint) or len(endpoint) > 1024:
		frappe.throw(_("This push subscription is not supported."))
	digest = hashlib.sha256(endpoint.encode()).hexdigest()
	user = frappe.session.user
	with masar_service():
		existing = frappe.db.get_value("Masar Push Subscription", {"endpoint_hash": digest}, "name")
		if existing:
			frappe.db.set_value("Masar Push Subscription", existing, "user", user)
		else:
			frappe.get_doc(
				{
					"doctype": "Masar Push Subscription",
					"user": user,
					"endpoint": endpoint,
					"user_agent": (user_agent or "")[:280] or None,
				}
			).insert(ignore_permissions=True)
		# Keep the newest few devices per person.
		names = frappe.get_all(
			"Masar Push Subscription", filters={"user": user}, order_by="creation desc", pluck="name"
		)
		for name in names[MAX_SUBSCRIPTIONS_PER_USER:]:
			frappe.delete_doc("Masar Push Subscription", name, ignore_permissions=True)
	return {"subscribed": True}


def unsubscribe(endpoint: str) -> dict:
	require_masar_user()
	digest = hashlib.sha256((endpoint or "").encode()).hexdigest()
	with masar_service():
		frappe.db.delete("Masar Push Subscription", {"endpoint_hash": digest, "user": frappe.session.user})
	return {"subscribed": False}


# --------------------------------------------------------------------------- delivery


def push_to_users(users: list[str]):
	"""Background job (enqueued after the notifications committed): wake every device of these people.
	Endpoints the push service reports as gone (404/410) are removed."""
	rows = frappe.get_all(  # job context: recipients were decided by the notification service
		"Masar Push Subscription",
		filters={"user": ["in", list(set(users))]},
		fields=["name", "endpoint"],
	)
	for row in rows:
		try:
			response = requests.post(
				row.endpoint,
				headers={
					"Authorization": _vapid_header(row.endpoint),
					"TTL": str(TTL_SECONDS),
					"Urgency": "normal",
					"Content-Length": "0",
				},
				timeout=10,
			)
		except requests.RequestException:
			continue  # transient: the notification is still in the list and in the e-mail
		with masar_service():
			if response.status_code in (404, 410):
				frappe.delete_doc("Masar Push Subscription", row.name, ignore_permissions=True)
			elif response.ok:
				frappe.db.set_value(
					"Masar Push Subscription", row.name, "last_sent_at", now_datetime(), update_modified=False
				)
