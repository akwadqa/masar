"""Space workflows (Phase 2). Writes run inside `masar_service()` after explicit authorization;
membership changes lock the Space row so concurrent edits are serialised and validated together."""

import frappe
from frappe import _
from frappe.query_builder.functions import Count
from frappe.utils import getdate

from masar.exceptions import MasarConflictError
from masar.permissions import (
	MANAGER,
	MEMBER,
	SPACE_STATUSES,
	STATUS_TRANSITIONS,
	clear_membership_cache,
	get_user_spaces,
	is_space_admin,
	require_masar_user,
	require_space_access,
	require_space_manage,
	require_space_view,
	space_capabilities,
)
from masar.services.activity import record_activity
from masar.services.serializers import iso_date, user_refs
from masar.utils.context import masar_service

MASAR_ROLES = ("Masar User", "Masar Admin")
ROLES = (MANAGER, MEMBER)
SPACE_TYPES = ("Internal", "External")
# Space identity (client revision): a curated Lucide icon and one of the theme's icon colours.
SPACE_ICONS = (
	"folder-kanban", "globe", "shopping-bag", "store", "landmark", "smartphone", "truck", "headset",
	"briefcase", "building-2", "server", "code", "database", "rocket", "layout-dashboard", "file-text",
	"users", "shield-check", "package", "wrench", "chart-column", "graduation-cap", "heart-pulse", "plane",
)
SPACE_ICON_COLORS = ("blue", "violet", "teal", "green", "amber", "rose", "sky", "slate")

# API field -> DocType field for editable Space details.
DETAIL_FIELDS = {
	"title": "title",
	"category": "category",
	"details": "details",
	"completionDate": "completion_date",
	"spaceType": "space_type",
	"gameplanUrl": "gameplan_url",
	"icon": "icon",
	"iconColor": "icon_color",
}


# --------------------------------------------------------------------------- reads


def _summaries(names: list[str]) -> list[dict]:
	if not names:
		return []
	space = frappe.qb.DocType("Masar Space")
	rows = (
		frappe.qb.from_(space)
		.select(
			space.name,
			space.title,
			space.category,
			space.status,
			space.space_type,
			space.space_owner,
			space.completion_date,
			space.icon,
			space.icon_color,
		)
		.where(space.name.isin(names))
		.orderby(space.title)
		.run(as_dict=True)
	)
	task = frappe.qb.DocType("Masar Task")
	open_counts = dict(
		frappe.qb.from_(task)
		.select(task.space, Count(task.name))
		.where(task.space.isin(names) & (task.is_completed == 0))
		.groupby(task.space)
		.run()
	)
	member = frappe.qb.DocType("Masar Space Member")
	member_counts = dict(
		frappe.qb.from_(member)
		.select(member.parent, Count(member.name))
		.where(member.parent.isin(names) & (member.parenttype == "Masar Space"))
		.groupby(member.parent)
		.run()
	)
	refs = user_refs([row.space_owner for row in rows])
	mine = get_user_spaces()
	user = frappe.session.user
	return [
		{
			"name": row.name,
			"title": row.title,
			"category": row.category,
			"status": row.status,
			"spaceType": row.space_type,
			"completionDate": iso_date(row.completion_date),
			"icon": row.icon or None,
			"iconColor": row.icon_color or None,
			"owner": refs[row.space_owner],
			"isOwner": row.space_owner == user,
			"role": mine.get(row.name),
			"memberCount": member_counts.get(row.name, 0),
			# Task counts are content: only shown for Spaces the user belongs to.
			"openTaskCount": open_counts.get(row.name, 0) if row.name in mine else None,
		}
		for row in rows
	]


def list_for_user(scope: str = "mine") -> list[dict]:
	"""`mine`: Spaces the user is a member of. `all`: every Space (administrators only)."""
	require_masar_user()
	if scope == "all":
		if not is_space_admin():
			frappe.throw(_("Only Masar administrators can list all Spaces."), frappe.PermissionError)
		return _summaries(frappe.get_all("Masar Space", pluck="name"))  # admin-only, authorised above
	return _summaries(list(get_user_spaces()))


