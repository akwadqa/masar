# 08 — Testing & Quality Strategy

Status: **Draft for approval** · Last updated: 2026-10-27

## 1. Test architecture

| Layer | Tool | What it proves | Runs |
|---|---|---|---|
| Python unit | Frappe v16 `UnitTestCase` (no DB) | Pure logic: duration parsing, owner resolution, fractional ordering, sanitiser allow-list | Every commit |
| DocType / service integration | Frappe v16 `IntegrationTestCase` (DB, rolled back per test) via `bench --site test_site run-tests --app masar` | Invariants, transactions, services, counters, idempotency | Every commit |
| Permission tests | `IntegrationTestCase` with `frappe.set_user(...)` and a fixture of Spaces A/B, users (A-manager, A-member, B-member, AB-member, admin, planner) | Matrix in [04 §2](04-security-permissions.md#2-permission-matrix) and scenarios SEC-T01…T20, against **every path**: Masar API, `/api/resource`, `/api/v2/document`, `frappe.client.*` | Every commit; release gate |
| API contract tests | HTTP tests against a running test site (Python `requests` or Playwright `request` fixture) | Envelope shape, status codes (401/403/404/409/417), CSRF enforcement, cookie attributes | Every PR |
| Frontend unit | Vitest (+ `@nuxt/test-utils` for Nuxt-aware tests) | Resource layer (dedupe, rollback, invalidation), row-model builder, keyboard reducer, formatters | Every commit |
| Component | Vitest + Vue Test Utils where valuable (TaskList row model, inline create, time input) | Interaction logic without a browser | Every commit |
| End-to-end | Playwright against Nuxt build + Frappe test site | Real user flows, multi-user scenarios (two browser contexts), keyboard flows, deep links | Every PR (smoke), nightly (full) |
| Accessibility | `@axe-core/playwright` on main screens + manual keyboard/screen-reader passes | No critical axe violations; full keyboard operability | Every PR (axe), per phase (manual) |
| Performance | Seed script (configurable volume) + Playwright traces + server timing logs | Targets in §5 | Per phase from P3, release gate |
| Static | ruff (Python), ESLint (`@nuxt/eslint`), `nuxi typecheck`, `gitleaks`, custom grep rules (§6) | Code hygiene and banned patterns | Every commit |

Tests must be real: no skipped assertions, no mocked permission layer in permission tests, no "TODO" tests counted as passing. A test that cannot run is reported as not run.

## 2. Fixtures

`masar/tests/fixtures.py` builds a deterministic world: Spaces **A** and **B**; users `a.manager`, `a.member`, `b.member`, `ab.member` (Member in both), `planner` (Masar Planner, member of A only), `admin` (Masar Admin, no memberships); Features/Releases/Labels per Space; Batch **X** containing tasks from A and B. Every permission test runs against this world.

## 3. Regression priorities

1. Cross-Space authorization (any leak is a release blocker).
2. Data integrity invariants (owner/assignee, same-Space links, Batch Items, counters).
3. No lost input / no duplicates (inline create, comments, time entries).
4. Batch progress and history correctness.
5. Keyboard and accessibility of the Task List.

## 4. Acceptance scenarios

**AS-01 Inline task creation without duplicates**
Given I am a Member of Space A viewing its Task List,
When I type "Fix login timeout" and press Enter twice rapidly, and my network drops and recovers during the request,
Then exactly one Task "Fix login timeout" exists in Space A,
And the inline field is empty and focused for the next task,
And a reload shows the same single Task.

**AS-02 Draft preservation on failure**
Given the server returns 500 for task creation,
When I press Enter on "Draft A",
Then the row shows "Not saved — Retry / Discard" with my text intact,
And navigating away and back within the session still shows the unsaved draft,
And Retry creates exactly one Task.

**AS-03 Multiple assignees and mandatory owner**
Given a Task with no assignees,
When I assign Lina then Omar,
Then Lina is the task owner;
When I remove Lina,
Then Omar becomes the owner;
When I try (via API) to set owner to a user who is not an assignee,
Then the request fails with 417 and the data is unchanged;
When I try to assign a user who is not a member of Space A,
Then the request fails and no assignee is added.

**AS-04 Action promotion**
Given a Task "Checkout" with Action "Add coupon field" in Space A, Feature F1, Release R1,
When two users click "Promote to Task" simultaneously,
Then exactly one new Task "Add coupon field" exists in Space A with Feature F1, Release R1, no Batch, no assignees, `source_task = Checkout`,
And both users receive that same Task in the response,
And the Action shows "Promoted →" linking to it and can no longer be edited,
And both Tasks show the promotion in History.

**AS-05 Labels stay within their Space**
Given label "Backend" exists in Space A and in Space B,
When I attach Space B's label to a Space A Task through the API,
Then the request is rejected and the Task is unchanged;
When I create a label named "important" in Space A,
Then it is rejected as reserved.

**AS-06 Feature roadmap movement**
Given Feature F1 in column Next of Space A,
When a Member drags it to Now above F2 (or uses "Move to → Now" from its menu),
Then F1 is in Now before F2 after reload,
And the move is recorded in the Feature's history,
And a user without access to Space A cannot see F1 on any board.

**AS-07 Batch with multiple Spaces (security)**
Given Batch X contains 3 Tasks from Space A (1 completed) and 2 Tasks from Space B,
And `a.member` has access only to Space A,
When `a.member` opens Batch X (page, API, Task List grouped by Batch, Batch picker, search),
Then only the 3 Space A Tasks are returned,
And progress shows 1 of 3,
And no response contains Space B task ids, titles, counts, Feature/Release names or user names that are only visible through B,
And `ab.member` sees 5 Tasks and progress computed over 5.

**AS-08 Task completion and Batch progress; finishing a Batch**
Given an Active Batch X with 4 visible Tasks, 1 completed,
When I complete one Task, Then progress shows 2 of 4 without reload;
When the owner finishes X choosing destination Batch Y (Planned),
Then the 2 open Tasks are in Y, X's history shows them as Carried Over and the 2 completed as Completed,
And X is read-only,
And reopening a completed Task later does not change X's historical result.

**AS-09 Comment ownership and moderation**
Given Lina (Member) posted a comment,
When Omar (Member) attempts to edit or delete it (UI and API), Then both are rejected (403);
When Sara (Manager) deletes it, Then a "Comment deleted" placeholder remains and the body is gone;
When Sara attempts to edit it via the API, Then it is rejected.

**AS-10 Space membership change**
Given Omar is a Member of Space A, assigned and owner of an open Task T, and has an open tab on T,
When the Manager removes Omar from Space A,
Then T's owner becomes the next assignee (or none),
And Omar's next request for T, its comments, attachments (direct `/private/files` URL) and Space A lists returns 404/403,
And Omar receives no further emails for Space A comments,
And Omar's previous comments remain attributed to him.

**AS-11 Direct links respect permissions**
Given a comment link `/tasks/T?comment=C`,
When a member of T's Space opens it, Then the Task opens and comment C is scrolled into view and highlighted;
When a non-member opens it, Then a "Not found or no access" page shows and no Task data is requested successfully.

**AS-12 Release lifecycle**
Given Release R1 (Planned) with 2 open Tasks,
When a Manager marks it Released, Then a warning lists the 2 open Tasks and requires confirmation;
When R1 is Archived, Then it no longer appears in pickers and Tasks cannot be newly linked to it.

**AS-13 Task reassignment between Batches**
Given Task T is in Active Batch X,
When I drag T to the Batch Y group (or use "Move to Batch → Y"),
Then T's current Batch is Y, X's history shows T as Removed, and both groups update without reload;
When two users move T to different Batches concurrently, Then T ends in exactly one Batch and history has no overlapping current items.

**AS-14 Attachment security**
Given a private image pasted into a comment on Task T in Space A,
When a Space B-only user requests its `/private/files/...` URL, Then the response is 403 and no bytes are returned.

**AS-15 Comment notifications**
Given Space A has members Lina, Omar, Sara and Omar is mentioned,
When Lina posts a comment,
Then Omar receives one "mentioned you" email, Sara one comment email, Lina none;
And if Sara is removed from Space A before the job runs, Sara receives nothing.

**AS-16 Worklog**
Given Task T with remaining 4h,
When I log "1h 30m" and set remaining to "2h",
Then the Worklog shows my entry, T shows logged 1h 30m and remaining 2h,
And Omar cannot edit my entry but a Manager can.

## 5. Performance checks

Engineering targets (PROPOSED by Akwad; not client commitments), measured on a production-like VM with the seed dataset of **20 Spaces, 50 users, 20,000 Tasks, 60,000 Actions, 100,000 comments**:

| Interaction | Target (p95) |
|---|---|
| `tasks.list` for one Space, 50 rows, filters applied | < 300 ms server time |
| Batch view, viewer-scoped, 200 tasks | < 400 ms server time |
| Inline create → row confirmed | < 400 ms server time; optimistic row < 50 ms |
| Task panel open (cached list row → full detail) | < 200 ms to first content (from cache), < 400 ms complete |
| Task List scrolling 1,500 rows | No frame drops > 50 ms in Chrome performance trace |
| Timeline first page (30 items) | < 300 ms server time |

Method: always measured on production builds (Phase 0 showed dev builds are ~2× slower); seed command, Playwright traces, Frappe request logging with timing, `EXPLAIN` review of every list query (must use indexes in [02](02-domain-data-model.md)). Query-count assertions in integration tests guard N+1 regressions (e.g. `tasks.list` executes a fixed number of queries regardless of row count).

## 6. Static and review gates

- `rg "frappe\.get_all\(|frappe\.db\.sql\(" masar/api masar/services` → each hit must be justified with an adjacent comment and reviewer approval.
- `rg "ignore_permissions" masar/` → each hit must follow an explicit authorization call (reviewed).
- `rg "allow_guest" masar/` → only allowed list (none expected).
- No `v-html` except the `SafeHtml` component rendering server-sanitised content.
- Dependency audit (`npm audit --omit=dev`, `pip-audit`) at each phase end.

## 7. Production release gate

All of the following, with evidence linked in the release report:

1. All unit, integration, permission, contract and E2E suites green on the release commit.
2. SEC-T01…T20 all passing; manual security review of new endpoints done.
3. Performance targets met on the seed dataset, or deviations accepted in writing.
4. Axe: zero critical/serious violations on main screens; manual keyboard pass complete.
5. Backup and restore rehearsed on staging; migration (`bench migrate`) tested from the previous release.
6. Email delivery verified on staging with real SMTP.
7. Production config reviewed: `developer_mode` off, `allow_cors` unset, `ignore_csrf` unset, HTTPS only, `Secure` cookies observed.
8. Documentation (docs/, ADRs, runbook) matches the deployed implementation.

## 8. Definition of Done (per capability)

- Acceptance criteria satisfied and demonstrated in the browser.
- Backend tests (unit + integration + permission) added and green.
- Frontend tests added where logic exists; E2E for the user flow.
- Loading, empty, error and no-access states implemented.
- Keyboard operable; axe clean.
- No new unreviewed `ignore_permissions`/`get_all`/raw SQL.
- Docs/ADRs updated; completion note written with evidence (test output, screenshots).
