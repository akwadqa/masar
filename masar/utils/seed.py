"""Verification fixtures for development and pre-production end-to-end checks.

Creates clearly labelled E2E accounts and two isolated Spaces. It refuses to run unless the
site explicitly opts in (`masar_allow_e2e_fixtures: 1` in site_config). Passwords are read from
a file path (never from arguments) so they do not appear in process lists or shell history.

Usage: bench --site <site> execute masar.utils.seed.create_e2e_fixtures --kwargs "{'password_file': '/path'}"
"""

import frappe

# Isolated browser-test identities (Phase 8A data reset). They never join demonstration Spaces;
# `remove_e2e_fixtures` deletes them together with everything they created.
E2E_USERS = {
	"qa.manager": ("E2E Manager", "Manager of E2E Alpha", ["Masar User"]),
	"qa.member": ("E2E Member", "Member of E2E Alpha", ["Masar User"]),
	"qa.outsider": ("E2E Outsider", "Member of E2E Beta only", ["Masar User"]),
	"qa.admin": (
		"E2E Admin",
		"Masar administrator (creates Spaces), no memberships",
		["Masar User", "Masar Admin"],
	),
	"qa.spare": ("E2E Spare", "No memberships; added and removed by membership tests", ["Masar User"]),
	"qa.reset": ("E2E Reset", "Used only by the password-recovery test", ["Masar User"]),
}
DOMAIN = "masar-qa.invalid"


def _email(key: str) -> str:
	return f"{key}@{DOMAIN}"


def create_e2e_fixtures(password_file: str):
	if not frappe.conf.get("masar_allow_e2e_fixtures"):
		frappe.throw("E2E fixtures are disabled for this site (set masar_allow_e2e_fixtures).")
	with open(password_file) as handle:
		password = handle.read().strip()
	if len(password) < 16:
		frappe.throw("The E2E password must have at least 16 characters.")

	from frappe.utils.password import update_password

	for key, (full_name, _, roles) in E2E_USERS.items():
		email = _email(key)
		if not frappe.db.exists("User", email):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": full_name,
					"send_welcome_email": 0,
					"roles": [{"role": role} for role in roles],
				}
			).insert(ignore_permissions=True)
		else:
			user = frappe.get_doc("User", email)
			missing = [role for role in roles if role not in {r.role for r in user.roles}]
			if missing:
				user.add_roles(*missing)
		update_password(email, password)

	spaces = {
		"E2E Alpha": ("qa.manager", ["qa.member"]),
		"E2E Beta": ("qa.outsider", []),
	}
	for title, (manager, members) in spaces.items():
		if frappe.db.exists("Masar Space", {"title": title}):
			continue
		frappe.get_doc(
			{
				"doctype": "Masar Space",
				"title": title,
				"category": "Verification",
				"details": "<p>Automated verification data. Not real work.</p>",
				"space_owner": _email(manager),
				"space_type": "Internal",
				"department": "App",
				"members": [{"user": _email(manager), "role": "Manager"}]
				+ [{"user": _email(m), "role": "Member"} for m in members],
			}
		).insert(ignore_permissions=True)
	frappe.db.commit()
	return {"users": [_email(k) for k in E2E_USERS], "spaces": list(spaces)}


def remove_e2e_fixtures(confirm: str | None = None):
	"""Delete the browser-test identities and every Space and Batch that only they hold, with all
	dependent records. Demonstration data is never in scope: a Space qualifies only when its owner
	and every member are test identities."""
	if not frappe.conf.get("masar_allow_e2e_fixtures"):
		frappe.throw("E2E fixtures are disabled for this site (set masar_allow_e2e_fixtures).")
	if confirm != frappe.local.site:
		frappe.throw(f"Pass confirm='{frappe.local.site}' to remove the E2E fixtures.")
	from masar.demo.engine import delete_scope

	users = frappe.get_all("User", filters={"name": ["like", f"%@{DOMAIN}"]}, pluck="name")
	spaces = [
		s for s in frappe.get_all("Masar Space", fields=["name", "space_owner"])
		if s.space_owner in users
		and set(frappe.get_all("Masar Space Member", filters={"parent": s.name}, pluck="user")) <= set(users)
	]
	batches = frappe.get_all("Masar Batch", filters={"batch_owner": ["in", users or ["-"]]}, pluck="name")
	result = delete_scope([s.name for s in spaces], batches)
	for user in users:
		_remove_identity(user)
	frappe.db.commit()
	return {**result, "users": len(users)}


