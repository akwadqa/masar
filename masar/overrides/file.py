"""Extension of Frappe's File document (via the `extend_doctype_class` hook; Frappe core untouched).

Frappe serves /private/files through `File.is_downloadable()`, which calls the File module's own
permission function directly — app `has_permission` hooks are not consulted there — and that function
always lets a file's uploader download it. For files of Masar Tasks this would let a removed member keep
downloading what they uploaded, so downloads of Task and Space files additionally require current Space membership (ADR-054).
"""

from masar.permissions import MASAR_FILE_PARENTS, file_has_permission


class MasarFileMixin:
	def is_downloadable(self):
		if self.get("attached_to_doctype") in MASAR_FILE_PARENTS and not file_has_permission(self, "read"):
			return False
		return super().is_downloadable()
