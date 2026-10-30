import frappe

from masar.services.personal import timer_service
from masar.utils.context import masar_write


@frappe.whitelist(methods=["GET"])
def active():
	"""The session user's running or paused timer, or null."""
	return timer_service.active()


@frappe.whitelist(methods=["POST"])
@masar_write
def start(task: str):
	return timer_service.start(task)


@frappe.whitelist(methods=["POST"])
@masar_write
def pause(timer: str):
	return timer_service.pause(timer)


@frappe.whitelist(methods=["POST"])
@masar_write
def resume(timer: str):
	return timer_service.resume(timer)


@frappe.whitelist(methods=["POST"])
@masar_write
def stop(timer: str, minutes=None, description: str | None = None):
	return timer_service.stop(timer, minutes, description)


@frappe.whitelist(methods=["POST"])
@masar_write
def discard(timer: str):
	return timer_service.discard(timer)