def _remove_identity(user: str):
	"""Everything that belongs to one test identity outside the deleted Spaces, then the identity."""
	if not user.endswith(f"@{DOMAIN}"):
		frappe.throw(f"{user} is not a test identity.")
	from frappe.sessions import clear_sessions

	frappe.db.delete("Masar Space Member", {"user": user})  # memberships in Spaces kept for other reasons
	frappe.db.delete("Masar Notification", {"recipient": user})  # client revision 5
	frappe.db.delete("Masar Push Subscription", {"user": user})
	# Personal settings (Masar preferences, time zone) are user defaults; Frappe keeps them when the
	# User is deleted (QA-M01). Matched by this exact identity only.
	frappe.db.delete("DefaultValue", {"parent": user})
	clear_sessions(user=user, force=True)
	frappe.delete_doc("User", user, ignore_permissions=True, force=True, delete_permanently=True)
	frappe.db.delete("Contact", {"user": user})


def e2e_leftovers() -> dict:
	"""Read-only check after a fixture run: what the test identities still hold on this site, and
	whether fixtures are still enabled. Every count must be 0 and the flag off."""
	pattern = f"%@{DOMAIN}"
	return {
		"fixtures_enabled": bool(frappe.conf.get("masar_allow_e2e_fixtures")),
		"users": frappe.db.count("User", {"name": ["like", pattern]}),
		"spaces": frappe.db.count("Masar Space", {"space_owner": ["like", pattern]}),
		"sprints": frappe.db.count("Masar Batch", {"batch_owner": ["like", pattern]}),
		"tasks": frappe.db.count("Masar Task", {"owner": ["like", pattern]}),
		"files": frappe.db.count("File", {"owner": ["like", pattern]}),
		"notifications": frappe.db.count("Masar Notification", {"recipient": ["like", pattern]}),
		"push_subscriptions": frappe.db.count("Masar Push Subscription", {"user": ["like", pattern]}),
		"preferences": frappe.db.count("DefaultValue", {"parent": ["like", pattern]}),
	}


