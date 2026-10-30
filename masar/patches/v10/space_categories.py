"""Client revision 5: Space categories become a list. Every category already typed on a Space
becomes an entry of that list; Spaces keep their values unchanged."""

import frappe


def execute():
	frappe.reload_doc("masar", "doctype", "masar_space_category")
	existing = {name.lower() for name in frappe.get_all("Masar Space Category", pluck="name")}
	for value in frappe.get_all(
		"Masar Space", filters={"category": ["is", "set"]}, pluck="category", distinct=True
	):
		name = " ".join((value or "").split())
		if name and name.lower() not in existing:
			frappe.get_doc({"doctype": "Masar Space Category", "category_name": name}).insert(
				ignore_permissions=True
			)
			existing.add(name.lower())
