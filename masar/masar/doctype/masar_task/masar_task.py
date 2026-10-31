import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, now_datetime, nowdate

from masar.permissions import get_space_role
from masar.services.activity import record_activity
from masar.services.personal.my_day_service import add_to_my_day, due_task_people, is_due_today
from masar.services.personal.my_day_service import clear_task as clear_my_day

TITLE_MAX_LENGTH = 240
# Task statuses (client revision 2). People set every status except Overdue, which Masar sets once
# the due date has passed. Completed, Closed and Cancelled are finished: `is_completed` follows them.
STATUSES = (
	"Open",
	"Working",
	"Pending Review",
	"Changes Required",
	"Overdue",
	"Closed",
	"Completed",
	"Cancelled",
)
FINISHED_STATUSES = ("Closed", "Completed", "Cancelled")
MANUAL_STATUSES = tuple(s for s in STATUSES if s != "Overdue")
# Descriptions are Markdown, never HTML. Anything that looks like a tag, comment or declaration is
# removed until nothing changes (so nested tricks such as "<scr<b>ipt>" cannot reassemble), a tag
# opener left over is escaped, and link targets other than http(s), mailto or relative paths are
# neutralised. "a < b" and "> quote" stay as written. The editor renders only its own schema as well.
HTML_TAG = re.compile(r"<[A-Za-z/!?][^<>]*>")
TAG_OPENER = re.compile(r"<(?=[A-Za-z/!?])")
LINK_TARGET = re.compile(r"\]\(\s*<?([^()\s>]*(?:\([^()]*\))?[^()\s>]*)")
SAFE_TARGET = re.compile(r"^(https?:|mailto:|/|#|$)", re.IGNORECASE)
# Fields whose changes are written to the Task history.
TRACKED_FIELDS = (
	"feature",
	"target_release",
	"title",
	"description",
	"status",
	"priority",
	"due_date",
	"is_important",
)


def effective_estimate(doc) -> int | None:
	"""Remaining estimate in minutes, or None when nobody gave one (ADR-062)."""
	return int(doc.get("remaining_minutes") or 0) if doc.get("has_remaining_estimate") else None


def is_due_overdue(due_date, today=None) -> bool:
	return bool(due_date) and getdate(due_date) < (today or getdate(nowdate()))


def clean_markdown(value: str | None) -> str | None:
	value = value or ""
	while True:
		stripped = HTML_TAG.sub("", value)
		if stripped == value:
			break
		value = stripped
	value = TAG_OPENER.sub(r"\\<", value)
	value = LINK_TARGET.sub(
		lambda m: m.group(0) if SAFE_TARGET.match(m.group(1)) else m.group(0).replace(m.group(1), "#", 1), value
	)
	return value.strip() or None


def set_estimate(doc, minutes: int | None):
	doc.has_remaining_estimate = 0 if minutes is None else 1
	doc.remaining_minutes = 0 if minutes is None else int(minutes)