def configure_dev_mail_sink(host: str = "mailpit", port: int = 1025):
	"""Development only: route all outgoing email to the local Mailpit sink."""
	if not frappe.conf.get("developer_mode"):
		frappe.throw("The development mail sink can only be configured in developer mode.")
	name = "Masar Dev Mail Sink"
	values = {
		"email_id": "no-reply@masar.localhost",
		"email_account_name": name,
		"enable_outgoing": 1,
		"default_outgoing": 1,
		"enable_incoming": 0,
		"smtp_server": host,
		"smtp_port": port,
		"use_tls": 0,
		"use_ssl_for_outgoing": 0,
		"no_smtp_authentication": 1,
	}
	if frappe.db.exists("Email Account", name):
		doc = frappe.get_doc("Email Account", name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		frappe.get_doc({"doctype": "Email Account", **values}).insert(ignore_permissions=True)
	frappe.db.commit()
	return name


def seed_volume(tasks: int = 1600):
	"""Development only: a realistic volume dataset for performance checks ("E2E Volume" Space).

	Members: qa.manager (Manager/owner) and qa.member. About half of the tasks are assigned to
	qa.member; tasks carry 0-5 Actions and 0-2 of six shared labels. Deterministic (seeded RNG).
	"""
	import random

	if not frappe.conf.get("developer_mode"):
		frappe.throw("Volume data can only be generated in developer mode.")
	if frappe.db.exists("Masar Space", {"title": "E2E Volume"}):
		return {"skipped": "E2E Volume already exists"}
	rng = random.Random(42)
	space = frappe.get_doc(
		{
			"doctype": "Masar Space",
			"title": "E2E Volume",
			"category": "Performance",
			"space_owner": _email("qa.manager"),
			"space_type": "Internal",
			"department": "App",
			"members": [
				{"user": _email("qa.manager"), "role": "Manager"},
				{"user": _email("qa.member"), "role": "Member"},
			],
		}
	).insert(ignore_permissions=True)
	labels = [
		frappe.get_doc({"doctype": "Masar Label", "space": space.name, "label_name": name, "color": color})
		.insert(ignore_permissions=True)
		.name
		for name, color in [
			("Backend", "info"),
			("Frontend", "primary"),
			("Bug", "error"),
			("Docs", "neutral"),
			("Infra", "warning"),
			("UX", "success"),
		]
	]
	priorities = ["Lowest", "Low", "Medium", "Medium", "High", "Highest"]
	for i in range(tasks):
		task = frappe.get_doc(
			{
				"doctype": "Masar Task",
				"space": space.name,
				"title": f"Volume task {i:04d} — {rng.choice(['Fix', 'Build', 'Review', 'Plan', 'Test'])} "
				f"{rng.choice(['login', 'invoice', 'report', 'sync', 'search', 'export'])}",
				"priority": rng.choice(priorities),
				"is_important": int(rng.random() < 0.1),
				"sort_order": float(i * 1024),
				"assignees": [{"user": _email("qa.member")}] if rng.random() < 0.5 else [],
				"labels": [{"label": name} for name in rng.sample(labels, rng.randint(0, 2))],
			}
		).insert(ignore_permissions=True)
		for j in range(rng.randint(0, 5)):
			frappe.get_doc(
				{
					"doctype": "Masar Task Action",
					"task": task.name,
					"space": space.name,
					"title": f"Step {j + 1}",
					"sort_order": float((j + 1) * 1024),
					"is_done": int(rng.random() < 0.3),
				}
			).insert(ignore_permissions=True)
		if i % 200 == 0:
			frappe.db.commit()
	from masar.services.action_service import _refresh_counters

	for name in frappe.get_all("Masar Task", filters={"space": space.name}, pluck="name"):
		_refresh_counters(name)
	frappe.db.commit()
	return {"space": space.name, "tasks": tasks}


def seed_planning_volume(features: int = 80, releases: int = 30):
	"""Development only: Features and Releases for the "E2E Volume" Space (Phase 4 performance).

	Features are spread over the four roadmap columns; about 75 % of tasks get a Feature and 60 % a
	Release; Release statuses are mixed. Deterministic (seeded RNG). Run seed_volume first.
	"""
	import random

	if not frappe.conf.get("developer_mode"):
		frappe.throw("Volume data can only be generated in developer mode.")
	space = frappe.db.get_value("Masar Space", {"title": "E2E Volume"}, "name")
	if not space:
		frappe.throw("Run seed_volume first.")
	if frappe.db.exists("Masar Feature", {"space": space}):
		return {"skipped": "E2E Volume already has Features"}
	rng = random.Random(4)
	columns = ("Now", "Next", "Later", "Done")
	feature_names = [
		frappe.get_doc(
			{
				"doctype": "Masar Feature",
				"space": space,
				"title": f"Volume feature {i:03d}",
				"roadmap": columns[i % 4],
				"sort_order": float((i // 4 + 1) * 1024),
			}
		)
		.insert(ignore_permissions=True)
		.name
		for i in range(features)
	]
	release_names = [
		frappe.get_doc(
			{
				"doctype": "Masar Release",
				"space": space,
				"release_name": f"2027.{i:02d}",
				"status": "Planned" if i >= releases // 3 else rng.choice(("Released", "Archived")),
			}
		)
		.insert(ignore_permissions=True)
		.name
		for i in range(releases)
	]
	task = frappe.qb.DocType("Masar Task")
	for name in frappe.get_all("Masar Task", filters={"space": space}, pluck="name", order_by="name"):
		frappe.qb.update(task).set(
			task.feature, rng.choice(feature_names) if rng.random() < 0.75 else None
		).set(task.target_release, rng.choice(release_names) if rng.random() < 0.6 else None).where(
			task.name == name
		).run()
	frappe.db.commit()
	return {"space": space, "features": features, "releases": releases}


def seed_batch_volume(extra_tasks: int = 400):
	"""Development only: Batches across two Spaces for Phase 5 performance checks.

	Adds "E2E Volume B" (qa.manager Manager, qa.outsider Member, `extra_tasks` tasks) and, through the
	real services as qa.manager: 12 finished Batches with history, 2 active cross-Space Batches of 150
	tasks each and 4 planned Batches. Deterministic (seeded RNG). Run seed_volume first.
	"""
	import random

	from masar.services import batch_service, task_service

	if not frappe.conf.get("developer_mode"):
		frappe.throw("Volume data can only be generated in developer mode.")
	volume = frappe.db.get_value("Masar Space", {"title": "E2E Volume"}, "name")
	if not volume:
		frappe.throw("Run seed_volume first.")
	if frappe.db.exists("Masar Space", {"title": "E2E Volume B"}):
		return {"skipped": "E2E Volume B already exists"}
	rng = random.Random(5)
	space_b = frappe.get_doc(
		{
			"doctype": "Masar Space",
			"title": "E2E Volume B",
			"category": "Performance",
			"space_owner": _email("qa.manager"),
			"space_type": "Internal",
			"department": "App",
			"members": [
				{"user": _email("qa.manager"), "role": "Manager"},
				{"user": _email("qa.outsider"), "role": "Member"},
			],
		}
	).insert(ignore_permissions=True)
	for i in range(extra_tasks):
		frappe.get_doc(
			{
				"doctype": "Masar Task",
				"space": space_b.name,
				"title": f"Volume B task {i:04d}",
				"sort_order": float(i * 1024),
			}
		).insert(ignore_permissions=True)
	frappe.db.commit()

	frappe.set_user(_email("qa.manager"))
	from masar.permissions import clear_membership_cache

	clear_membership_cache()
	task = frappe.qb.DocType("Masar Task")
	pool = [
		n
		for (n,) in frappe.qb.from_(task)
		.select(task.name)
		.where(task.space.isin([volume, space_b.name]))
		.orderby(task.name)
		.run()
	]
	rng.shuffle(pool)

	def plan(name: str, start: str, names: list[str]) -> str:
		batch = batch_service.create_batch(name, start, preset="two_weeks")["batch"]["name"]
		for chunk in range(0, len(names), 200):
			batch_service.move_tasks(names[chunk : chunk + 200], batch)
		return batch

	cursor = 0
	for week in range(12):  # finished history: 60 tasks each, about half completed at finish
		names = pool[cursor : cursor + 60]
		cursor += 60
		batch = plan(f"Volume history {week + 1:02d}", f"2026-{(week % 9) + 1:02d}-01", names)
		batch_service.start_batch(batch)
		for name in names:
			if rng.random() < 0.5:
				task_service.set_completed(name, True)
		batch_service.finish_batch(batch, "Unbatched", None, f"seed-finish-{week:02d}-{batch}")
		frappe.db.commit()
	for i in range(2):  # active, cross-Space
		names = pool[cursor : cursor + 150]
		cursor += 150
		batch_service.start_batch(plan(f"Volume active {i + 1}", "2026-10-26", names))
	for i in range(4):
		plan(f"Volume planned {i + 1}", "2026-11-09", pool[cursor : cursor + 25])
		cursor += 25
	frappe.db.commit()
	frappe.set_user("Administrator")
	return {"space": space_b.name, "batches": 18, "tasksUsed": cursor}
