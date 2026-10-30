"""Installable Workspace (client revision 5): the service worker at /masar/sw.js.

A service worker controls only pages below its own path, so it cannot be served from
/assets/masar/frontend/ like the other Workspace files. `website_route_rules` sends every /masar/...
path to the Workspace page; this renderer (hooks.page_renderer, consulted first) answers the one
path that is the worker. The worker handles push notifications only and keeps no offline cache.
"""

import os

import frappe
from frappe.website.page_renderers.base_renderer import BaseRenderer
from werkzeug.wrappers import Response

PATH = "/masar/sw.js"


class ServiceWorkerPage(BaseRenderer):
	def can_render(self):
		request = getattr(frappe.local, "request", None)
		return bool(request) and request.path == PATH

	def render(self):
		with open(os.path.join(frappe.get_app_path("masar", "public", "frontend"), "sw.js"), "rb") as handle:
			body = handle.read()
		response = Response(body, mimetype="text/javascript")
		# Browsers re-check the worker on navigation; never let a cache serve an old one.
		response.headers["Cache-Control"] = "no-cache"
		return response