class MasarTask(Document):
	def before_insert(self):
		# Keeps the (owner, client_request_id) unique index meaningful for server-created tasks.
		if not self.client_request_id:
			self.client_request_id = f"server:{frappe.generate_hash(length=20)}"

	def validate(self):
		self._validate_title()
		self._validate_assignees()
		self._validate_labels()
		self._validate_planning_links()
		self._resolve_task_owner()
		self._apply_status()
		self._apply_completion_audit()
		self.description = clean_markdown(self.description)
		if self.has_remaining_estimate and (self.remaining_minutes or 0) < 0:
			frappe.throw(_("Remaining time cannot be negative."))

	def _validate_title(self):
		self.title = " ".join((self.title or "").split())
		if not self.title:
			frappe.throw(_("A task needs a title."))
		if len(self.title) > TITLE_MAX_LENGTH:
			frappe.throw(_("Task titles are limited to {0} characters.").format(TITLE_MAX_LENGTH))

	def _validate_assignees(self):
		seen = set()
		for row in self.assignees:
			if row.user in seen:
				frappe.throw(_("{0} is already assigned.").format(row.user))
			seen.add(row.user)
			if get_space_role(self.space, row.user) is None:
				frappe.throw(_("{0} is not a member of this Space.").format(row.user))
			if not row.assigned_at:
				row.assigned_at = now_datetime()
				row.assigned_by = frappe.session.user

	def _validate_labels(self):
		"""Labels are shared within one Space; a Task may only carry labels of its own Space."""
		seen = set()
		unique_rows = []
		for row in self.labels:
			if row.label in seen:
				continue
			seen.add(row.label)
			unique_rows.append(row)
			if frappe.db.get_value("Masar Label", row.label, "space") != self.space:
				frappe.throw(_("This label belongs to another Space."))
		self.set("labels", unique_rows)

	def _validate_planning_links(self):
		"""Feature and Release must belong to the Task's Space (ADR-034). Links to an Archived
		Release are frozen: they are kept as history and can neither be created nor changed (ADR-036)."""
		if self.feature and frappe.db.get_value("Masar Feature", self.feature, "space") != self.space:
			frappe.throw(_("This Feature belongs to another Space."))
		before = self.get_doc_before_save()
		previous = before.target_release if before else None
		if (self.target_release or None) == (previous or None):
			return
		if self.target_release:
			space, status = frappe.db.get_value(
				"Masar Release", self.target_release, ["space", "status"]
			) or (
				None,
				None,
			)
			if space != self.space:
				frappe.throw(_("This Release belongs to another Space."))
			if status == "Archived":
				frappe.throw(_("Tasks cannot be added to an archived Release."))
		if previous and frappe.db.get_value("Masar Release", previous, "status") == "Archived":
			frappe.throw(_("This task belongs to an archived Release. Reopen the Release to change it."))

	def _resolve_task_owner(self):
		"""Owner rule I-TASK-2 (owner decision of 2026-10-31): the creator owns a new Task by default,
		and Masar never changes the owner on its own (not when assignees change, not when a member
		leaves the Space). People change it deliberately with set_owner."""
		if not self.task_owner and self.is_new():
			self.task_owner = self.owner or frappe.session.user

	def _apply_status(self):
		"""`status` is the source of truth. Older callers that only flip `is_completed` (set_completed,
		bulk set_completed) are mapped to Completed or Open. Overdue is applied once per due date: a
		person may change the status afterwards, and moving the due date ahead clears Overdue."""
		before = self.get_doc_before_save()
		self.status = self.status or "Open"
		if self.status not in STATUSES:
			frappe.throw(_("Unknown status."))
		status_changed = before is not None and before.status != self.status
		if before is not None and not status_changed and bool(before.is_completed) != bool(self.is_completed):
			if self.is_completed:
				self.status = "Completed"
			elif self.status in FINISHED_STATUSES:
				self.status = "Open"
		if self.status == "Overdue" and not is_due_overdue(self.due_date):
			self.status = "Open"
		if (
			self.status not in FINISHED_STATUSES
			and self.status != "Overdue"
			and is_due_overdue(self.due_date)
			and str(self.overdue_for or "") != str(getdate(self.due_date))
			and not (status_changed and before.status == "Overdue")
		):
			self.status = "Overdue"
		if self.status == "Overdue":
			self.overdue_for = getdate(self.due_date)
		self.is_completed = 1 if self.status in FINISHED_STATUSES else 0

	def _apply_completion_audit(self):
		before = self.get_doc_before_save()
		was_completed = bool(before.is_completed) if before else False
		if self.is_completed and not was_completed:
			self.completed_at = now_datetime()
			self.completed_by = frappe.session.user
		elif not self.is_completed:
			self.completed_at = None
			self.completed_by = None
		elif before:
			# Audit fields are server-maintained.
			self.completed_at = before.completed_at
			self.completed_by = before.completed_by

	def after_insert(self):
		record_activity(self, "created", {"title": self.title})

	def on_update(self):
		before = self.get_doc_before_save()
		self._join_my_day(before)
		if not before:
			return
		if self.is_completed and not before.is_completed:
			# A finished Task leaves every person's My Day (client revision 4).
			clear_my_day(self.name)
		for field in TRACKED_FIELDS:
			old, new = before.get(field), self.get(field)
			if (old or None) != (new or None):
				data = {"field": field}
				if field != "description":
					data.update({"from": old, "to": new})
				record_activity(self, "field_changed", data)
		old_estimate, new_estimate = effective_estimate(before), effective_estimate(self)
		if old_estimate != new_estimate:
			record_activity(
				self,
				"field_changed",
				{"field": "remaining_minutes", "from": old_estimate, "to": new_estimate},
			)
		old_assignees = {row.user for row in before.assignees}
		new_assignees = {row.user for row in self.assignees}
		for user in sorted(new_assignees - old_assignees):
			record_activity(self, "assigned", {"user": user})
		for user in sorted(old_assignees - new_assignees):
			record_activity(self, "unassigned", {"user": user})
		if (before.task_owner or None) != (self.task_owner or None):
			record_activity(self, "owner_changed", {"from": before.task_owner, "to": self.task_owner})
		old_labels = {row.label for row in before.labels}
		new_labels = {row.label for row in self.labels}
		for label in sorted(new_labels - old_labels):
			record_activity(self, "label_added", {"label": label})
		for label in sorted(old_labels - new_labels):
			record_activity(self, "label_removed", {"label": label})

	def _join_my_day(self, before):
		"""A Task that is, or becomes, due today joins the My Day of its people (my_day_service): all of
		them when it is new, newly due today or reopened; otherwise only people assigned just now."""
		if not is_due_today(self):
			return
		assignees = [row.user for row in self.assignees]
		if not before or str(before.due_date or "") != str(self.due_date) or before.is_completed:
			people = due_task_people(self, assignees)
		else:
			people = set(assignees) - {row.user for row in before.assignees}
		add_to_my_day(self, people)

	def on_trash(self):
		cascade_task_deletion([self.name])


