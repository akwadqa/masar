import frappe
from frappe.utils import sbool

from masar.api.tasks import _filters
from masar.services import batch_service
from masar.utils.context import masar_write


@frappe.whitelist(methods=["GET"])
def list(status: str | None = None, q: str | None = None, space: str | None = None, manageable=False):
	return batch_service.list_batches(status or None, q or None, space or None, sbool(manageable))


@frappe.whitelist(methods=["GET"])
def get(batch: str):
	return batch_service.get_batch(batch)


@frappe.whitelist(methods=["GET"])
def tasks(batch: str, sort: str = "manual", **kwargs):
	filters = _filters(kwargs)
	filters.pop("batch", None)
	return batch_service.batch_tasks(batch, sort=sort, **filters)


@frappe.whitelist(methods=["GET"])
def history(batch: str):
	return batch_service.batch_history(batch)


@frappe.whitelist(methods=["GET"])
def owner_candidates(batch: str):
	return batch_service.owner_candidates(batch)


@frappe.whitelist(methods=["GET"])
def finish_preview(batch: str):
	return batch_service.finish_preview(batch)


@frappe.whitelist(methods=["POST"])
@masar_write
def create(
	batch_name: str,
	start_date: str,
	end_date: str | None = None,
	preset: str | None = None,
	client_request_id: str | None = None,
):
	return batch_service.create_batch(
		batch_name, start_date, end_date or None, preset or None, client_request_id
	)


@frappe.whitelist(methods=["POST"])
@masar_write
def update(batch: str, changes, base=None):
	return batch_service.update_batch(
		batch, frappe.parse_json(changes), frappe.parse_json(base) if base else None
	)


@frappe.whitelist(methods=["POST"])
@masar_write
def delete(batch: str):
	return batch_service.delete_batch(batch)


@frappe.whitelist(methods=["POST"])
@masar_write
def transfer_ownership(batch: str, new_owner: str, expected_owner: str | None = None):
	return batch_service.transfer_ownership(batch, new_owner, expected_owner or None)


@frappe.whitelist(methods=["POST"])
@masar_write
def move_tasks(tasks, batch: str | None = None, expected=None):
	return batch_service.move_tasks(
		frappe.parse_json(tasks), batch or None, frappe.parse_json(expected) if expected else None
	)


@frappe.whitelist(methods=["POST"])
@masar_write
def start(batch: str, request_id: str | None = None):
	return batch_service.start_batch(batch, request_id or None)


@frappe.whitelist(methods=["POST"])
@masar_write
def finish(batch: str, carry: str, destination: str | None = None, request_id: str | None = None):
	return batch_service.finish_batch(batch, carry, destination or None, request_id)
