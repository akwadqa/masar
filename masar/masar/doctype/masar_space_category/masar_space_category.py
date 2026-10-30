from frappe.model.document import Document


class MasarSpaceCategory(Document):
	"""One entry of the shared Space category list (client revision 5). Written by space_service."""

	def validate(self):
		self.category_name = " ".join((self.category_name or "").split())