def cascade_task_deletion(task_names: list[str]) -> None:
	"""Remove everything that belongs to these Tasks; the Task rows themselves are the caller's.
	Shared by deleting one Task (on_trash) and deleting a whole Space (space_service.delete_space)."""
	if not task_names:
		return
	in_tasks = ["in", task_names]
	action = frappe.qb.DocType("Masar Task Action")
	task = frappe.qb.DocType("Masar Task")
	# Own Actions and history go with the Task. Lineage pointing at it is cleared (a promoted Action
	# becomes promotable again; promoted Tasks keep existing).
	frappe.db.delete("Masar Task Action", {"task": in_tasks})
	frappe.qb.update(action).set(action.promoted_task, None).where(
		action.promoted_task.isin(task_names)
	).run()
	frappe.qb.update(task).set(task.source_task, None).where(task.source_task.isin(task_names)).run()
	frappe.db.delete("Masar Activity", {"reference_doctype": "Masar Task", "reference_name": in_tasks})
	frappe.db.delete("Masar My Day", {"task": in_tasks})
	# Collaboration records go with the Task (ADR-051, ADR-054): comments, reactions, delivery records
	# and private files. Files are removed through Frappe so their bytes are deleted too.
	for attachment_file in frappe.get_all("Masar Attachment", filters={"task": in_tasks}, pluck="file"):
		if attachment_file and frappe.db.exists("File", attachment_file):
			frappe.delete_doc("File", attachment_file, ignore_permissions=True, force=True)
	# Time logs go with the Task (client decision 2026-10-31), including the timer sessions that
	# produced them: a stopped session keeps a required link to its Task, which used to make Frappe
	# refuse the delete.
	for doctype in (
		"Masar Attachment",
		"Masar Comment Reaction",
		"Masar Comment Notification",
		"Masar Notification",
		"Masar Comment",
		"Masar Timer Session",
		"Masar Time Entry",
	):
		frappe.db.delete(doctype, {"task": in_tasks})
	# Child rows of the Tasks: Frappe deletes them with one Task, not when Task rows are bulk-deleted.
	for child in ("Masar Task Assignee", "Masar Task Label"):
		frappe.db.delete(child, {"parent": in_tasks, "parenttype": "Masar Task"})
	_detach_batch_items(task_names)


def _detach_batch_items(task_names: list[str]) -> None:
	"""Batch participation (ADR-044): planning rows of a Planned Batch go; any other row is history and
	stays (task cleared, open participation becomes Removed) so finished results never change."""
	item = frappe.qb.DocType("Masar Batch Item")
	batch = frappe.qb.DocType("Masar Batch")
	planned = frappe.qb.from_(batch).select(batch.name).where(batch.status == "Planned")
	frappe.qb.from_(item).delete().where(
		item.task.isin(task_names) & item.batch.isin(planned) & item.carried_from.isnull()
	).run()
	frappe.qb.update(item).set(item.outcome, "Removed").set(item.removed_at, now_datetime()).set(
		item.removed_by, frappe.session.user
	).where(item.task.isin(task_names) & item.current_task.isnotnull()).run()
	frappe.qb.update(item).set(item.task, None).set(item.current_task, None).where(
		item.task.isin(task_names)
	).run()


def on_doctype_update():
	frappe.db.add_unique(
		"Masar Task", ["owner", "client_request_id"], constraint_name="unique_owner_client_request"
	)
	frappe.db.add_index("Masar Task", ["space", "is_completed", "modified"])
	frappe.db.add_index("Masar Task", ["space", "sort_order"])
	frappe.db.add_index("Masar Task", ["feature", "is_completed"])
	frappe.db.add_index("Masar Task", ["target_release", "is_completed"])
