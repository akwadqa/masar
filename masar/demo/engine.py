"""Reset and seed the Masar demonstration environment (development and pre-production only).

Commands (run with `bench --site <site> execute masar.demo.engine.<command> --kwargs "{...}"`):

	inventory()                                  read-only counts of users and Masar records
	reset(confirm, dry_run=1, users=None)        delete all Masar business data and the listed users
	seed(confirm, credentials_file, dry_run=1)   create the fictional company through Masar services
	verify()                                     relational and aggregate integrity checks (read-only)

Safety: only allow-listed sites; `confirm` must equal the site name; destructive commands default to
a dry run; a manifest stored in the site folder records the seeded dataset, and a second seed or an
unflagged reset over seeded data is refused. Passwords are read from a file and never printed.

History: business operations run through the real Masar services as the acting (fictional) employee,
under a simulation clock that exists only inside this process: `now_datetime` returns the simulated
moment, so creation, completion, Batch and comment timestamps stay mutually consistent. Comment
notification jobs are not enqueued by this process, so no e-mail is produced. Web requests, workers
and the scheduler are never affected by either mechanism.
"""

import datetime
import json
import os
import random
import sys
import uuid
from contextlib import contextmanager

import frappe
from frappe.utils import add_days, getdate

from masar.demo import dataset as D
from masar.utils.context import masar_service

ALLOWED_SITES = ("masar.hariri.ch", "masar.localhost")
MANIFEST = "masar_demo_manifest.json"
# Deletion order: dependants before the records they point to (all are Masar-owned DocTypes).
MASAR_DOCTYPES = (
	"Masar Timer Session",
	"Masar My Day",
	"Masar Comment Notification",
	"Masar Comment Reaction",
	"Masar Attachment",
	"Masar Comment",
	"Masar Time Entry",
	"Masar Task Label",
	"Masar Task Assignee",
	"Masar Task Action",
	"Masar Batch Item",
	"Masar Task",
	"Masar Batch",
	"Masar Feature",
	"Masar Release",
	"Masar Label",
	"Masar Activity",
	"Masar Space Member",
	"Masar Space",
)
NOTIFY_JOB = "masar.services.notification_service.notify_comment"


# ---------------------------------------------------------------------------------------------------
# Guards and manifest


def _guard(confirm: str | None, *, writes: bool):
	site = frappe.local.site
	if site not in ALLOWED_SITES:
		frappe.throw(f"Demo tooling is not allowed on site {site}.")
	if frappe.conf.get("masar_environment") == "production":
		frappe.throw("Demo tooling refuses to run on a production site.")
	if writes and confirm != site:
		frappe.throw(f"Pass confirm='{site}' to run this command on {site}.")


def _manifest_path() -> str:
	return frappe.get_site_path(MANIFEST)


def _read_manifest() -> dict | None:
	path = _manifest_path()
	if not os.path.exists(path):
		return None
	with open(path) as handle:
		return json.load(handle)


def _write_manifest(data: dict):
	path = _manifest_path()
	with open(path, "w") as handle:
		json.dump(data, handle, indent=1, sort_keys=True, default=str)
	os.chmod(path, 0o600)


def _email(key: str) -> str:
	return f"{key}@{D.EMAIL_DOMAIN}"


# ---------------------------------------------------------------------------------------------------
# Inventory and reset


def inventory() -> dict:
	_guard(None, writes=False)
	users = frappe.get_all("User", fields=["name", "enabled", "user_type"], order_by="name")
	return {
		"site": frappe.local.site,
		"users": [u.name for u in users],
		"masar": {dt: frappe.db.count(dt) for dt in MASAR_DOCTYPES},
		"files": frappe.db.count("File", {"attached_to_doctype": ["like", "Masar%"]}),
		"manifest": bool(_read_manifest()),
	}


def reset(confirm: str | None = None, dry_run=1, users=None, allow_seeded=0) -> dict:
	"""Delete every Masar business record and the listed users (never Administrator or Guest).

	Masar rows are removed DocType by DocType in dependency order with scoped deletes, because their
	controllers intentionally refuse deletions that the product never allows (for example a started
	Batch); attached Files go through `File` so the stored files are removed too."""
	_guard(confirm, writes=True)
	users = json.loads(users) if isinstance(users, str) else list(users or [])
	protected = {"Administrator", "Guest"}
	if protected.intersection(users):
		frappe.throw("Administrator and Guest can never be removed.")
	manifest = _read_manifest()
	if manifest and not int(allow_seeded) and not int(dry_run):
		frappe.throw("This site holds a seeded demo dataset. Pass allow_seeded=1 to reset it deliberately.")
	before = inventory()
	files = frappe.get_all("File", filters={"attached_to_doctype": ["like", "Masar%"]}, pluck="name")
	refs = {
		"Version": frappe.db.count("Version", {"ref_doctype": ["like", "Masar%"]}),
		"Comment": frappe.db.count("Comment", {"reference_doctype": ["like", "Masar%"]}),
	}
	plan = {"before": before, "files": len(files), "framework_refs": refs, "users": users}
	if int(dry_run):
		return {"dry_run": True, **plan}

	for user in users:
		if not frappe.db.exists("User", user):
			frappe.throw(f"User {user} does not exist; nothing was deleted.")
	with masar_service():
		for name in files:
			frappe.delete_doc("File", name, ignore_permissions=True, force=True, delete_permanently=True)
		for doctype in MASAR_DOCTYPES:
			frappe.db.delete(doctype)
		frappe.db.delete("Version", {"ref_doctype": ["like", "Masar%"]})
		frappe.db.delete("Comment", {"reference_doctype": ["like", "Masar%"]})
	from frappe.sessions import clear_sessions

	for user in users:
		clear_sessions(user=user, force=True)
		frappe.delete_doc("User", user, ignore_permissions=True, force=True, delete_permanently=True)
		frappe.db.delete("Contact", {"user": user})
	frappe.db.commit()
	if manifest:
		os.remove(_manifest_path())
	frappe.clear_cache()
	return {"dry_run": False, **plan, "after": inventory()}


