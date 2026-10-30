import frappe


class MasarConflictError(frappe.ValidationError):
	"""A field changed on the server after the client read it (field-scoped optimistic concurrency)."""

	http_status_code = 409


class MasarBusyError(frappe.ValidationError):
	"""A transient database condition (lock wait timeout, or a write conflict that persisted through
	every retry). Nothing was saved; the client may safely repeat the request (ADR-042)."""

	http_status_code = 503


class MasarRequestReuseError(frappe.ValidationError):
	"""An idempotency key was reused for a different operation or resource (ADR-042)."""

	http_status_code = 422
