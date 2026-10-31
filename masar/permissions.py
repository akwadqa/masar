"""Space-contextual authorization for Masar (docs/04-security-permissions.md).

Single source of truth for:
- membership resolution (`get_user_spaces`, `get_space_role`)
- capability checks used by services (`require_space_access`, `can_*`)
- Frappe hooks (`*_has_permission`, `*_query_conditions`)

Rules:
- A user who is not a member of a Space must not learn that its records exist: services raise
  DoesNotExistError (404). Members lacking a capability get PermissionError (403).
- Generic writes to Masar DocTypes are denied outside a Masar service context, so every write
  goes through a service that enforces capabilities and side effects.
"""

import frappe
from frappe import _

from masar.utils.context import in_masar_service

MANAGER = "Manager"
MEMBER = "Member"
READ_PTYPES = {"read", "select", "print", "email", "report", "export"}
SPACE_ADMIN_ROLES = {"System Manager", "Masar Admin"}


# --------------------------------------------------------------------------- membership


def get_user_spaces(user: str | None = None) -> dict[str, str]:
	"""Return {space: role} for the user. Cached per request."""
	user = user or frappe.session.user
	cache = getattr(frappe.local, "masar_user_spaces", None)
	if cache is None:
		cache = frappe.local.masar_user_spaces = {}
	if user not in cache:
		member = frappe.qb.DocType("Masar Space Member")
		rows = (
			frappe.qb.from_(member)
			.select(member.parent, member.role)
			.where((member.user == user) & (member.parenttype == "Masar Space"))
			.run()
		)
		cache[user] = {space: role for space, role in rows}
	return cache[user]


def clear_membership_cache():
	frappe.local.masar_user_spaces = {}
	frappe.local.masar_space_status = {}


def get_space_role(space: str, user: str | None = None) -> str | None:
	return get_user_spaces(user).get(space)


def is_space_admin(user: str | None = None) -> bool:
	user = user or frappe.session.user
	if user == "Administrator":
		return True
	return bool(SPACE_ADMIN_ROLES.intersection(frappe.get_roles(user)))


def is_masar_user(user: str | None = None) -> bool:
	user = user or frappe.session.user
	if user == "Administrator":
		return True
	roles = set(frappe.get_roles(user))
	return bool({"Masar User", "Masar Admin"}.intersection(roles))


# --------------------------------------------------------------------------- service checks


def not_found(doctype: str):
	"""Raise the response used for both missing and inaccessible records."""
	frappe.throw(_("{0} not found").format(_(doctype)), frappe.DoesNotExistError)


def require_masar_user():
	if frappe.session.user == "Guest" or not is_masar_user():
		frappe.throw(_("You do not have access to Masar."), frappe.PermissionError)


def require_space_access(space: str, min_role: str = MEMBER) -> str:
	"""Return the user's role in the Space or raise (404 for non-members, 403 for low role)."""
	require_masar_user()
	role = get_space_role(space)
	if role is None:
		not_found("Space")
	if min_role == MANAGER and role != MANAGER:
		frappe.throw(_("Only Space Managers can do this."), frappe.PermissionError)
	return role


def require_task_access(task_name: str, *, for_update: bool = False):
	"""Load a Task the user may read, or raise 404. Optionally lock the row."""
	require_masar_user()
	space = frappe.db.get_value("Masar Task", task_name, "space")
	if not space or get_space_role(space) is None:
		not_found("Task")
	return frappe.get_doc("Masar Task", task_name, for_update=for_update)


def can_delete_task(task, user: str | None = None) -> bool:
	user = user or frappe.session.user
	role = get_space_role(task.space, user)
	if not can_write_tasks(get_space_status(task.space), role):
		return False
	return role == MANAGER or (role == MEMBER and task.owner == user)


# --------------------------------------------------------------------------- Space lifecycle (ADR-026)

IN_PROGRESS = "In Progress"
COMPLETED = "Completed"
CANCELLED = "Cancelled"
CLOSED = "Closed"
SPACE_STATUSES = (IN_PROGRESS, COMPLETED, CANCELLED, CLOSED)
STATUS_TRANSITIONS = {
	IN_PROGRESS: (COMPLETED, CANCELLED, CLOSED),
	COMPLETED: (IN_PROGRESS, CLOSED),
	CANCELLED: (IN_PROGRESS, CLOSED),
	CLOSED: (IN_PROGRESS,),
}


def get_space_status(space: str) -> str | None:
	cache = getattr(frappe.local, "masar_space_status", None)
	if cache is None:
		cache = frappe.local.masar_space_status = {}
	if space not in cache:
		cache[space] = frappe.db.get_value("Masar Space", space, "status")
	return cache[space]