def delete_scope(spaces: list[str], batches: list[str]) -> dict:
	"""Delete the given Spaces and Batches with everything that belongs to them, and nothing else.
	Used to remove automated-test fixtures without touching any other record (callers commit)."""
	tasks = frappe.get_all("Masar Task", filters={"space": ["in", spaces or ["-"]]}, pluck="name")
	foreign = frappe.db.count("Masar Batch Item", {"batch": ["in", batches or ["-"]], "space": ["not in", spaces or ["-"]]})
	if foreign:
		frappe.throw("A Batch in scope holds Tasks of other Spaces; nothing was deleted.")
	files = frappe.get_all("File", filters={"attached_to_doctype": "Masar Task", "attached_to_name": ["in", tasks or ["-"]]}, pluck="name")
	in_spaces = {"space": ["in", spaces or ["-"]]}
	refs = [*spaces, *tasks, *batches]
	with masar_service():
		for name in files:
			frappe.delete_doc("File", name, ignore_permissions=True, force=True, delete_permanently=True)
		for doctype in ("Masar Timer Session", "Masar My Day", "Masar Notification", "Masar Comment Notification", "Masar Comment Reaction", "Masar Attachment", "Masar Comment",
				"Masar Time Entry", "Masar Task Action", "Masar Batch Item", "Masar Feature", "Masar Release",
				"Masar Label", "Masar Activity"):
			frappe.db.delete(doctype, in_spaces)
		frappe.db.delete("Masar Batch Item", {"batch": ["in", batches or ["-"]]})
		frappe.db.delete("Masar Activity", {"reference_name": ["in", batches or ["-"]]})
		for child in ("Masar Task Label", "Masar Task Assignee"):
			frappe.db.delete(child, {"parent": ["in", tasks or ["-"]]})
		frappe.db.delete("Masar Task", in_spaces)
		frappe.db.delete("Masar Batch", {"name": ["in", batches or ["-"]]})
		frappe.db.delete("Masar Space Member", {"parent": ["in", spaces or ["-"]]})
		frappe.db.delete("Masar Space", {"name": ["in", spaces or ["-"]]})
		frappe.db.delete("Version", {"ref_doctype": ["like", "Masar%"], "docname": ["in", refs or ["-"]]})
		frappe.db.delete("Comment", {"reference_doctype": ["like", "Masar%"], "reference_name": ["in", refs or ["-"]]})
	return {"spaces": len(spaces), "batches": len(batches), "tasks": len(tasks), "files": len(files)}


# ---------------------------------------------------------------------------------------------------
# Simulation clock (this process only)


class _Clock:
	def __init__(self):
		self.moment: datetime.datetime | None = None

	def now(self) -> datetime.datetime:
		self.moment += datetime.timedelta(seconds=1)  # strictly increasing within the simulation
		return self.moment


@contextmanager
def _simulation(clock: _Clock):
	"""Route every `now_datetime` reference in Frappe and Masar to the clock, and keep comment
	notification jobs out of the queue. Both are undone when the block exits, even on error."""
	import frappe.utils.data as data

	original = data.now_datetime
	patched = []
	for module in list(sys.modules.values()):
		name = getattr(module, "__name__", "") or ""
		if (name.startswith("masar") or name.startswith("frappe")) and getattr(module, "now_datetime", None) is original:
			module.now_datetime = clock.now
			patched.append(module)
	real_enqueue = frappe.enqueue

	def enqueue(method, *args, **kwargs):
		if method == NOTIFY_JOB:
			return None
		return real_enqueue(method, *args, **kwargs)

	frappe.enqueue = enqueue
	try:
		yield
	finally:
		for module in patched:
			module.now_datetime = original
		frappe.enqueue = real_enqueue


# ---------------------------------------------------------------------------------------------------
# Seeding plan


class _Planner:
	"""Builds the deterministic event list. Each event: (day, phase, label, callable)."""

	def __init__(self, today: datetime.date, rng: random.Random):
		self.today = today
		self.rng = rng
		self.events: list[tuple[int, int, str, object]] = []
		self.refs: dict = {"space": {}, "label": {}, "feature": {}, "release": {}, "task": {}, "batch": {}}
		self.counts: dict[str, int] = {}

	def at(self, day: int, phase: int, label: str, fn):
		self.events.append((day, phase, label, fn))

	def rid(self) -> str:
		return str(uuid.UUID(int=self.rng.getrandbits(128)))

	def day(self, offset: int) -> str:
		return str(add_days(self.today, offset))

	def bump(self, key: str, n: int = 1):
		self.counts[key] = self.counts.get(key, 0) + n


def _as(user: str):
	from masar.permissions import clear_membership_cache

	frappe.set_user(user)
	clear_membership_cache()


