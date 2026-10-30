import hashlib

import frappe
from frappe.model.document import Document


class MasarPushSubscription(Document):
	"""Written only by push_service. The endpoint is a capability URL of the push service; it is
	unique (one row per browser), so re-subscribing moves it to the signed-in person."""

	def validate(self):
		self.endpoint_hash = hashlib.sha256((self.endpoint or "").encode()).hexdigest()


def on_doctype_update():
	frappe.db.add_index("Masar Push Subscription", ["user"])