def can_write_tasks(status: str | None, role: str | None) -> bool:
	"""In Progress: all members. Completed/Cancelled: Managers only (wrap-up).
	Closed: archived, task content is read-only for everyone."""
	if role is None:
		return False
	if status == IN_PROGRESS:
		return True
	if status in (COMPLETED, CANCELLED):
		return role == MANAGER
	return False


def require_task_write(space: str, role: str):
	if not can_write_tasks(get_space_status(space), role):
		status = get_space_status(space)
		if status == CLOSED:
			frappe.throw(_("This Space is closed. Its tasks are read-only."), frappe.PermissionError)
		frappe.throw(
			_("This Space is {0}. Only Space Managers can change its tasks.").format(_(status)),
			frappe.PermissionError,
		)


def space_capabilities(space: str, owner: str, status: str, user: str | None = None) -> dict:
	"""Single source of the Space permission matrix (docs/04 §2) for services and the UI."""
	user = user or frappe.session.user
	role = get_space_role(space, user)
	admin = is_space_admin(user)
	can_manage = role == MANAGER or admin
	return {
		"isMember": role is not None,
		"canViewTasks": role is not None,
		"canCreateTasks": can_write_tasks(status, role),
		"canEditTasks": can_write_tasks(status, role),
		"canEditDetails": can_manage,
		"canManageMembers": can_manage,
		"canChangeStatus": can_manage,
		"canTransferOwnership": admin or (owner == user and role == MANAGER),
		# Space files are Space content (like Tasks): members read them, Managers add and remove them.
		"canViewFiles": role is not None,
		"canManageFiles": role == MANAGER,
		"allowedStatuses": list(STATUS_TRANSITIONS.get(status, ())) if can_manage else [],
	}


def require_space_manage(space: str) -> str | None:
	"""Managers of the Space and Masar/company administrators. Returns the actor's Space role.
	Non-members who are not administrators get 404 (existence is not revealed)."""
	require_masar_user()
	if not frappe.db.exists("Masar Space", space):
		not_found("Space")
	role = get_space_role(space)
	if role == MANAGER or is_space_admin():
		return role
	if role is None:
		not_found("Space")
	frappe.throw(_("Only Space Managers can do this."), frappe.PermissionError)


def require_space_view(space: str) -> str | None:
	"""Space metadata is visible to members and to administrators (who manage membership)."""
	require_masar_user()
	role = get_space_role(space)
	if role is None and not (is_space_admin() and frappe.db.exists("Masar Space", space)):
		not_found("Space")
	return role


# --------------------------------------------------------------------------- Frappe hooks


def _is_superuser(user: str) -> bool:
	return user == "Administrator"


def space_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	user = user or frappe.session.user
	if _is_superuser(user):
		return True
	if ptype == "share":
		return False
	role = get_space_role(doc.name, user) if doc.name else None
	admin = is_space_admin(user)
	if ptype in READ_PTYPES or ptype is None:
		return role is not None or admin
	if not in_masar_service():
		# Generic Frappe writes are reserved for Desk administrators; controllers still enforce
		# the membership invariants. Everyone else changes Spaces through Masar services.
		return ptype in {"write", "create", "delete"} and "System Manager" in frappe.get_roles(user)
	if ptype == "write":
		return role == MANAGER or admin
	if ptype in {"create", "delete"}:
		return admin
	return False


def task_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	user = user or frappe.session.user
	if _is_superuser(user):
		return True
	if ptype == "share":
		return False
	role = get_space_role(doc.space, user) if doc.space else None
	if role is None:
		return False
	if ptype in READ_PTYPES or ptype is None:
		return True
	if not in_masar_service():
		return False
	if ptype in {"write", "create"}:
		return True
	if ptype == "delete":
		return can_delete_task(doc, user)
	return False


def space_content_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	"""Actions and Labels: readable by Space members; written only through Masar services, which
	enforce capabilities and lifecycle rules."""
	user = user or frappe.session.user
	if _is_superuser(user):
		return True
	if ptype == "share":
		return False
	role = get_space_role(doc.space, user) if doc.get("space") else None
	if role is None:
		return False
	if ptype in READ_PTYPES or ptype is None:
		return True
	return in_masar_service() and ptype in {"write", "create", "delete"}


def activity_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	user = user or frappe.session.user
	if _is_superuser(user):
		return True
	if ptype not in READ_PTYPES and ptype is not None:
		# Activity is append-only and written by services with explicit authorization.
		return False
	return bool(doc.space) and get_space_role(doc.space, user) is not None


def _member_spaces_subquery(user: str) -> str:
	return (
		"select `tabMasar Space Member`.parent from `tabMasar Space Member` "
		f"where `tabMasar Space Member`.user = {frappe.db.escape(user)} "
		"and `tabMasar Space Member`.parenttype = 'Masar Space'"
	)