def get_detail(space_name: str) -> dict:
	role = require_space_view(space_name)
	doc = frappe.get_doc("Masar Space", space_name)
	refs = user_refs([doc.space_owner, *[m.user for m in doc.members]])
	members = sorted(
		(
			{**refs[m.user], "role": m.role, "addedAt": str(m.added_at) if m.added_at else None}
			for m in doc.members
		),
		key=lambda m: (m["role"] != MANAGER, m["fullName"].lower()),
	)
	return {
		"name": doc.name,
		"title": doc.title,
		"category": doc.category,
		"status": doc.status,
		"spaceType": doc.space_type,
		"completionDate": iso_date(doc.completion_date),
		"details": doc.details,
		"gameplanUrl": doc.gameplan_url,
		"icon": doc.icon or None,
		"iconColor": doc.icon_color or None,
		"owner": refs[doc.space_owner],
		"members": members,
		"myRole": role,
		"modified": str(doc.modified),
		"permissions": space_capabilities(doc.name, doc.space_owner, doc.status),
	}


def members(space_name: str) -> list[dict]:
	require_space_access(space_name)
	member = frappe.qb.DocType("Masar Space Member")
	rows = (
		frappe.qb.from_(member)
		.select(member.user, member.role)
		.where((member.parent == space_name) & (member.parenttype == "Masar Space"))
		.run()
	)
	refs = user_refs([user for user, _ in rows])
	return sorted(({**refs[user], "role": role} for user, role in rows), key=lambda r: r["fullName"].lower())


def user_candidates(query: str = "", space: str | None = None, limit: int = 20) -> list[dict]:
	"""Active Masar users for owner/member pickers. Requires the right to manage the Space (or to
	create Spaces). User records are not readable by Website Users through Frappe's generic APIs,
	so this lookup runs after explicit authorization and returns only name, full name and image."""
	if space:
		require_space_manage(space)
	else:
		require_masar_user()
		if not is_space_admin():
			frappe.throw(_("Only Masar administrators can create Spaces."), frappe.PermissionError)
	user = frappe.qb.DocType("User")
	has_role = frappe.qb.DocType("Has Role")
	query_builder = (
		frappe.qb.from_(user)
		.join(has_role)
		.on((has_role.parent == user.name) & (has_role.parenttype == "User"))
		.select(user.name, user.full_name, user.user_image)
		.distinct()
		.where((user.enabled == 1) & has_role.role.isin(MASAR_ROLES))
		.where(user.name.notin(["Administrator", "Guest"]))
	)
	term = (query or "").strip()
	if term:
		like = f"%{term}%"
		query_builder = query_builder.where(user.full_name.like(like) | user.name.like(like))
	if space:
		existing = frappe.get_all("Masar Space Member", filters={"parent": space}, pluck="user")
		if existing:
			query_builder = query_builder.where(user.name.notin(existing))
	rows = query_builder.orderby(user.full_name).limit(max(1, min(int(limit or 20), 50))).run()
	return [{"name": name, "fullName": full_name or name, "image": image} for name, full_name, image in rows]


# --------------------------------------------------------------------------- helpers


def _require_masar_account(user: str):
	if not user or not frappe.db.get_value("User", user, "enabled"):
		frappe.throw(_("Choose an active user."))
	if not set(MASAR_ROLES).intersection(frappe.get_roles(user)):
		frappe.throw(_("{0} does not have access to Masar Workspace.").format(user))


def _locked_space(space_name: str):
	return frappe.get_doc("Masar Space", space_name, for_update=True)


def _save(doc):
	with masar_service():
		doc.save()
	clear_membership_cache()


def _normalise_detail(field: str, value):
	if field == "completion_date":
		return str(getdate(value)) if value else None
	if field == "title":
		return " ".join((value or "").split()) or None
	if isinstance(value, str):
		return value.strip() or None
	return value or None


def categories() -> list[str]:
	"""The shared Space category list (client revision 5), for every Masar user."""
	require_masar_user()
	return frappe.get_all("Masar Space Category", order_by="category_name asc", pluck="name")  # shared list


def _category(value) -> str | None:
	"""A category chosen on a Space: an existing entry (whatever its case), or a new entry added to the
	list. Called only after the caller was authorised to edit the Space."""
	name = " ".join((value or "").split())[:140]
	if not name:
		return None
	existing = frappe.db.get_value("Masar Space Category", {"category_name": name}, "name")
	if existing:
		return existing
	with masar_service():
		return frappe.get_doc({"doctype": "Masar Space Category", "category_name": name}).insert(
			ignore_permissions=True
		).name


def _validate_choice(value, allowed, label):
	if value not in allowed:
		frappe.throw(_("Invalid {0}.").format(_(label)))


# --------------------------------------------------------------------------- writes


