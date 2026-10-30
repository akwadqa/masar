"""Extension of Frappe's File document (via the `extend_doctype_class` hook; Frappe core untouched).

Frappe serves /private/files through `File.is_downloadable()`, which calls the File module's own
permission function directly — app `has_permission` hooks are not consulted there — and that function
always lets a file's uploader download it. For files of Masar Tasks this would let a removed member keep
downloading what they uploaded, so downloads additionally require current Space membership (ADR-054).
"""

from masar.permissions import file_has_permission


class MasarFileMixin:
	def is_downloadable(self):
		if self.get("attached_to_doctype") == "Masar Task" and not file_has_permission(self, "read"):
			return False
		return super().is_downloadable()