def space_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	if _is_superuser(user) or is_space_admin(user):
		return ""
	return f"`tabMasar Space`.name in ({_member_spaces_subquery(user)})"


def task_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	if _is_superuser(user):
		return ""
	return f"`tabMasar Task`.space in ({_member_spaces_subquery(user)})"


def activity_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	if _is_superuser(user):
		return ""
	return f"`tabMasar Activity`.space in ({_member_spaces_subquery(user)})"


def space_member_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	if _is_superuser(user) or is_space_admin(user):
		return ""
	return f"`tabMasar Space Member`.parent in ({_member_spaces_subquery(user)})"


def task_assignee_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	if _is_superuser(user):
		return ""
	return (
		"`tabMasar Task Assignee`.parent in (select `tabMasar Task`.name from `tabMasar Task` "
		f"where `tabMasar Task`.space in ({_member_spaces_subquery(user)}))"
	)


def task_action_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	if _is_superuser(user):
		return ""
	return f"`tabMasar Task Action`.space in ({_member_spaces_subquery(user)})"


def label_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	if _is_superuser(user):
		return ""
	return f"`tabMasar Label`.space in ({_member_spaces_subquery(user)})"


def task_label_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	if _is_superuser(user):
		return ""
	return (
		"`tabMasar Task Label`.parent in (select `tabMasar Task`.name from `tabMasar Task` "
		f"where `tabMasar Task`.space in ({_member_spaces_subquery(user)}))"
	)


def feature_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	if _is_superuser(user):
		return ""
	return f"`tabMasar Feature`.space in ({_member_spaces_subquery(user)})"


def release_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	if _is_superuser(user):
		return ""
	return f"`tabMasar Release`.space in ({_member_spaces_subquery(user)})"


def require_planning_manager(space: str) -> str:
	"""Features and Releases are defined by Space Managers (ADR-037), subject to the Space
	lifecycle: Completed/Cancelled allow Manager wrap-up, Closed is read-only."""
	role = require_space_access(space)
	if role != MANAGER:
		frappe.throw(_("Only Space Managers can manage Features and Releases."), frappe.PermissionError)
	require_task_write(space, role)
	return role


# --------------------------------------------------------------------------- Batches (ADR-043, ADR-045)


def batch_visible(batch: str, owner: str | None = None, user: str | None = None) -> bool:
	"""A Batch is visible to its owner and to members of a Space that has (or had) Tasks in it.
	Everything a partial viewer then sees is limited to their own Spaces (ADR-045)."""
	user = user or frappe.session.user
	owner = owner if owner is not None else frappe.db.get_value("Masar Batch", batch, "batch_owner")
	if owner == user:
		return True
	spaces = list(get_user_spaces(user))
	return bool(spaces) and bool(
		frappe.db.exists("Masar Batch Item", {"batch": batch, "space": ["in", spaces]})
	)


def batch_scope(batch: str) -> set[str]:
	"""Spaces of the Tasks currently in a Batch. Used only for authority checks, never returned."""
	item = frappe.qb.DocType("Masar Batch Item")
	rows = (
		frappe.qb.from_(item)
		.select(item.space)
		.distinct()
		.where((item.batch == batch) & item.current_task.isnotnull())
		.run()
	)
	return {space for (space,) in rows}


def has_full_scope(batch: str, user: str | None = None) -> bool:
	"""Manager of every Space with Tasks currently in the Batch (ADR-043)."""
	user = user or frappe.session.user
	spaces = get_user_spaces(user)
	return all(spaces.get(space) == MANAGER for space in batch_scope(batch))


def can_manage_batch(batch_doc, user: str | None = None) -> bool:
	"""Planning authority: the owner, while they are a Manager of every participating Space."""
	user = user or frappe.session.user
	return (
		batch_doc.status != "Finished"
		and batch_doc.batch_owner == user
		and is_masar_user(user)
		and has_full_scope(batch_doc.name, user)
	)


def can_create_batches(user: str | None = None) -> bool:
	return any(role == MANAGER for role in get_user_spaces(user).values())


def batch_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	user = user or frappe.session.user
	if _is_superuser(user):
		return True
	if ptype == "share":
		return False
	if ptype in READ_PTYPES or ptype is None:
		return bool(doc.name) and batch_visible(doc.name, doc.batch_owner, user)
	return in_masar_service() and ptype in {"write", "create", "delete"}


def batch_item_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	"""Participation rows are readable only by members of the row's Space."""
	user = user or frappe.session.user
	if _is_superuser(user):
		return True
	if ptype == "share":
		return False
	space = doc.get("space")
	if not space or get_space_role(space, user) is None:
		return False
	if ptype in READ_PTYPES or ptype is None:
		return True
	return in_masar_service() and ptype in {"write", "create", "delete"}