def create(data: dict) -> dict:
	"""Company-level Masar administrators create Spaces and choose the owner, who becomes the
	first Manager. The creator is not added implicitly (no access is granted as a side effect)."""
	require_masar_user()
	if not is_space_admin():
		frappe.throw(_("Only Masar administrators can create Spaces."), frappe.PermissionError)
	data = data or {}
	owner = data.get("owner")
	_require_masar_account(owner)
	space_type = data.get("spaceType") or "Internal"
	_validate_choice(space_type, SPACE_TYPES, "type")
	doc = frappe.get_doc(
		{
			"doctype": "Masar Space",
			"title": data.get("title"),
			"category": _category(data.get("category")),
			"details": data.get("details") or None,
			"completion_date": data.get("completionDate") or None,
			"space_type": space_type,
			"gameplan_url": (data.get("gameplanUrl") or "").strip() or None,
			"status": "In Progress",
			"space_owner": owner,
			"members": [{"user": owner, "role": MANAGER}],
		}
	)
	with masar_service():
		doc.insert()
	clear_membership_cache()
	record_activity(doc, "space_created", {"owner": owner}, space=doc.name)
	return get_detail(doc.name)


def update_details(space_name: str, changes: dict, base: dict | None = None) -> dict:
	"""Field-scoped optimistic concurrency, as for Tasks (ADR-018)."""
	require_space_manage(space_name)
	if not isinstance(changes, dict) or not changes:
		frappe.throw(_("Nothing to update."))
	unknown = set(changes) - set(DETAIL_FIELDS)
	if unknown:
		frappe.throw(_("These fields cannot be edited here: {0}").format(", ".join(sorted(unknown))))
	base = base or {}
	doc = _locked_space(space_name)
	conflicts = []
	changed = []
	for api_field, value in changes.items():
		field = DETAIL_FIELDS[api_field]
		if api_field == "spaceType":
			_validate_choice(value, SPACE_TYPES, "type")
		if api_field == "icon" and value:
			_validate_choice(value, SPACE_ICONS, "icon")
		if api_field == "iconColor" and value:
			_validate_choice(value, SPACE_ICON_COLORS, "icon colour")
		current = _normalise_detail(field, doc.get(field))
		if api_field in base and current != _normalise_detail(field, base[api_field]):
			conflicts.append({"field": api_field, "current": current, "yours": value})
			continue
		new_value = _normalise_detail(field, value) if field != "details" else (value or None)
		if field == "category":
			new_value = _category(new_value)
		if current != _normalise_detail(field, new_value):
			changed.append(api_field)
		doc.set(field, new_value)
	if conflicts:
		frappe.local.response["conflicts"] = conflicts
		frappe.throw(
			_("This Space was changed by someone else. Review the latest values."), MasarConflictError
		)
	if changed:
		_save(doc)
		record_activity(doc, "details_changed", {"fields": changed}, space=doc.name)
	return get_detail(space_name)


def set_status(space_name: str, status: str, expected_status: str | None = None) -> dict:
	require_space_manage(space_name)
	_validate_choice(status, SPACE_STATUSES, "status")
	doc = _locked_space(space_name)
	if expected_status and doc.status != expected_status:
		frappe.local.response["conflicts"] = [{"field": "status", "current": doc.status, "yours": status}]
		frappe.throw(_("The Space status was changed by someone else."), MasarConflictError)
	if status == doc.status:
		return get_detail(space_name)
	if status not in STATUS_TRANSITIONS[doc.status]:
		frappe.throw(_("A Space cannot move from {0} to {1}.").format(_(doc.status), _(status)))
	previous = doc.status
	doc.status = status
	_save(doc)
	record_activity(doc, "status_changed", {"from": previous, "to": status}, space=doc.name)
	return get_detail(space_name)


def add_member(space_name: str, user: str, role: str = MEMBER) -> dict:
	require_space_manage(space_name)
	_validate_choice(role, ROLES, "role")
	_require_masar_account(user)
	doc = _locked_space(space_name)
	if any(m.user == user for m in doc.members):
		frappe.throw(_("{0} is already a member of this Space.").format(user))
	doc.append("members", {"user": user, "role": role})
	_save(doc)
	record_activity(doc, "member_added", {"user": user, "role": role}, space=doc.name)
	return get_detail(space_name)


def change_role(space_name: str, user: str, role: str) -> dict:
	require_space_manage(space_name)
	_validate_choice(role, ROLES, "role")
	doc = _locked_space(space_name)
	row = next((m for m in doc.members if m.user == user), None)
	if not row:
		frappe.throw(_("{0} is not a member of this Space.").format(user))
	if user == doc.space_owner and role != MANAGER:
		frappe.throw(_("The Space owner must stay a Manager. Transfer ownership first."))
	if row.role != role:
		previous = row.role
		row.role = role
		_save(doc)
		record_activity(doc, "role_changed", {"user": user, "from": previous, "to": role}, space=doc.name)
	return get_detail(space_name)


