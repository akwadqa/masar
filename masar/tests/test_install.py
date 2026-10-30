import frappe
from frappe.tests import IntegrationTestCase

from masar.install import MASAR_ROLES, ensure_roles


class TestInstall(IntegrationTestCase):
	def test_ensure_roles_is_idempotent_and_reasserts_no_desk_access(self):
		ensure_roles()
		frappe.db.set_value("Role", "Masar User", "desk_access", 1)
		ensure_roles()  # second run on existing roles must not fail (regression: migrate crash)
		for role in MASAR_ROLES:
			self.assertEqual(frappe.db.get_value("Role", role, "desk_access"), 0, role)