def batch_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	if _is_superuser(user):
		return ""
	return (
		f"(`tabMasar Batch`.batch_owner = {frappe.db.escape(user)} or `tabMasar Batch`.name in "
		"(select `tabMasar Batch Item`.batch from `tabMasar Batch Item` where `tabMasar Batch Item`.space in "
		f"({_member_spaces_subquery(user)})))"
	)


def batch_item_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	if _is_superuser(user):
		return ""
	return f"`tabMasar Batch Item`.space in ({_member_spaces_subquery(user)})"


# --------------------------------------------------------------------------- collaboration (ADR-051, ADR-054)


def _space_column_condition(table: str, user: str) -> str:
	return f"`tab{table}`.space in ({_member_spaces_subquery(user)})"


def comment_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	return "" if _is_superuser(user) else _space_column_condition("Masar Comment", user)


def comment_reaction_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	return "" if _is_superuser(user) else _space_column_condition("Masar Comment Reaction", user)


def attachment_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	return "" if _is_superuser(user) else _space_column_condition("Masar Attachment", user)


def space_file_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	return "" if _is_superuser(user) else _space_column_condition("Masar Space File", user)


def time_entry_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	return "" if _is_superuser(user) else _space_column_condition("Masar Time Entry", user)


def notification_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	"""Delivery records are operational data for administrators only."""
	return _is_superuser(user or frappe.session.user)


def notification_query_conditions(user=None, doctype=None) -> str:
	return "" if _is_superuser(user or frappe.session.user) else "1=0"


def timer_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	"""Timers are personal: only their owner reads them, and only timer_service writes them."""
	user = user or frappe.session.user
	if _is_superuser(user):
		return True
	return doc.worker == user and (ptype in READ_PTYPES or ptype is None or in_masar_service())


def timer_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	return "" if _is_superuser(user) else f"`tabMasar Timer Session`.`worker` = {frappe.db.escape(user)}"


def my_day_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	"""My Day is personal (client revision 4): only its person reads it, and only my_day_service writes it."""
	user = user or frappe.session.user
	if _is_superuser(user):
		return True
	return doc.user == user and (ptype in READ_PTYPES or ptype is None or in_masar_service())


def my_day_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	return "" if _is_superuser(user) else f"`tabMasar My Day`.`user` = {frappe.db.escape(user)}"


def inbox_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	"""Notifications are personal (client revision 5): only their recipient reads them, and only the
	notification services write them."""
	user = user or frappe.session.user
	if _is_superuser(user):
		return True
	return doc.recipient == user and (ptype in READ_PTYPES or ptype is None or in_masar_service())


def inbox_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	return "" if _is_superuser(user) else f"`tabMasar Notification`.`recipient` = {frappe.db.escape(user)}"


def push_subscription_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	"""Push endpoints are capability URLs: administrators only; push_service writes them."""
	return _is_superuser(user or frappe.session.user) or in_masar_service()


def push_subscription_query_conditions(user=None, doctype=None) -> str:
	return "" if _is_superuser(user or frappe.session.user) else "1=0"


MASAR_FILE_PARENTS = ("Masar Task", "Masar Space")


def _file_space(doc) -> str | None:
	if not doc.get("attached_to_name"):
		return None
	if doc.attached_to_doctype == "Masar Space":
		return doc.attached_to_name
	return frappe.db.get_value("Masar Task", doc.attached_to_name, "space")


def file_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	"""Deny-only hook (Frappe ANDs controller hooks). Files attached to a Masar Task or a Masar Space
	are readable only by current members of that Space — including the uploader, whom Frappe would
	otherwise always allow — and are changed only by Masar services. Other files are left to Frappe."""
	user = user or frappe.session.user
	if _is_superuser(user) or doc.get("attached_to_doctype") not in MASAR_FILE_PARENTS:
		return True
	space = _file_space(doc)
	if not space or get_space_role(space, user) is None:
		return False
	if ptype in READ_PTYPES or ptype is None:
		return True
	return in_masar_service()


def file_query_conditions(user=None, doctype=None) -> str:
	user = user or frappe.session.user
	if _is_superuser(user):
		return ""
	spaces = _member_spaces_subquery(user)
	return (
		"(ifnull(`tabFile`.attached_to_doctype, '') not in ('Masar Task', 'Masar Space')"
		" or (`tabFile`.attached_to_doctype = 'Masar Task' and `tabFile`.attached_to_name in "
		f"(select `tabMasar Task`.name from `tabMasar Task` where `tabMasar Task`.space in ({spaces})))"
		f" or (`tabFile`.attached_to_doctype = 'Masar Space' and `tabFile`.attached_to_name in ({spaces})))"
	)


def block_masar_document_share(doc, method=None):
	if (doc.share_doctype or "").startswith("Masar "):
		frappe.throw(_("Masar records cannot be shared. Manage access through Space membership."))