def _assigned_tasks(space_name: str, user: str) -> list[dict]:
	task = frappe.qb.DocType("Masar Task")
	assignee = frappe.qb.DocType("Masar Task Assignee")
	return (
		frappe.qb.from_(task)
		.join(assignee)
		.on((assignee.parent == task.name) & (assignee.parenttype == "Masar Task"))
		.select(task.name, task.title, task.is_completed, task.task_owner)
		.where((task.space == space_name) & (assignee.user == user))
		.run(as_dict=True)
	)


def removal_impact(space_name: str, user: str) -> dict:
	"""What removing `user` changes, shown to the Manager before confirmation (ADR-021)."""
	require_space_manage(space_name)
	tasks = _assigned_tasks(space_name, user)
	names = [t.name for t in tasks]
	counts = {}
	if names:
		assignee = frappe.qb.DocType("Masar Task Assignee")
		counts = dict(
			frappe.qb.from_(assignee)
			.select(assignee.parent, Count(assignee.name))
			.where(assignee.parent.isin(names) & (assignee.parenttype == "Masar Task"))
			.groupby(assignee.parent)
			.run()
		)
	return {
		"assignedTasks": len(tasks),
		"openAssignedTasks": sum(1 for t in tasks if not t.is_completed),
		# Every Task of the Space the user owns, assigned or not; ownership stays with them (I-TASK-2).
		"ownedTasks": frappe.db.count("Masar Task", {"space": space_name, "task_owner": user}),
		"ownershipMoves": 0,  # the owner never changes on removal (I-TASK-2); kept for API compatibility
		"tasksLeftUnassigned": sum(1 for t in tasks if counts.get(t.name, 0) == 1),
		"isOwner": frappe.db.get_value("Masar Space", space_name, "space_owner") == user,
	}


def remove_member(space_name: str, user: str) -> dict:
	"""Transactional removal (ADR-021): the user is unassigned from every Task of the Space and
	access ends with this request. Task ownership does not change (I-TASK-2). Authored records
	(tasks created, history) stay attributed to the user."""
	require_space_manage(space_name)
	doc = _locked_space(space_name)
	row = next((m for m in doc.members if m.user == user), None)
	if not row:
		frappe.throw(_("{0} is not a member of this Space.").format(user))
	if user == doc.space_owner:
		frappe.throw(_("The Space owner cannot be removed. Transfer ownership first."))

	updated = 0
	with masar_service():
		for task_row in _assigned_tasks(space_name, user):
			task = frappe.get_doc("Masar Task", task_row.name, for_update=True)
			task.set("assignees", [a for a in task.assignees if a.user != user])
			task.save()  # owner invariant I-TASK-2 re-resolves the owner; history records "unassigned"
			updated += 1
		doc.set("members", [m for m in doc.members if m.user != user])
		doc.save()
	clear_membership_cache()
	record_activity(doc, "member_removed", {"user": user, "tasksUpdated": updated}, space=doc.name)
	result = get_detail(space_name) if (user != frappe.session.user or is_space_admin()) else None
	return {"space": result, "tasksUpdated": updated}


def transfer_ownership(space_name: str, new_owner: str, expected_owner: str | None = None) -> dict:
	"""Dedicated operation: the new owner must already be a member and becomes a Manager; the
	previous owner stays a Manager. `expected_owner` detects a concurrent transfer."""
	role = require_space_view(space_name)  # 404 for non-members who are not administrators
	doc = _locked_space(space_name)
	if not (is_space_admin() or (doc.space_owner == frappe.session.user and role == MANAGER)):
		frappe.throw(
			_("Only the Space owner or a Masar administrator can transfer ownership."), frappe.PermissionError
		)
	if expected_owner and doc.space_owner != expected_owner:
		frappe.local.response["conflicts"] = [
			{"field": "owner", "current": doc.space_owner, "yours": new_owner}
		]
		frappe.throw(_("Ownership was changed by someone else."), MasarConflictError)
	if new_owner == doc.space_owner:
		return get_detail(space_name)
	row = next((m for m in doc.members if m.user == new_owner), None)
	if not row:
		frappe.throw(_("The new owner must be a member of the Space."))
	_require_masar_account(new_owner)
	previous = doc.space_owner
	row.role = MANAGER
	doc.space_owner = new_owner
	_save(doc)
	record_activity(doc, "ownership_transferred", {"from": previous, "to": new_owner}, space=doc.name)
	return get_detail(space_name)