def _plan(p: _Planner):
	from masar.services import (
		action_service,
		attachment_service,
		batch_service,
		comment_service,
		label_service,
		planning_service,
		space_service,
		task_service,
		time_service,
	)
	from masar.services.personal import my_day_service

	rng = p.rng
	today = p.today

	def weekday(offset: int) -> bool:
		return add_days(today, offset).weekday() not in (4, 5)  # Friday, Saturday

	def workdays(first: int, last: int) -> list[int]:
		return [d for d in range(first, last + 1) if weekday(d)]

	space_specs = {s["key"]: s for s in D.SPACES}
	status_day = {s["key"]: min([d for _, d in s.get("status", [])] or [1]) for s in D.SPACES}

	# ---- Spaces, labels, Features, Releases --------------------------------------------------
	for spec in D.SPACES:
		key, start = spec["key"], spec["start"]
		people = [spec["owner"], *spec["managers"], *spec["members"]]
		spec["_people"] = people

		def make_space(spec=spec):
			_as(_email("omar"))
			detail = space_service.create({
				"title": spec["title"], "owner": _email(spec["owner"]), "category": spec["category"],
				"spaceType": spec["type"], "details": f"<p>{spec['details']}</p>",
				"completionDate": p.day(spec.get("status", [(None, spec["start"] + 90)])[0][1]),
			})
			p.refs["space"][spec["key"]] = detail["name"]
			_as(_email(spec["owner"]))
			for m in spec["managers"]:
				space_service.add_member(detail["name"], _email(m), "Manager")
			for m in spec["members"]:
				space_service.add_member(detail["name"], _email(m), "Member")
			for title, color in spec["labels"]:
				p.refs["label"][(spec["key"], title)] = label_service.create(detail["name"], title, color)["label"]["name"]
			p.bump("spaces")

		p.at(start, 0, f"space {key}", make_space)

		def make_planning(spec=spec):
			_as(_email(spec["owner"]))
			space = p.refs["space"][spec["key"]]
			for fkey, (title, roadmap, desc) in spec["features"].items():
				f = planning_service.create_feature(space, title, roadmap, f"<p>{desc}</p>" if desc else None, p.rid())
				p.refs["feature"][(spec["key"], fkey)] = f["name"]
				p.bump("features")
			for name, offset, final, notes in spec["releases"]:
				r = planning_service.create_release(space, name, p.day(offset), f"<p>{notes}</p>")
				p.refs["release"][(spec["key"], name)] = r["name"]
				p.bump("releases")

		p.at(start + 1, 1, f"planning {key}", make_planning)

		for name, offset, final, _ in spec["releases"]:
			if final in ("Released", "Archived"):
				released_day = min(offset, -1)

				def release(spec=spec, name=name):
					_as(_email(spec["owner"]))
					planning_service.set_release_status(p.refs["release"][(spec["key"], name)], "Released")

				p.at(released_day, 8, f"release {name}", release)
			if final == "Archived":

				def archive(spec=spec, name=name):
					_as(_email(spec["owner"]))
					planning_service.set_release_status(p.refs["release"][(spec["key"], name)], "Archived")

				p.at(min(offset + 14, -1), 8, f"archive {name}", archive)

		for status, day in spec.get("status", []):

			def set_status(spec=spec, status=status):
				_as(_email(spec["owner"]))
				space_service.set_status(p.refs["space"][spec["key"]], status)

			p.at(day, 9, f"status {key} {status}", set_status)

	# ---- Task lifecycles ---------------------------------------------------------------------
	tasks = []
	for spec in D.SPACES:
		key, start = spec["key"], spec["start"]
		people = spec["_people"]
		closed_by = status_day[key] if spec.get("status") else 1
		last_create = min(closed_by - 4, 0)
		features_done = {fk for fk, (_, roadmap, _) in spec["features"].items() if roadmap == "Done"}
		releases = {name: (offset, final) for name, offset, final, _ in spec["releases"]}
		for index, (title, kind, fkey) in enumerate(spec["tasks"]):
			created = start + 2 + int((last_create - start - 2) * rng.random() ** 0.8)
			if index < 2 and not spec.get("status"):
				created = rng.choice([0, -1])  # a few genuinely new Tasks
			finished_space = bool(spec.get("status"))
			if finished_space:
				done = created + rng.randint(2, 14) if rng.random() < 0.93 else None
				if done is not None:
					done = min(done, closed_by - 1)
			elif fkey in features_done:
				done = min(created + rng.randint(2, 12), -1) if rng.random() < 0.9 else None
			else:
				age = -created
				p_done = 0.15 if age < 7 else 0.45 if age < 25 else 0.7
				done = min(created + rng.randint(2, max(3, min(age, 18))), 0) if rng.random() < p_done else None
			if done is not None and done < created:
				done = created
			workers = [m for m in D.SKILLS[kind] if m in people] or [m for m in people if m != spec["owner"]] or people
			primary = workers[0] if rng.random() < 0.7 else rng.choice(workers)
			assignees = [primary]
			if rng.random() < 0.25:
				other = rng.choice([m for m in people if m != primary])
				assignees.append(other)
			creator = rng.choice([spec["owner"], *spec["managers"], primary])
			# Finished work ships in the first Release dated on or after its completion; open work is
			# planned into an upcoming Release.
			release = None
			shipped = sorted((offset, n) for n, (offset, final) in releases.items()
				if final != "Planned" and done is not None and created <= offset - 1 and done <= offset)
			upcoming = [n for n, (offset, final) in releases.items() if final == "Planned"]
			if shipped and rng.random() < 0.8:
				release = shipped[0][1]
			elif done is None and upcoming and rng.random() < 0.6:
				release = rng.choice(upcoming)
			tasks.append({
				"space": key, "title": title, "kind": kind, "feature": fkey, "created": created, "done": done,
				"assignees": assignees, "creator": creator, "release": release, "people": people,
				"owner": spec["owner"], "managers": spec["managers"], "closed_by": closed_by,
				"batches": [],
			})

	# ---- Batch membership (decided before events, mirroring the real lifecycle) ---------------
	current: dict[str, str | None] = {}
	batch_specs = sorted(D.BATCHES, key=lambda b: b["start"])
	for b in batch_specs:
		b["_end"] = b["start"] + b["days"] - 1
		b["_plan"] = min(b["start"] - 2, 0)  # future Batches are planned today at the latest
		b["_finish"] = b["_end"] + 1 if b["_end"] + 1 <= 0 else None
		b["_tasks"] = []
	for b in batch_specs:
		eligible = [t for t in tasks if t["space"] in b["spaces"] and t["created"] <= b["_plan"] - 1
			and current.get(t["title"]) is None and (t["done"] is None or t["done"] >= b["start"])
			and t["closed_by"] > b["_plan"]]
		in_window = [t for t in eligible if t["done"] is not None and t["done"] <= (b["_finish"] or 0) - 1]
		rest = [t for t in eligible if t not in in_window]
		rng.shuffle(rest)
		chosen = (in_window[: b["size"] * 2 // 3] + rest)[: b["size"]]
		for t in chosen:
			b["_tasks"].append(t["title"])
			t["batches"].append(b["title"])
			current[t["title"]] = b["title"]
		if b["_finish"] is not None:
			for t in tasks:
				if current.get(t["title"]) == b["title"] and (t["done"] is None or t["done"] >= b["_finish"]):
					nxt = b["carry"]
					current[t["title"]] = nxt
					if nxt:
						t["batches"].append(nxt)
						next(x for x in batch_specs if x["title"] == nxt)["_carried"] = True
				elif current.get(t["title"]) == b["title"]:
					current[t["title"]] = None

	# ---- Task events -------------------------------------------------------------------------
	priorities = ["Medium"] * 9 + ["High"] * 5 + ["Highest"] * 2 + ["Low"] * 3 + ["Lowest"]
	label_rules = {
		"bug": ["Bug", "Incident", "QA"], "api": ["Backend", "API", "Integration", "Workflow"],
		"ui": ["Frontend", "UI/UX", "Mobile", "Enhancement"], "design": ["UI/UX", "Enhancement", "Frontend", "Content"],
		"qa": ["QA", "Client Feedback"], "docs": ["Documentation", "Training", "Content"],
		"ops": ["Security", "Configuration", "Offline", "Quick Win"], "integration": ["Integration", "Data Migration", "API"],
		"analysis": ["Client Feedback", "Process", "Reporting", "Workflow"], "support": ["Process", "Incident", "Quick Win"],
	}
	promotions = {(s, t): a for s, t, a in D.PROMOTIONS}
	attachments = {(s, t): (f, k) for s, t, f, k in D.ATTACHMENTS}
	comment_counter = {"edited": 0, "deleted": 0}
	time_counter = {"corrected": 0, "voided": 0}
	my_day_budget: dict[str, int] = {}

	for t in tasks:
		spec = space_specs[t["space"]]
		end = t["done"] if t["done"] is not None else min(0, t["closed_by"] - 1)
		priority = rng.choice(priorities)
		if t["kind"] == "bug" and rng.random() < 0.5:
			priority = rng.choice(["High", "Highest"])
		due = None
		if rng.random() < 0.78:
			if t["done"] is not None:
				due = t["done"] + rng.choice([-2, 0, 1, 2, 3, 5])
			else:
				due = rng.choice([rng.randint(-9, -1), 0, rng.randint(1, 7), rng.randint(1, 7), rng.randint(8, 30)])
			due = max(due, t["created"])
		t["due"] = due
		labels = [lt for lt in label_rules[t["kind"]] if (t["space"], lt) in p.refs["label"] or any(lt == x for x, _ in spec["labels"])]
		labels = [lt for lt in labels if any(lt == x for x, _ in spec["labels"])]
		chosen_labels = labels[: rng.choice([0, 1, 1, 2])]
		if priority == "Highest" and any(x == "Urgent" for x, _ in spec["labels"]):
			chosen_labels.append("Urgent")
		describe = rng.random() < 0.6
		important = rng.random() < 0.12 or priority == "Highest"

		def create(t=t, priority=priority, chosen_labels=chosen_labels, describe=describe, important=important):
			space = p.refs["space"][t["space"]]
			_as(_email(t["creator"]))
			task = task_service.create(space, t["title"], p.rid())["task"]
			name = task["name"]
			p.refs["task"][(t["space"], t["title"])] = name
			changes = {"priority": priority}
			if t["due"] is not None:
				changes["dueDate"] = p.day(t["due"])
			if describe:
				changes["description"] = rng.choice(D.DESCRIPTIONS[t["kind"]])
			if t["feature"]:
				changes["feature"] = p.refs["feature"][(t["space"], t["feature"])]
			if t["release"]:
				changes["release"] = p.refs["release"][(t["space"], t["release"])]
			if important:
				changes["isImportant"] = True
			task_service.update(name, changes)
			for a in t["assignees"]:
				task_service.add_assignee(name, _email(a))
			task_service.set_owner(name, _email(t["assignees"][0]))
			for lt in dict.fromkeys(chosen_labels):
				task_service.add_label(name, p.refs["label"][(t["space"], lt)])
			p.bump("tasks")

		p.at(t["created"], 4, f"task {t['title']}", create)

		worker = t["assignees"][0]
		# Actions
		promote = promotions.get((t["space"], t["title"]))
		if rng.random() < 0.62 or promote:
			titles = D.ACTIONS[t["kind"]][: rng.randint(2, len(D.ACTIONS[t["kind"]]))]
			if promote:
				titles = [*titles, promote]
			if t["done"] is not None:
				done_count = len(titles) - (1 if promote else 0)
			else:
				done_count = rng.randint(0, max(0, len(titles) - 1))

			def actions(t=t, titles=titles, done_count=done_count, worker=worker, promote=promote):
				_as(_email(worker))
				name = p.refs["task"][(t["space"], t["title"])]
				made = [action_service.add(name, title, p.rid())["action"]["name"] for title in titles]
				p.refs.setdefault("actions", {})[(t["space"], t["title"])] = made
				p.bump("actions", len(made))

			p.at(t["created"], 5, f"actions {t['title']}", actions)
			if done_count:
				finish_on = t["done"] if t["done"] is not None else min(end, t["created"] + rng.randint(1, 6))

				def tick(t=t, done_count=done_count, worker=worker):
					_as(_email(worker))
					for action in p.refs["actions"][(t["space"], t["title"])][:done_count]:
						action_service.set_done(action, True)

				p.at(max(finish_on, t["created"]), 6, f"actions done {t['title']}", tick)
			if promote:

				def do_promote(t=t, worker=worker):
					_as(_email(worker))
					action = p.refs["actions"][(t["space"], t["title"])][-1]
					result = action_service.promote(action)
					p.bump("promoted")
					return result

				p.at(min(t["created"] + 2, end), 6, f"promote {t['title']}", do_promote)

		# Comments
		if rng.random() < 0.5 and len(t["people"]) > 1:
			n = rng.choice([1, 1, 2, 2, 3, 4])
			days = sorted(rng.randint(t["created"], end) for _ in range(n))
			others = [m for m in t["people"] if m != worker]
			for i, day in enumerate(days):
				author = worker if i % 2 == 0 else rng.choice(others)
				target = rng.choice([m for m in t["people"] if m != author])
				text = rng.choice(D.COMMENTS[t["kind"]])
				react = rng.random() < 0.35
				attach = attachments.get((t["space"], t["title"])) if i == 0 and attachments.get((t["space"], t["title"]), ("", ""))[1] == "diagram" else None

				def comment(t=t, author=author, target=target, text=text, react=react, attach=attach, i=i):
					_as(_email(author))
					name = p.refs["task"][(t["space"], t["title"])]
					first, last = D.PEOPLE[target][0], D.PEOPLE[target][1]
					label = f"{first} {last}"
					mention = f'<span data-type="mention" class="mention" data-id="{_email(target)}" data-label="{label}">@{label}</span>'
					html = f"<p>{text.replace('{mention}', mention)}</p>"
					pending = []
					if attach:
						task_doc = frappe.get_doc("Masar Task", name)
						row = attachment_service.store(task_doc, attach[0], _file_content(attach[1], t), "Comment")
						pending.append(row["name"])
						p.bump("attachments")
					c = comment_service.create(name, html, p.rid(), pending or None)["comment"]
					p.bump("comments")
					p.refs.setdefault("comments", []).append((t, c["name"], author))
					if react:
						_as(_email(target))
						comment_service.react(c["name"], rng.choice(["thumbs_up", "thumbs_up", "check", "heart", "eyes"]), True)
						p.bump("reactions")

				p.at(day, 6, f"comment {t['title']} {i}", comment)

		# Task attachments (generated, non-sensitive)
		spec_attach = attachments.get((t["space"], t["title"]))
		if spec_attach and spec_attach[1] != "diagram":

			def attach_file(t=t, spec_attach=spec_attach, worker=worker):
				_as(_email(worker))
				name = p.refs["task"][(t["space"], t["title"])]
				attachment_service.store(frappe.get_doc("Masar Task", name), spec_attach[0], _file_content(spec_attach[1], t), "Task")
				p.bump("attachments")

			p.at(min(t["created"] + 1, end), 6, f"attach {t['title']}", attach_file)

		# Time entries
		if (t["done"] is not None or -t["created"] > 3) and rng.random() < 0.72:
			days = workdays(t["created"], end) or [end]
			for day in sorted(rng.sample(days, min(len(days), rng.randint(1, 5)))):
				who = rng.choice(t["assignees"])
				minutes = rng.choice(D.DURATIONS)
				note = rng.choice(D.TIME_NOTES[t["kind"]]) if rng.random() < 0.7 else None

				def log(t=t, who=who, minutes=minutes, note=note, day=day):
					_as(_email(who))
					name = p.refs["task"][(t["space"], t["title"])]
					result = time_service.log_time(name, f"{minutes}m", p.rid(), p.day(day), note)
					p.bump("time_entries")
					p.refs.setdefault("entries", []).append((t, result["entry"]["name"], who, day))

				p.at(day, 7, f"time {t['title']} {day}", log)

		# Remaining estimate on open work
		if t["done"] is None and t["closed_by"] > 0 and rng.random() < 0.55:

			def estimate(t=t, worker=worker):
				_as(_email(worker))
				name = p.refs["task"][(t["space"], t["title"])]
				task_service.update(name, {"remainingMinutes": rng.choice([0, 60, 120, 240, 360, 480, 960])})

			p.at(end, 7, f"estimate {t['title']}", estimate)

		# Completion
		if t["done"] is not None:

			def complete(t=t, worker=worker):
				_as(_email(worker))
				task_service.set_completed(p.refs["task"][(t["space"], t["title"])], True)
				p.bump("completed")

			p.at(t["done"], 7, f"complete {t['title']}", complete)

		# My Day (personal since client revision 4): a few open Tasks per person, picked today
		if t["done"] is None and t["closed_by"] > 0 and my_day_budget.get(worker, 0) < 2 and rng.random() < 0.3:
			my_day_budget[worker] = my_day_budget.get(worker, 0) + 1

			def my_day(t=t, worker=worker):
				_as(_email(worker))
				my_day_service.set_my_day(p.refs["task"][(t["space"], t["title"])], True)

			p.at(0, 8, f"my day {t['title']}", my_day)

	# ---- Batches -----------------------------------------------------------------------------
	for b in batch_specs:

		def plan_batch(b=b):
			_as(_email(b["owner"]))
			created = batch_service.create_batch(b["title"], p.day(b["start"]), p.day(b["_end"]), None, p.rid())["batch"]
			p.refs["batch"][b["title"]] = created["name"]
			# Tasks join their first Batch here; later Batches receive them only by carry-over at finish.
			new = [p.refs["task"][(t["space"], t["title"])] for t in tasks if t["batches"][:1] == [b["title"]]]
			if new:
				batch_service.move_tasks(new, created["name"])
			p.bump("batches")

		p.at(b["_plan"], 2, f"plan {b['title']}", plan_batch)
		if b["start"] <= 0:

			def start_batch(b=b):
				_as(_email(b["owner"]))
				batch_service.start_batch(p.refs["batch"][b["title"]], p.rid())

			p.at(b["start"], 3, f"start {b['title']}", start_batch)
		if b["_finish"] is not None:

			def finish(b=b):
				_as(_email(b["owner"]))
				batch = p.refs["batch"][b["title"]]
				if b["carry"]:
					batch_service.finish_batch(batch, "Batch", p.refs["batch"][b["carry"]], p.rid())
				else:
					batch_service.finish_batch(batch, "Unbatched", None, p.rid())

			p.at(b["_finish"], 1, f"finish {b['title']}", finish)

	# ---- Corrections, voids, edits and moderation (a few, after the fact) ---------------------
	def corrections():
		# Only work in Spaces that are still In Progress can be corrected or moderated today.
		entries = [e for e in p.refs.get("entries", []) if e[0]["closed_by"] > 0]
		for t, entry, who, day in entries[5::37][:4]:
			_as(_email(who))
			doc = frappe.get_doc("Masar Time Entry", entry)
			if not doc.is_voided:
				time_service.update_entry(entry, {"duration": f"{doc.minutes + 15}m", "description": "Corrected: included the review meeting"})
				time_counter["corrected"] += 1
		for t, entry, who, day in entries[11::53][:2]:
			_as(_email(who))
			if not frappe.db.get_value("Masar Time Entry", entry, "is_voided"):
				time_service.void_entry(entry, "Logged on the wrong task")
				time_counter["voided"] += 1
		comments = [c for c in p.refs.get("comments", []) if c[0]["closed_by"] > 0]
		for t, name, author in comments[3::29][:3]:
			_as(_email(author))
			doc = frappe.get_doc("Masar Comment", name)
			if not doc.is_deleted:
				comment_service.update(name, doc.content.replace("</p>", " (Updated after the stand-up.)</p>", 1))
				comment_counter["edited"] += 1
		for t, name, author in comments[7::41][:1]:
			_as(_email(author))
			comment_service.delete(name)
			comment_counter["deleted"] += 1
		for t, name, author in comments[19::43][:1]:
			manager = t["owner"]
			if manager != author:
				_as(_email(manager))
				comment_service.delete(name)
				comment_counter["deleted"] += 1
		p.counts.update({"time_corrected": time_counter["corrected"], "time_voided": time_counter["voided"],
			"comments_edited": comment_counter["edited"], "comments_deleted": comment_counter["deleted"]})

	p.at(0, 9, "corrections", corrections)
	return tasks


def _file_content(kind: str, task: dict) -> bytes:
	"""Small generated files: no client documents, no personal data."""
	title = task["title"]
	if kind == "json":
		return json.dumps({"request": {"id": "SR-24-01873", "category": "Water supply", "status": "In Progress",
			"submittedAt": "2026-10-20T09:15:00+03:00", "updates": [{"status": "Assigned", "at": "2026-10-20T11:02:00+03:00"}]}}, indent=2).encode()
	if kind == "csv":
		rows = ["code,name,category,status"] + [f"{1000 + i},Item {i:03d},{['A', 'B', 'C'][i % 3]},active" for i in range(1, 26)]
		return ("\n".join(rows) + "\n").encode()
	if kind == "matrix":
		return b"impact,urgency,priority,target response\nHigh,High,P1,30 minutes\nHigh,Low,P2,4 hours\nLow,High,P3,1 working day\nLow,Low,P4,3 working days\n"
	if kind == "checklist":
		items = ["Main path works with valid data", "Required fields are validated", "Permissions deny other users",
			"Mobile layout checked", "Keyboard navigation checked", "Error messages are understandable"]
		return (f"# Checklist: {title}\n\n" + "\n".join(f"- [ ] {i}" for i in items) + "\n").encode()
	if kind == "runbook":
		return (f"# Runbook: {title}\n\n1. Announce the maintenance window.\n2. Take and verify a backup.\n"
			"3. Deploy the release to staging and run the smoke tests.\n4. Deploy to production.\n"
			"5. Verify health checks and key user journeys.\n6. Roll back if any check fails.\n").encode()
	if kind == "notes":
		return (f"Device test notes: {title}\n\nDevice A (Android 12, 3 GB RAM): list scrolls smoothly; photo upload 6 s.\n"
			"Device B (Android 10, 2 GB RAM): first launch 9 s; camera opens slowly.\nAction: compress photos before upload.\n").encode()
	return _diagram_png()


def _diagram_png() -> bytes:
	"""A tiny generated flow diagram (three boxes and arrows) as PNG, without image libraries."""
	import struct
	import zlib

	width, height = 360, 120
	pixels = [[(250, 250, 249)] * width for _ in range(height)]

	def box(x0, y0, x1, y1, color):
		for y in range(y0, y1):
			for x in range(x0, x1):
				pixels[y][x] = color if (y in (y0, y1 - 1) or x in (x0, x1 - 1)) else (230, 244, 241)

	for i, x in enumerate((20, 140, 260)):
		box(x, 40, x + 80, 80, (13, 116, 102))
		if i < 2:
			for xx in range(x + 80, x + 120):
				pixels[60][xx] = (87, 83, 78)
	raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in pixels)

	def chunk(tag, data):
		return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

	return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


# ---------------------------------------------------------------------------------------------------
# Seed


def seed(confirm: str | None = None, credentials_file: str | None = None, dry_run=1) -> dict:
	_guard(confirm, writes=True)
	if _read_manifest():
		frappe.throw("A demo dataset is already seeded on this site. Reset it first (allow_seeded=1).")
	existing = frappe.db.count("Masar Space")
	if existing:
		frappe.throw(f"{existing} Spaces exist. Seeding requires an empty Masar dataset.")
	clashes = [e for e in map(_email, D.PEOPLE) if frappe.db.exists("User", e)]
	if clashes:
		frappe.throw(f"Demo users already exist: {', '.join(clashes)}")
	if not credentials_file or not os.path.exists(credentials_file):
		frappe.throw("credentials_file must point to the JSON file with one password per demo user.")
	with open(credentials_file) as handle:
		passwords = json.load(handle)
	missing = [e for e in map(_email, D.PEOPLE) if len(passwords.get(e, "")) < 16]
	if missing:
		frappe.throw(f"Missing or weak passwords for: {', '.join(missing)}")

	today = getdate(frappe.utils.nowdate())  # the site timezone is Asia/Qatar
	planner = _Planner(today, random.Random(D.RANDOM_SEED))
	tasks = _plan(planner)
	planner.events.sort(key=lambda e: (e[0], e[1]))
	summary = {"dataset": D.DATASET_VERSION, "today": str(today), "events": len(planner.events),
		"first_day": planner.events[0][0], "tasks_planned": len(tasks)}
	if int(dry_run):
		return {"dry_run": True, **summary}

	_create_users(passwords)
	frappe.db.commit()
	clock = _Clock()
	real_now = frappe.utils.data.now_datetime()
	by_day: dict[int, list] = {}
	for event in planner.events:
		by_day.setdefault(event[0], []).append(event)
	try:
		with _simulation(clock):
			for day in sorted(by_day):
				events = by_day[day]
				base = datetime.datetime.combine(add_days(today, day), datetime.time(7, 30))
				span = (min(real_now - datetime.timedelta(minutes=5), base + datetime.timedelta(hours=10)) - base) if day == 0 else datetime.timedelta(hours=10)
				step = span / max(len(events), 1)
				for i, (_, _, label, fn) in enumerate(events):
					clock.moment = base + step * i
					try:
						fn()
					except Exception as error:
						frappe.db.rollback()
						frappe.throw(f"Seeding stopped at day {day}, event '{label}': {error}")
				frappe.db.commit()
	finally:
		frappe.set_user("Administrator")
	manifest = {
		"dataset": D.DATASET_VERSION, "company": D.COMPANY, "site": frappe.local.site, "seeded_on": str(today),
		"seeded_at": str(real_now), "users": [_email(k) for k in D.PEOPLE],
		"spaces": dict(sorted((k, v) for k, v in planner.refs["space"].items())),
		"batches": planner.refs["batch"], "counts": planner.counts,
	}
	_write_manifest(manifest)
	return {"dry_run": False, **summary, "counts": planner.counts}


def _create_users(passwords: dict):
	from frappe.utils.password import update_password

	for key, (first, last, _, is_admin) in D.PEOPLE.items():
		email = _email(key)
		roles = [{"role": "Masar User"}] + ([{"role": "Masar Admin"}] if is_admin else [])
		frappe.get_doc({
			"doctype": "User", "email": email, "first_name": first, "last_name": last,
			"send_welcome_email": 0, "user_type": "Website User", "roles": roles,
			"time_zone": "Asia/Qatar",
		}).insert(ignore_permissions=True)
		update_password(email, passwords[email])


# ---------------------------------------------------------------------------------------------------
# Verification (read-only)


def verify() -> dict:
	_guard(None, writes=False)
	sql = frappe.db.sql
	checks = {}

	def check(name, query):
		rows = sql(query)
		checks[name] = len(rows)

	check("tasks without a valid Space", "select t.name from `tabMasar Task` t left join `tabMasar Space` s on s.name=t.space where s.name is null")
	check("tasks whose owner is not an assignee", "select t.name from `tabMasar Task` t where t.task_owner is not null and not exists (select 1 from `tabMasar Task Assignee` a where a.parent=t.name and a.user=t.task_owner)")
	check("assignees who are not Space members", "select a.name from `tabMasar Task Assignee` a join `tabMasar Task` t on t.name=a.parent where not exists (select 1 from `tabMasar Space Member` m where m.parent=t.space and m.user=a.user)")
	check("Feature in another Space", "select t.name from `tabMasar Task` t join `tabMasar Feature` f on f.name=t.feature where f.space<>t.space")
	check("Release in another Space", "select t.name from `tabMasar Task` t join `tabMasar Release` r on r.name=t.target_release where r.space<>t.space")
	check("Actions without a Task", "select a.name from `tabMasar Task Action` a left join `tabMasar Task` t on t.name=a.task where t.name is null")
	check("Tasks promoted from more than one Action", "select source_action from `tabMasar Task` where ifnull(source_action,'')<>'' group by source_action having count(*)>1")
	check("Tasks in more than one current Batch", "select current_task from `tabMasar Batch Item` where ifnull(current_task,'')<>'' group by current_task having count(*)>1")
	check("Batch items of another Space", "select i.name from `tabMasar Batch Item` i join `tabMasar Task` t on t.name=i.task where t.space<>i.space")
	check("comments without a Task", "select c.name from `tabMasar Comment` c left join `tabMasar Task` t on t.name=c.task where t.name is null")
	check("duplicate reactions", "select comment, user, emoji from `tabMasar Comment Reaction` group by comment, user, emoji having count(*)>1")
	check("public attachment files", "select name from tabFile where attached_to_doctype like 'Masar%%' and is_private=0")
	check("attachments without a File", "select a.name from `tabMasar Attachment` a left join tabFile f on f.name=a.file where f.name is null")
	check("time entries of another Space", "select e.name from `tabMasar Time Entry` e join `tabMasar Task` t on t.name=e.task where t.space<>e.space")
	check("time entries over 24 hours or under 1 minute", "select name from `tabMasar Time Entry` where minutes<1 or minutes>1440")
	check("logged totals that differ from valid entries", "select t.name from `tabMasar Task` t where ifnull(t.logged_minutes,0) <> (select ifnull(sum(e.minutes),0) from `tabMasar Time Entry` e where e.task=t.name and e.is_voided=0)")
	check("Action counters that differ", "select t.name from `tabMasar Task` t where ifnull(t.action_count,0) <> (select count(*) from `tabMasar Task Action` a where a.task=t.name)")
	check("members who are not users", "select m.name from `tabMasar Space Member` m left join tabUser u on u.name=m.user where u.name is null")
	check("Spaces whose owner is not a Manager", "select s.name from `tabMasar Space` s where not exists (select 1 from `tabMasar Space Member` m where m.parent=s.name and m.user=s.space_owner and m.role='Manager')")
	check("demo users with Desk access", f"select name from tabUser where name like '%%@{D.EMAIL_DOMAIN}' and user_type='System User'")
	checks["Administrator present and enabled"] = int(bool(frappe.db.get_value("User", "Administrator", "enabled")))
	counts = {dt: frappe.db.count(dt) for dt in MASAR_DOCTYPES}
	problems = {k: v for k, v in checks.items() if v and k != "Administrator present and enabled"}
	return {"ok": not problems and checks["Administrator present and enabled"] == 1, "problems": problems, "checks": checks, "counts": counts}


def fingerprint() -> dict:
	"""Read-only checksum of every demo record (name and last modification) per DocType, so a test run
	can be proven not to have changed the demonstration data."""
	import hashlib

	_guard(None, writes=False)
	manifest = _read_manifest() or {}
	spaces = list((manifest.get("spaces") or {}).values()) or ["-"]
	result = {}
	for doctype in MASAR_DOCTYPES:
		if doctype in ("Masar Task Label", "Masar Task Assignee"):
			rows = frappe.db.sql(f"select c.name, c.modified from `tab{doctype}` c join `tabMasar Task` t on t.name=c.parent where t.space in %(s)s order by c.name", {"s": spaces})
		elif doctype == "Masar Space Member":
			rows = frappe.db.sql("select name, modified from `tabMasar Space Member` where parent in %(s)s order by name", {"s": spaces})
		elif doctype == "Masar Space":
			rows = frappe.db.sql("select name, modified from `tabMasar Space` where name in %(s)s order by name", {"s": spaces})
		elif doctype == "Masar Batch":
			rows = frappe.db.sql("select name, modified from `tabMasar Batch` where name in %(b)s order by name", {"b": list((manifest.get("batches") or {}).values()) or ["-"]})
		else:
			rows = frappe.db.sql(f"select name, modified from `tab{doctype}` where space in %(s)s order by name", {"s": spaces})
		result[doctype] = [len(rows), hashlib.sha256(repr(rows).encode()).hexdigest()[:16]]
	users = frappe.db.sql("select name, modified from tabUser where name in %(u)s order by name", {"u": manifest.get("users") or ["-"]})
	result["demo users"] = [len(users), hashlib.sha256(repr(users).encode()).hexdigest()[:16]]
	return result
