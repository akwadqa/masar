# 06 — Architecture Decision Register

Status: **Draft for approval** · Last updated: 2026-10-28 (ADR-059 to ADR-063 added in Phase 7)

Each ADR records context, alternatives, decision, consequences and approval needs. **Owner** says who may approve: *Akwad* (internal engineering decision) or *Client* (business decision, see [11](11-approval-questions.md)). Status values: `Accepted` (Akwad-internal, decided), `Proposed` (awaiting client), `Pending evidence` (awaiting a Phase 0 spike result).

| ADR | Title | Owner | Status |
|---|---|---|---|
| [001](#adr-001) | Technology baseline and versions | Akwad | Accepted (versions re-confirmed at install) |
| [002](#adr-002) | Repository and application structure | Akwad | Accepted |
| [003](#adr-003) | Service-layer API over generic CRUD | Akwad | Accepted |
| [004](#adr-004) | Actions as a standalone DocType | Akwad | Accepted |
| [005](#adr-005) | Dedicated comment, reaction and activity models | Akwad | Accepted |
| [006](#adr-006) | Important / My Day as Task fields | Akwad | Accepted |
| [007](#adr-007) | Contextual Space permissions | Akwad | Accepted |
| [008](#adr-008) | Task List component architecture | Akwad | Accepted (spike-verified) |
| [009](#adr-009) | Frontend resource layer | Akwad | Accepted |
| [010](#adr-010) | Task completion without stages | Akwad | Accepted |
| [011](#adr-011) | Inline creation commit policy and idempotency | Akwad | Accepted |
| [012](#adr-012) | Batch lifecycle and participation history | Client (authority Q-02) | Proposed |
| [013](#adr-013) | Release scope and statuses | Client (Q-01, Q-07) | Proposed |
| [014](#adr-014) | Manual time entry as default | Akwad | Accepted |
| [015](#adr-015) | Attachments as private Frappe Files on the Task | Akwad | Accepted |
| [016](#adr-016) | Same-origin SPA deployment and session auth | Akwad | Accepted (spike-verified) |
| [017](#adr-017) | Realtime deferred; user-room events only | Akwad | Accepted |
| [018](#adr-018) | Field-scoped optimistic concurrency | Akwad | Accepted |
| [019](#adr-019) | Rich-text editor | Akwad | Accepted (component existence verified; behaviour verified in P6) |
| [020](#adr-020) | Feature scope | Client (Q-03) | Proposed |
| [021](#adr-021) | Member removal semantics | Client (Q-10) | Proposed |
| [022](#adr-022) | Comment moderation rights | Client (Q-04) | Proposed |
| [023](#adr-023) | Interface separation: Masar Workspace and Frappe Desk | Client requirement (2026-10-27) | Accepted (implemented, verified P1) |
| [024](#adr-024) | Production deployment method on AWS | Akwad | Accepted (implemented, verified P1) |
| [025](#adr-025) | New tasks take the top position | Akwad | Accepted (P1 evidence) |
| [026](#adr-026) | Space lifecycle rules | Client (Q-06) | Implemented as **provisional** default (P2) |
| [027](#adr-027) | Business timezone policy (Asia/Qatar) | Project owner (2026-10-28) | Accepted, implemented (P2) |
| [028](#adr-028) | Space administration: creation, admin view, membership operations | Client (Q-05, Q-08, Q-10) | Implemented as **provisional** defaults (P2) |
| [029](#adr-029) | Action promotion policy (supersedes ADR-004 inheritance) | Akwad (directive P3 §5) | Accepted, implemented (P3) |
| [030](#adr-030) | Space labels: normalisation, colours, rename/delete | Akwad | Accepted, implemented (P3) |
| [031](#adr-031) | Bulk task operations: all-or-nothing with conflict detection | Akwad | Accepted, implemented (P3) |
| [032](#adr-032) | My Work, search and recent tasks: server-side authorisation | Akwad | Accepted, implemented (P3) |
| [033](#adr-033) | Keyboard map and shortcut handling | Akwad | Accepted, implemented (P3) |

---

## ADR-001 — Technology baseline and versions {#adr-001}

**Context.** The brief named Nuxt 3 and Nuxt UI v3. Verified on 2026-10-27: Nuxt 3 is end-of-life since 2026-07-31 (nuxt.com/docs/4.x/community/roadmap); Nuxt UI v3 is frozen at v3.3.7 (2025-10-23); Nuxt UI v4 (since 2025-09-23) merged the former paid Pro components and added Table/CommandPalette virtualisation (4.1), `UInputDate` (4.2) and `UEditor` (4.3). Akwad's technical authority covers version selection (client confirmation 2026-10-27).

**Decision.**

| Component | Version (verified 2026-10-27) | Pin policy |
|---|---|---|
| Frappe Framework | **v16.54.0** (released 2026-10-27; v16.53.0 was the brief's baseline) | Pin exact tag in bench; upgrade patch versions deliberately with tests |
| Python | 3.14 (Frappe v16 `requires-python >=3.14,<3.15`) | |
| Node.js | 24 LTS (Frappe v16 `node >=24`; Nuxt 4.6.3 `^22.22.3 \|\| ^24.15.0`) | `.nvmrc` / `engines` |
| MariaDB | 11.8 (Frappe v16 install docs) | Docker image tag pinned |
| Redis/Valkey | 7.x+ (Frappe requires 6+) | |
| Nuxt | **4.6.3** | exact pin + lockfile |
| Nuxt UI | **4.12.0** | exact pin + lockfile |
| Vue | 3.5.x (Nuxt 4.6.3 requires `^3.5.44`) | resolved by Nuxt |
| vue-router | 5.x (Nuxt 4.6.3 requires `^5.4.0`) | resolved by Nuxt |
| Tailwind CSS | 4.x (Nuxt UI dependency) | resolved by Nuxt UI |
| TypeScript | **6.0.3** — deviation from npm `latest` (7.0.2): `vue-tsc` 3.3.13 fails on TS 7 with `ERR_PACKAGE_PATH_NOT_EXPORTED ... './lib/tsc'` (VERIFIED in spike); TS 6.0.3 typechecks cleanly. Revisit when vue-tsc supports TS 7. | exact pin |
| vue-tsc | 3.3.13 | exact pin |
| @tanstack/vue-virtual | 3.13.49 (already installed by Nuxt UI; declared directly because Masar imports it) | exact pin |
| Package manager | npm 11 with `package-lock.json` (pnpm optional later) | lockfile committed |

**Alternatives.** Nuxt 4 + Nuxt UI v3.3.7 (supported framework, frozen UI lib, lacks virtualisation/editor); Nuxt 3 + Nuxt UI v3 (unsupported, rejected); Frappe v15 (EOL end of 2027, rejected for a new product).
**Consequences.** Component names follow v4 (`UFieldGroup`, not `UButtonGroup`); dashboard layout components are available free. Stable releases only.

## ADR-002 — Repository and application structure {#adr-002}

**Decision (as implemented, P1).** One repository (monorepo) containing:
- `backend/` — the Frappe app `masar` (`backend/pyproject.toml`, package `backend/masar/`), installed into benches by the image build (`infrastructure/docker/Containerfile`) or bind-mounted in development;
- `frontend/` — the Masar Workspace (Nuxt 4), built with `nuxt generate` and deployed as a static release behind the Caddy gateway at `/` (ADR-016/023/024);
- `infrastructure/` — `dev/` (local Docker stack), `docker/` (image), `production/` (compose, Caddy, scripts, systemd), `scripts/` (deploy/rollback);
- `docs/` — the documentation system; `spikes/` — Phase 0 evidence (not product code).

The original "repository *is* the Frappe app" proposal (CRM/Gameplan layout) was replaced because the image build installs the app from a sub-directory and the Workspace is deployed independently of the Python image.

**Why.** Backend and frontend contracts are versioned atomically in one history; infrastructure is reproducible from the same commit. **Alternative rejected:** two repositories (contract drift, double release process).

## ADR-003 — Service-layer API over generic CRUD {#adr-003}

**Context.** Generic Frappe endpoints (`frappe.client.*`, `/api/resource`, `/api/v2/document`) enforce DocPerm and hooks, but cannot express multi-record workflows (assignments + owner invariant, Batch Items, Activity, counters, notifications), Space-scoped aggregates, or idempotency.

**Decision.** The SPA talks only to whitelisted `masar.api.<area>.<operation>` methods via `/api/v2/method/...` (envelope `{"data": ...}`), plus Frappe login/logout and Masar's upload wrapper. Generic **writes** to Masar DocTypes are denied outside a service context; generic reads stay permission-filtered (see [04 §3.2](04-security-permissions.md#32-generic-endpoint-posture-adr-003)).

**Alternatives.** (a) Generic CRUD everywhere like frappe-ui `useList/useDoc` — fastest to start, but invariants and side effects scatter into the client, and protected-field rules must be duplicated; (b) generic reads + service writes — viable, but list views need joined data (assignees, labels, counts, Batch/Release names) that generic list calls would fetch with N+1 requests. Chosen: services for both, generic reads remain safe as a defense-in-depth property.
**Consequences.** More backend endpoints; one consistent contract surface that is easy to test and review.

## ADR-004 — Actions as a standalone DocType {#adr-004}

| Criterion | Child table of Task | Standalone `Masar Task Action` |
|---|---|---|
| Frequent individual edits | Every edit re-saves the Task and its whole child table; concurrent edits collide on Task `modified`; rows missing from a payload are deleted (VERIFIED) | Single-row update |
| Ordering | `idx` rewrite of all rows | Fractional `sort_order`, one row |
| Promotion lineage | Child rows cannot be Link targets cleanly | `promoted_task` unique link, `Masar Task.source_action` |
| Permissions | Parent-derived (fine) | `space` column + hook (fine) |
| Audit | Bundled into Task diff | Precise Activity events |
| Queries (counts in list) | Join on child table | Indexed `(task, sort_order)` |

**Decision.** Standalone DocType; cached `action_count`/`action_done_count` on Task for list rendering.

**Promotion workflow (decision F).** `masar.api.actions.promote(action)`:
1. Lock the Action row (`FOR UPDATE`); 404 if not readable; 403 if not writable.
2. If `promoted_task` is set → return that Task (idempotent, no error).
3. Create Task: `title` = Action title; `space`, `feature`, `release` inherited from the parent Task; `priority` = parent priority; **not** inherited: batch (planning is deliberate), labels, attributes, assignees, due date. The owner is the parent's owner (I-TASK-2); nobody is assigned automatically (owner decision of 2026-10-31). `source_task` = parent, `source_action` = Action (unique index guarantees one promotion even under races).
4. Update Action: `promoted_task`, `promoted_at`, `promoted_by`; title locked.
5. Activity: `action_promoted` on parent, `promoted_from_action` on new Task.
6. Single transaction; on any failure nothing persists. Response returns the new Task row + updated Action so the UI can link both.
The Action stays visible in the parent's list, rendered as "Promoted → <Task title>" with completion mirrored from the new Task.

## ADR-005 — Dedicated comment, reaction and activity models {#adr-005}

**Context.** Frappe `Comment` grants DocPerms only to System Manager/Website Manager and derives read access from the reference doc (VERIFIED); listing for regular users requires custom endpoints anyway; it mixes many `comment_type`s; soft deletion, edit markers, reactions per emoji and Space-scoped indexes would all be retrofits. Frappe `Version` is admin-oriented and stores whole-doc JSON diffs. Gameplan, the closest Frappe reference product, uses its own `GP Comment`, `GP Reaction`, `GP Activity` (VERIFIED in its source).

**Decision.** `Masar Comment`, `Masar Comment Reaction`, `Masar Activity` with a `space` column, own permission hooks and indexes. Frappe `Comment`/`Version` are not used for Masar records (`track_changes` off on Task).
**Consequences.** Slightly more code; complete control over permissions, pagination, soft delete and the unified timeline.

## ADR-006 — Important / My Day as Task fields {#adr-006}

| Option | Consequence |
|---|---|
| Reserved labels per Space | Must be auto-created per Space; can be renamed/deleted/duplicated; filtering needs a join; uniqueness bugs possible |
| Reserved Task fields `is_important`, `is_my_day` | Cannot be duplicated or detached from a Space; indexed boolean filters; trivially shared (same row for everyone) |
| Per-user markers table | Contradicts the confirmed shared semantics |

**Decision.** Fields on Task. Custom labels reject the reserved names.

## ADR-007 — Contextual Space permissions {#adr-007}

**Decision.** Global role `Masar User` + per-Space membership rows; enforcement by (1) `has_permission` hooks returning explicit booleans (v16 semantics), (2) `permission_query_conditions` for every list path, (3) service-level capability checks via a single `can()` matrix, (4) controller validation of links and protected fields, (5) DocShare disabled for Masar DocTypes. Details in [04](04-security-permissions.md).
**Alternatives rejected.** Global Frappe roles per Space (role explosion, no per-Space semantics); User Permissions on Space (cannot express Manager vs Member capability differences; also influences unrelated Link fields); client-side filtering (not a security boundary).

## ADR-008 — Task List component architecture {#adr-008}

**Status: Accepted** — evidence from the Phase 0 Task List spike (`spikes/task-list/`, Nuxt 4.6.3 + Nuxt UI 4.12.0, 1,500 mock tasks, headless Chromium via Playwright).

**Requirements the component must satisfy at once:** Batch group headers, Task rows, indented expandable Action rows, inline create row per group, multi-select (incl. shift-range), keyboard navigation, hover controls, drag between groups with a keyboard/menu alternative, smooth scrolling for ~1–2k rows.

**Evidence.**

| Combination | (A) native `UTable` | (B) custom `TaskList` |
|---|---|---|
| Grouping + virtualisation | Works (≈28 `<tr>` rendered for 351 model rows) | Works (≈31–38 DOM rows for 1,508 flattened rows) |
| Expanded Actions under rows | Works, **but** groups and Actions share one expanded state: every expanded group header also renders an empty `#expanded` row; grouped column is moved first (`groupedColumnMode: 'reorder'`) | Works (Action rows are part of the row model) |
| Drag between groups | **Fails**: `useSortable` reports DOM indices (incl. headers/slot rows) applied to the flat data array → wrong rows move, group order and expansion corrupted; under virtualisation `onEnd` never fired | Works (native HTML5 drag onto group header; drop target is a *group*, not a DOM index) + menu alternative |
| Keyboard (j/k, x, e, Enter→panel, Esc) | Not provided by UTable | Works |
| Shift-range select, bulk Move to Batch (`UDropdownMenu`) | Possible via row selection | Works |
| Inline create row; draft survives virtualised unmount | Not native | Works |
| Scroll (production build) | p95 16.8 ms/frame (ungrouped) | p95 16.7 ms/frame; worst frame 33–50 ms |

**Decision.** (B) a dedicated `TaskList` component: a pure, unit-tested row-model builder (group header / task / action / inline-create rows) rendered with `@tanstack/vue-virtual`, every cell composed from Nuxt UI primitives (`UCheckbox`, `UBadge`, `UAvatarGroup`, `UDropdownMenu`, `UButton`, `UInput`, `UKbd`, `UIcon`, `UTooltip`). Drag uses native HTML5 drag events targeting groups; **menu and keyboard moves are the primary accessible path** (native DnD accessibility and touch behaviour are UNVERIFIED). `UTable` (with `virtualize` where useful) is used for Releases, Batch lists/history, Worklog and member tables.
**Justification under the native-first policy.** Verified UTable limitations (shared expanded state, DOM-index drag) prevent the confirmed combination of requirements; the custom component adds product behaviour (row model, keyboard, drag-to-group), while all visual primitives remain Nuxt UI. No `sortablejs` dependency is needed.

## ADR-009 — Frontend resource layer {#adr-009}

**Decision.** A small typed layer, inspired by frappe-ui resources but built on Nuxt primitives (details in [03 §6](03-system-architecture.md#6-frontend-resource-layer)):
- `api` transport (`$fetch` instance): base URL, CSRF header, `{data}` unwrapping, error normalisation into `MasarApiError {status, type, message, fields?}`.
- `useMasarQuery(key, fn, opts)` over `useAsyncData` (keys are tuples, `dedupe: 'defer'` for idle refreshes, `getCachedData` for instant back-navigation).
- `useMasarMutation(fn, {optimistic, rollback, invalidate})` with snapshot/rollback and key-prefix invalidation.
- Domain composables (`useTaskList`, `useTask`, `useBatch`…) on top; components never call the transport directly.
**Rejected.** Importing frappe-ui (explicitly excluded by client); Pinia-based normalised entity store (unnecessary complexity at this scale; revisit only with evidence).

## ADR-010 — Task completion without stages {#adr-010}

**Decision.** `is_completed` + `completed_at` + `completed_by`. Complete/reopen via `masar.api.tasks.set_completed`. Reopen clears the audit fields and logs `reopened`. Batch progress counts `is_completed` of current items; at Batch finish the value is snapshotted to `Batch Item.completed_in_batch` so history is stable. Feature summaries show completed/total Tasks. No other states exist.

## ADR-011 — Inline creation commit policy and idempotency {#adr-011}

| Policy | Verdict |
|---|---|
| First keystroke | Rejected: creates tasks from accidental typing, then needs title updates racing the create |
| Debounced auto-create | Rejected: half-typed titles persisted; hard to cancel |
| **Enter to commit** | **Chosen** primary action; field stays open for the next task (rapid entry) |
| **Blur with non-empty title** | **Chosen**: commits so content is never lost when clicking elsewhere |
| Explicit confirm button | Shown for touch devices only |

**Mechanics.** Each draft gets a client-generated UUID (`client_request_id`). The draft lives in component state *and* `sessionStorage` until the server confirms. The optimistic row appears immediately with a pending indicator. Retries reuse the same id; the server returns the existing Task for a repeated id (unique index `(owner, client_request_id)`), so double Enter, retries and network races cannot duplicate. Empty/whitespace titles are never sent. On failure the row shows "Not saved — Retry / Discard" and keeps the text.

## ADR-012 — Batch lifecycle and participation history {#adr-012}

**Decision (decision C).** States Planned → Active → Completed (diagram in [02 §3.7](02-domain-data-model.md#37-masar-batch)). Multiple Active Batches allowed (Batches serve different cross-Space teams). A Task is in at most one Planned/Active Batch at a time (`Masar Task.batch`), with history in `Masar Batch Item`. Moving a Task between Batches closes the old item (`Removed`) and opens a new one. Finishing requires a destination for unfinished Tasks: another Planned/Active Batch (items marked `Carried Over`, new items opened) or no Batch (`Carried Over` with no successor). Completed Batches are immutable. Progress = completed/total over viewer-visible current items; historical metrics from item outcomes.
**Authority (Q-02 default).** Any Masar User may create a Batch (becomes owner); edit/start/finish/delete by owner, `Masar Planner` or `Masar Admin`; adding a Task requires write capability on that Task.
**Rejected.** Many-to-many current membership (contradicts sprint semantics, doubles progress counting); storing only `Task.batch` (loses history on carry-over).

## ADR-013 — Release scope and statuses {#adr-013}

**Proposed.** Releases belong to one Space (consistent with permissions; no cross-Space leakage in Release pages). Statuses `Planned`, `Released`, `Archived`. Releasing with open Tasks warns and lists them (viewer-visible = all, since same Space) but is allowed (Q-07).
**Alternative.** Global/product-level Releases shared across Spaces — would require Batch-like viewer-scoped aggregation and a new "product" concept the client did not request.

## ADR-014 — Manual time entry as default {#adr-014}

**Decision (decision G).** Quick manual entry in the Task panel: duration input accepting `1h 30m`, `1.5h`, `90m`, `90`; date defaults to today; optional note; optional "remaining" update in the same form. Stored as integer minutes (1–1440 per entry). Display `1h 30m`; totals in hours with one decimal in summaries. Users edit/delete their own entries; Managers any entry in their Space. Completing a Task offers a non-blocking "Log time?" toast action (no modal).
**Rejected for initial release.** Start/stop timer (needs persistence across tabs/devices, stale-timer recovery, concurrency rules) — listed as OPT-01.

## ADR-015 — Attachments as private Frappe Files on the Task {#adr-015}

**Decision.** Reuse Frappe `File` (storage, thumbnails, Content-Disposition, private path handling) with `is_private=1`, attached to `Masar Task` — including images pasted into comments and descriptions. Authorisation is inherited from the Task hook (VERIFIED chain), so revocation is immediate. Upload through `masar.api.files.upload` (capability check, MIME/extension allow-list, size limit). Comment deletion does not delete files (they remain Task attachments).

## ADR-016 — Same-origin SPA deployment and session auth {#adr-016}

**Status: Accepted** — verified end-to-end by the Phase 0 auth spike (`spikes/frappe-auth/`).
**Decision.** Nuxt with `ssr: false`, statically generated (`nuxt generate`), served from the same origin as Frappe (superseded detail: at the domain root behind the Caddy gateway — ADR-023/024) with SPA fallback; Frappe paths proxied to Frappe. Alternative packaging for hosts without nginx control: Frappe `website_route_rules` → `www/masar.html` (CRM pattern, also verified). Auth by Frappe session cookie; sign-in through the Workspace login page posting to Frappe's `/api/method/login` (implemented P1; Frappe 2FA/SSO flows are not supported by this page yet — see Phase 1 known issues); CSRF token obtained from `masar.api.session.boot`, called on start and right after login; Masar write endpoints additionally require a session CSRF token (`@masar_write`) because Frappe enforces CSRF only after the token is lazily generated (VERIFIED gap). Development: Nuxt dev server proxies Frappe paths; Frappe bench in Docker.
**Rejected.** Cross-site frontend (SameSite=Lax `sid` — VERIFIED); API key/secret tokens in the browser; Nuxt SSR (no SEO need; would require cookie forwarding and per-request isolation, adding a leak class for no benefit); generating the CSRF token in `on_session_creation` (VERIFIED to break login with 400).

## ADR-017 — Realtime deferred; user-room events only {#adr-017}

**Decision.** Phases 1–7 keep data fresh via mutation responses, targeted invalidation and refetch on window focus/reconnect. Live updates from other users are OPT-03. If enabled later, Masar publishes ids-only events to **user rooms** of currently authorised users (`frappe.publish_realtime(..., user=..., after_commit=True)`), never to doctype rooms (doctype room joins check only doctype-level permission — INFERRED from source; would expose ids to every Masar User).

## ADR-018 — Field-scoped optimistic concurrency {#adr-018}

**Decision.** See [02 §7](02-domain-data-model.md#7-concurrency-model). `masar.api.tasks.update(task, changes, base)` → 409 `MasarConflictError` with `{field, current, yours}` per conflicting field. The UI shows an inline "Changed by Lina a moment ago — Keep theirs / Use mine" resolution.
**Rejected.** Whole-document `modified` check for inline edits (false conflicts between unrelated fields); last-write-wins (silent data loss).

## ADR-019 — Rich-text editor {#adr-019}

**Status: Accepted.** `UEditor` and `UEditorMentionMenu`, `UEditorToolbar`, `UEditorSuggestionMenu`, `UEditorEmojiMenu` exist in the installed `@nuxt/ui@4.12.0` (VERIFIED in spike). Their TipTap 3 peers (`@tiptap/vue-3`, `@tiptap/starter-kit`, `@tiptap/extension-mention`, `@tiptap/extension-image`, `@tiptap/suggestion`, …) become direct dependencies in P6, pinned to versions satisfying Nuxt UI's `^3` peer ranges. Mention suggestions are limited to Space members; image paste is routed to `masar.api.files.upload`. The server sanitises all HTML with an allow-list (p, br, strong, em, s, code, pre, blockquote, ul, ol, li, a[href], img[src under `/private/files` or `/files`], span[data-type=mention]). Mention-menu behaviour, paste handling and output HTML are verified at the start of P6 before building the comment UI.

## ADR-020 — Feature scope {#adr-020}

**Proposed (Q-03).** A Feature belongs to exactly one Space; the roadmap board shows one Space at a time, with a Space filter. Rationale: stakeholders read roadmaps per product/project; Space-scoped Features keep Task→Feature validation and permissions simple. Cross-Space Features would need Batch-style viewer scoping.

## ADR-021 — Member removal semantics {#adr-021}

**Implemented in P2 (provisional, Q-10) with one deliberate change — see ADR-028.** `space_service.remove_member(space, user)`: the user loses access immediately; they are removed from assignees of open Tasks in the Space (original proposal: completed Tasks keep historical assignees); where they were `task_owner`, ownership moves to the first remaining assignee, or is cleared if none; authored comments, time entries and activity remain attributed; each affected Task gets an Activity entry. The Manager sees the affected-task count before confirming. The Owner cannot be removed (transfer first); the last Manager cannot be removed.

## ADR-022 — Comment moderation rights {#adr-022}

**Proposed (Q-04).** Authors edit and soft-delete their own comments. Managers may soft-delete any comment in their Space (moderation) but never edit another user's words. Deleted comments leave a placeholder with author and time; the body is erased. Comment edits record `edited_at` only.

## ADR-023 — Interface separation: Masar Workspace and Frappe Desk {#adr-023}

**Context.** Approved client requirement (2026-10-27): employees and Space Managers work only in the **Masar Workspace** (Nuxt 4 + Nuxt UI 4, English UI, root of `https://masar.hariri.ch`); **Frappe Desk** is reserved for company-level administrators. The separation must be enforced server-side, not by hiding links.

**Verified framework behaviour (Frappe v16.54.0 source and live tests).**
- `User.user_type` is derived from roles: "System User" if any assigned role has `desk_access = 1`, otherwise "Website User" (`core/doctype/user/user.py::set_system_user`).
- In v16, `/app` redirects (301) to `/desk`; `www/desk.py` raises `PermissionError` (HTTP 403, "You are not permitted to access this page.") for Website Users.
- Guests requesting `/desk` are redirected to `/login?redirect-to=/desk`.

**Decision.**
- Masar roles (`Masar User`, `Masar Planner`, `Masar Admin`) are created with `desk_access = 0` and re-asserted on every migrate (`masar/install.py`). Employees holding only Masar roles are Website Users and cannot open Desk.
- Company administrators receive Desk through standard Frappe roles (e.g. System Manager) **in addition to** Masar roles when they also use the Workspace. Space Manager is a contextual Space role and never grants Desk.
- Routing: the Workspace owns `/` and its routes (including `/login`); Frappe owns `/api`, `/app`, `/desk`, `/apps`, `/assets`, `/files`, `/private/files`, `/socket.io`, `/update-password`, `/printview` (Caddy gateway). The Workspace login honours Frappe's `redirect-to` and performs a full page load for Frappe-owned targets.
- The Workspace shows "Administration (Desk)" in the user menu only when boot reports `hasDeskAccess` (System User); this is a convenience, not the control.
- A signed-in user without a Masar role sees a "no access to Masar Workspace" state; every Masar API call also rejects them server-side (`require_masar_user`).

**Verification.** Integration test `test_masar_roles_do_not_grant_desk_access`; HTTP check (member → `/desk` 403); E2E `employees cannot open Frappe Desk` (local and deployed).

## ADR-024 — Production deployment method on AWS {#adr-024}

**Decision.** Official frappe_docker production pattern on a single EC2 instance with Docker Compose: custom image (Frappe v16.54.0 + `masar` from `backend/`) built on the server from a committed git ref, MariaDB 11.8.9, Redis 8.6.8, gunicorn, one worker, scheduler, websocket, Frappe nginx, and a Caddy gateway (TLS, headers, static Workspace). Details: [infrastructure](infrastructure/README.md), [deployment](deployment/README.md).
**Rejected.** Classic bench + supervisor on the host (harder rollback, host-level Python 3.14/MariaDB installs); Kubernetes (unjustified for one instance).

## ADR-025 — New tasks take the top position {#adr-025}

**Context.** P1 E2E runs showed that with a long list, an inline-create row at the bottom of a virtualised list leaves the DOM and newly created tasks appear far from the user's focus.
**Decision.** The inline create field is a fixed header row above the list; new tasks receive `sort_order = min − 1024` and appear directly under the input (newest first in manual order); pending drafts render between the input and the list. Batch groups (Phase 5) will get their own create row per group header.

## ADR-026 — Space lifecycle rules {#adr-026}

**Status.** Implemented in P2 as the **provisional** default for Q-06 (no client answer yet). Reversible: rules live in `masar/permissions.py` (`STATUS_TRANSITIONS`, `can_write_tasks`) and no data is ever deleted by a status change.

| Status | Meaning | Task content | Membership / details / status |
|---|---|---|---|
| In Progress | Active work | All members create and edit | Managers and Masar administrators |
| Completed | Finished successfully | Read-only for Members; Managers may still wrap up | Managers and Masar administrators |
| Cancelled | Stopped before completion | Read-only for Members; Managers may still wrap up | Managers and Masar administrators |
| Closed | Archived | Read-only for everyone (reopen first) | Managers and Masar administrators |

Transitions: In Progress → Completed / Cancelled / Closed; Completed → In Progress / Closed; Cancelled → In Progress / Closed; Closed → In Progress (reopen). Completed ⇄ Cancelled directly is not allowed (reopen first) so that the two meanings stay distinct. Tasks, history and (future) comments and worklogs remain visible in every status. Status changes are recorded in `Masar Activity` (`status_changed`) and use an expected-status check (409 on concurrent change). Future Batches (P5) must not accept Tasks from inactive Spaces; existing Batch participation is kept.

## ADR-027 — Business timezone policy (Asia/Qatar) {#adr-027}

**Decision (project owner, 2026-10-28).** The business timezone is **Asia/Qatar (UTC+03:00, no DST)**.
- Frappe site `System Settings.time_zone = Asia/Qatar` (set on the server, MASAR-INFRA-008; local dev site likewise). Frappe stores naive datetimes in the site timezone; the OS and containers stay in UTC.
- API: every datetime is serialised with an explicit offset (`2026-10-28T09:00:00+03:00`); date-only fields (`dueDate`, `completionDate`) are plain `YYYY-MM-DD` calendar dates and are never converted.
- Workspace: all timestamps are formatted in the business timezone delivered by `session.boot.timezone`, never in the browser's zone; "today" (overdue checks) is the Qatar calendar date; date-only values are formatted in UTC to avoid day shifts.
- Tests: backend serialiser test; frontend unit tests executed under `TZ=America/Los_Angeles` prove browser-zone independence.
- Known data note: verification rows created before the switch were written under Asia/Kolkata and read 2 h 30 min late; they are test data and were left unconverted (conversion requires approval).

## ADR-028 — Space administration: creation, admin view, membership operations {#adr-028}

**Status.** Implemented in P2 as provisional defaults for Q-05, Q-08 and Q-10.
- **Creation (Q-05):** only Masar administrators (`Masar Admin`; also System Manager) create Spaces in the Workspace. They choose the owner, who becomes the first Manager. The creator is **not** added implicitly.
- **Administrator view (Q-08):** administrators can list all Spaces and manage details, status and membership of Spaces they do not belong to, but cannot see their Tasks (404) unless they add themselves as members (recorded in Activity).
- **Membership operations** lock the Space row (`SELECT … FOR UPDATE`) and are validated by the Space controller invariants (unique members, ≥1 Manager, owner is a Manager). Members and outsiders cannot add, remove or promote anyone (403/404); generic Frappe writes to Spaces are reserved for Desk administrators (System Manager) and still pass the controller invariants.
- **Ownership transfer:** only the owner or a Masar administrator; the new owner must already be a member and is promoted to Manager; the previous owner stays Manager; `expected_owner` detects concurrent transfers (409).
- **Member removal (Q-10), changed from ADR-021:** the removed user is unassigned from **all** Tasks of the Space (open and completed). Reason: keeping former members as assignees on completed Tasks would violate the "assignees are Space members" invariant and make the Task un-saveable on reopen. History is preserved instead: each Task records an `unassigned` Activity entry, `completed_by` and authorship stay unchanged, and the Space records `member_removed`. Ownership moves to the next assignee or is cleared. The Space owner cannot be removed (transfer first). The Manager sees the impact before confirming.

## ADR-029 — Action promotion policy {#adr-029}

**Supersedes** the inheritance part of ADR-004 (which proposed no assignees). The Phase 3 directive suggested inheriting assignees and owner when valid; parent assignees are always valid because the promoted Task stays in the same Space.

| Field of the new Task | Value |
|---|---|
| Title | Action text |
| Space | Parent Task's Space |
| Priority | Parent's priority |
| Task owner | Parent's owner |
| Assignees | None (owner decision of 2026-10-31: nobody is assigned automatically) |
| Description, due date, labels, Important / My Day | Not copied |
| Feature, Batch, Release | Not copied (no approved rule; future phases) |
| Lineage | `source_task` = parent, `source_action` = Action (unique) |

**Once only.** The Action row is locked (`FOR UPDATE`); a second request waits and then returns the existing Task (`created: false`). `Masar Task.source_action` has a **unique index**, so a duplicate is impossible even if the lock were bypassed; on a duplicate-key error the service rolls back to a savepoint and returns the existing Task. Everything runs in the request transaction: on any failure the Action stays unpromoted. The Action stays visible with a "Promoted task" link, its checkbox mirrors the promoted Task's completion and it can no longer be edited. Deleting the promoted Task clears the link (the Action becomes promotable again); deleting the parent Task cascades to its Actions. History: `action_promoted` on the parent, `promoted_from_action` on the new Task.

## ADR-030 — Space labels {#adr-030}

Labels belong to one Space (`Masar Label.space`, immutable). Names are trimmed and whitespace-collapsed; uniqueness uses `label_key` = case-folded name with a **unique index `(space, label_key)`**. `create` is idempotent (returns the existing label; a concurrent duplicate insert falls back to the winner). "Important" and "My Day" are reserved (built-in Task attributes, ADR-006). Any Space member may create and apply labels (lifecycle rules apply); renaming, recolouring and deleting are Manager-only; deleting a label removes it from all Tasks of the Space in the same transaction (history records `label_removed`). Colours are Nuxt UI semantic colours (`neutral`, `primary`, `secondary`, `success`, `info`, `warning`, `error`) so labels follow light/dark themes. A Task can only carry labels of its own Space (controller check + service check).

## ADR-031 — Bulk task operations {#adr-031}

Operations: priority, add/remove label, add/remove assignee, complete/reopen; at most 200 Tasks per request; Tasks may span Spaces. **All or nothing**: every Task is authorised first (any inaccessible Task ⇒ 404 for the whole request, without naming it), lifecycle rules are checked per Space, label and assignee values are validated against every selected Task's Space (labels and assignees therefore require a single Space). For explicit overwrites (priority, completion) the client sends the values it saw (`expected`); any difference ⇒ 409 listing the changed Tasks, nothing applied. Set-style operations (labels, assignees) merge. Changes run in the request transaction; any failure rolls back every Task. Owner invariants are preserved by the Task controller. Batch and Release assignment are intentionally absent until their phases.

## ADR-032 — My Work, search and recent tasks {#adr-032}

All three use one permission-aware keyset query (`task_service._query_tasks`) restricted in SQL to the caller's **current** memberships; every filter (assigned, owned, Important, My Day, priority, due date, label, text) is applied server-side, so pages and counts never contain other Spaces. A revoked membership removes Tasks immediately (no stale assignment visibility). The command palette searches only authorised Spaces; "recent tasks" are stored in the browser as **ids only** and re-authorised through `tasks.lookup` before any title is shown.

## ADR-033 — Keyboard map and shortcut handling {#adr-033}

Task List: `j`/`k`/arrows move, `Enter` opens, `Space` completes/reopens, `x` selects (`Shift+x` extends the range), `e` expands Actions, `s` Important, `d` My Day, `c` new task, `/` search, `Escape` clears the selection; Actions: `Alt+↑/↓` reorder; global: `⌘K`/`Ctrl+K` command palette. List shortcuts are ignored while typing. The palette shortcut is registered in the **capture phase** on `document` because the open task slide-over stops keydown propagation before window-level listeners (verified in Phase 3); it works in fields and with the panel open. Every drag-free interaction also has a pointer path (buttons, menus) for touch users.

## ADR-034 — Feature and Release cardinality and Task links {#adr-034}

**Status: Accepted (provisional business defaults Q-01, Q-03).** A `Masar Feature` and a `Masar Release` each belong to exactly one Space (`space`, set once). A Task links to **zero or one** Feature (`Masar Task.feature`) and **zero or one** Release (`Masar Task.target_release`; API name `release`). Both must belong to the Task's own Space. No membership tables, no cross-Space links; cross-Space planning is the job of Batches (P5).

- Enforced in the Task controller (`_validate_planning_links`), so every write path is covered: Masar APIs, bulk updates and any generic Frappe write that gets past the permission hooks. An unknown name and a name from another Space produce the same message, so the check does not reveal other Spaces' records.
- The column is `target_release`, because `release` is a reserved word in MariaDB (found when the first migration failed on `add_index`).
- Indexes: `(feature, is_completed)` and `(target_release, is_completed)` serve progress aggregation as covering indexes, plus single-column indexes for the Task List filters.
- Changes to either link are recorded in Task history (`field_changed`).

## ADR-035 — Feature and Release progress {#adr-035}

Progress = completed linked Tasks / all linked Tasks, using the existing `is_completed` marker. It is computed per request with one grouped query per list (`COUNT`, `SUM(is_completed)` over the covering index), never stored and never computed in the browser. `percent` is `null` when there are no Tasks, and the UI shows "No tasks yet" instead of 0 %. Every linked Task is in the Feature's or Release's Space, and only members of that Space can read it, so the counts reveal nothing to other users.

The roadmap column and Task completion are **independent**:
- moving a Feature to Done completes no Tasks;
- completing every Task does not move the Feature.

Moving a Feature to Done while it has open Tasks is allowed. The UI warns first, and the server returns `openTasks` so the client can report it.

## ADR-036 — Release lifecycle (provisional) {#adr-036}

**Status: Accepted (provisional, Q-07 default).** Statuses: `Planned` (default), `Released`, `Archived`.

**Transitions** (Managers only, explicit `set_status` operation with `expected_status` → 409 on a stale view):
- Planned ⇄ Released;
- Planned or Released → Archived;
- Archived → Planned or Released (restore).

**Released.**
- Entering Released records `released_at` and `released_by`; going back to Planned clears them.
- Releasing with open Tasks is **allowed with a warning**. The UI asks for confirmation when moving from Planned; the response carries `openTasks`.
- No Task is completed and nothing external is triggered.
- Tasks can still be added to or removed from a Released Release without extra confirmation.
- Q-07 originally proposed a confirmation for late additions. That was not built, and this is recorded as an open item.

**Archived (historical).**
- The definition (name, date, notes) is read-only.
- Task links are **frozen in both directions**: no Task can be added, and a linked Task cannot be removed or moved to another Release. This is enforced in the Task controller, so bulk and generic writes are covered too.
- The Task's other fields stay editable.
- An Archived Release cannot be deleted (ADR-039). It is hidden from pickers except as a Task's current value.

Every transition is written to the Release history (`release_status_changed`).

## ADR-037 — Feature and Release permissions {#adr-037}

| Capability | Member | Manager |
|---|---|---|
| View Features, Releases, progress, linked Tasks | ✓ | ✓ |
| Link or unlink a Task (Task detail, bulk, "add an existing task") | ✓ when the Task is editable (ADR-026) | ✓ |
| Create, edit, move or reorder a Feature; delete it | — | ✓ |
| Create or edit a Release, change its status, delete it | — | ✓ |

- Space lifecycle applies to all of these, as for Tasks: In Progress allows everything above; Completed and Cancelled allow Manager wrap-up only; Closed is read-only for everyone (`require_planning_manager` reuses `require_task_write`).
- Non-members get 404 on every path. Members lacking the capability get 403.
- Generic Frappe document writes are denied outside `masar_service()` (`space_content_has_permission`). Lists, link search and `/api/resource` reads are filtered by `feature_query_conditions` / `release_query_conditions`. DocShare stays blocked.
- No global Planner role was introduced. Masar administrators who are not members do not see Features or Releases, consistent with Q-08. The Frappe `Administrator` superuser remains outside contextual permissions (04 §1.1b).
- **Difference from the Phase 0 matrix.** 04 §2 listed Feature creation and moves for Members. Phase 4 implements the directive's default (Manager-only definitions and lifecycle) and records the question as pending.

## ADR-038 — Roadmap ordering and movement {#adr-038}

- **Ordering.** Each Feature has a `sort_order` (Float) within its column; the list is ordered Now, Next, Later, Done, then `sort_order`, then name.
- **Moving.** `features.move(feature, roadmap, before, after, expected_roadmap)`:
  - The client sends the Features directly above and below the drop position, and the column it saw the Feature in.
  - The server locks the Feature and the target column, checks `expected_roadmap` (409 if someone moved it first) and checks that the neighbours are still adjacent in that column (409 otherwise).
  - It places the Feature at the midpoint. If precision runs out, or another move took the same slot, the column is renumbered, so positions are never duplicated.
- **Menu and keyboard.** A move to another column appends the Feature at the bottom.
- **Frontend.** The move is applied optimistically: cards appear where they were dropped and roll back on failure. The server's answer is authoritative, and conflicts refresh the board.
- **Library.** Drag and drop uses `vue-draggable-plus` 0.6.1 (SortableJS bundled; `group` gives cross-list moves, verified in the installed source and by E2E). It was chosen over VueUse `useSortable`, which only reorders a single list.
- **Accessible alternatives.** Every card has:
  - a menu: Move to Now / Next / Later / Done, Move up / down;
  - keyboard moves: `Alt+←/→` changes column, `Alt+↑/↓` changes position, `Enter` opens the card;
  - an `aria-live` announcement after each move.

  Dragging is paused while the board is filtered by search.

## ADR-039 — Deletion and archival {#adr-039}

Deleting a Feature or Release **never deletes Tasks**.

- **Without linked Tasks:** a Manager can delete it.
- **With linked Tasks:** the request is refused (409 with the count) unless the Manager explicitly chooses `detach=true` after a confirmation. The links are then cleared Task by Task in the same transaction (each Task records the change in its history), and the record is deleted.
- **Archived Releases** cannot be deleted. For history, archiving is the recommended path, and the confirmation dialog says so.
- The record's own history is removed with it. A `feature_deleted` / `release_deleted` entry is written to the Space history with the title and the number of detached Tasks.
- Controllers (`on_trash`) refuse deletion while Tasks are linked, so a generic delete cannot leave dangling links either.

## ADR-040 — Release version uniqueness {#adr-040}

- **Normalisation.** Release names are trimmed and internal whitespace is collapsed. The uniqueness key `release_key` is the case-folded normalised name, enforced by a **unique index `(space, release_key)`** and checked in the controller for a clear message.
- **Effect.** `v1.0`, `V1.0` and ` v1.0 ` are the same Release in one Space, while other Spaces may reuse the name. No version format (such as SemVer) is imposed.
- **Concurrent creation.** A concurrent duplicate insert is caught at the index, rolled back to a savepoint and returned as the same `DuplicateEntryError` message.
- **Status code.** `DuplicateEntryError` is HTTP 409. The Workspace treats it as a validation message (shown inline) rather than as an edit conflict.

## ADR-041 — Retrying writes after snapshot-isolation conflicts {#adr-041}

**Context.** MariaDB 11.8 enables `innodb_snapshot_isolation` by default, and Frappe uses REPEATABLE READ. When two requests change rows that both lock (for example, concurrent roadmap moves into one column), the waiting transaction's locking read fails with error 1020 ("Record has changed since last read"). Frappe maps this to `QueryDeadlockError`, so the user got an HTTP 500. The Phase 4 performance run found it: 5 of 10 concurrent moves failed. The same class of error had already appeared once for Task Actions in an earlier session's Error Log.

**Decision.** `@masar_write`, the single guard for every Masar write endpoint, retries the whole write up to 5 times for HTTP requests:
- On each retry it rolls back, clears per-request caches and waits with jittered backoff.
- The optimistic concurrency checks (`base`, `expected_*`) run again on every attempt, so a retry never overwrites a newer value silently. Stale input still gets a 409.
- Calls without an HTTP request (tests, `bench execute`) are not retried, because rolling back would discard the caller's outer transaction.
- Masar writes have no external side effects (no e-mail, no external calls), so a retry is safe.

**Result.** After the change, 10 of 10 concurrent moves succeed, with no duplicate positions. Covered by `TestWriteRetry` and the performance script.

## ADR-042 — Transaction retry policy, idempotency and concurrent mutation guarantees {#adr-042}

**Status: Accepted (Phase 5 audit of ADR-041).**

**What is retried.**
- Only `frappe.QueryDeadlockError` is retried. Frappe raises it for MariaDB 1213 (deadlock) and 1020 (snapshot-isolation conflict); in both cases the transaction was aborted, so nothing partial survives.
- `@masar_write` makes up to 5 attempts for HTTP writes, with jittered backoff (10–40 ms × attempt).
- Before each attempt it rolls back, which also discards queued after-commit work such as realtime events, and resets per-request caches.
- Authorization, the Space lifecycle and stale-data (`base` / `expected_*`) checks all run again on every attempt.

**What is not retried.**
- Lock-wait timeouts (1205, after `innodb_lock_wait_timeout` = 50 s): retrying would stall the request again.
- Authorization failures, validation errors and 409 conflicts.
- Calls without an HTTP request (tests, `bench execute`), whose outer transaction must survive.

**Reporting.**
- Exhausted retries and timeouts return **503 `MasarBusyError`**: "nothing was saved; try again". Before this change both were raw HTTP 500s.
- Every retry is logged to `logs/masar.retry.log` with the method, attempt number and outcome. The logger level is set explicitly, because Frappe's site loggers default to ERROR outside the development server.

**Nesting.** There is exactly one retry layer: whitelisted endpoints are not called from other endpoints, and services do not retry.

**Lost responses and idempotency.**
- **Task creation** (`client_request_id`) and **Batch creation** return the original record on a repeat. Reusing a key for a different Space, title or Batch is rejected with 422 `MasarRequestReuseError`. Before the fix, a reused Task key silently returned a Task from another Space.
- **Start and finish** take a request id. A repeat returns the same result without new history. A finish replay is honoured only for the user who finished the Batch.
- **Set-style operations** (assignment, move, labels) are idempotent by nature.
- **External side effects:** Masar writes have none (no e-mail, no external calls), so a retried transaction cannot send a duplicate notification.

**Known gap.** Feature creation has no request id; a user repeating the request after a lost response can create a second Feature with the same title (visible, deletable). Recorded as an open item.

**Concurrent mutation guarantees.**
- Single-row edits use field-scoped optimistic concurrency.
- Moves lock the moved rows (roadmap columns, Tasks).
- The final guards are database unique indexes: `current_task` on Batch Items, `(space, release_key)`, `(owner, client_request_id)`.

**Amendment (Phase 6).**
- **Production finding.** With truly parallel web workers, two simultaneous creates with the same request id could still fail. The loser hits the unique index but cannot see the winner's committed row from its REPEATABLE READ snapshot.
- **Fix.** Idempotent creates (Task, comment, Feature, label, Batch, Action promotion) now raise the transient-conflict signal in that case (`concurrent_duplicate()`). The single retry layer re-runs the request from a fresh snapshot and returns the winner.
- **Verified.** On production, 60 same-key creates in 10 parallel rounds all returned 200 with one comment per round.
- **Feature creation** now takes a request id too, which closes the Phase 5 gap.

## ADR-043 — Batch scope, ownership and authority {#adr-043}

**Status: Accepted (provisional default for Q-02).**

**Scope and creation.**
- A Batch is cross-Space and has no `space` field. Each Task keeps its single Space; joining a Batch never changes it, and Features and Releases stay Space-scoped.
- Any user who is a **Manager of at least one Space** may create a Batch and becomes its `batch_owner`.

**Planning authority.** Changing metadata, adding or removing Tasks, starting and finishing require that the user is the owner **and** a Manager of every Space with Tasks currently in the Batch (`has_full_scope`). Adding a Task also requires Manager write access to that Task's Space, so a new Space joins the scope only through someone who manages it. A Space Manager gains no authority over a Batch merely because their Space's Tasks are in it.

**Members.** Members view and work on their own Tasks (completion, fields) under the existing rules. They cannot plan Batches.

**Transfer and recovery.**
- The owner may transfer the Batch to an active Space Manager who manages every Space in it. The candidate list comes from an authority-scoped endpoint.
- If the owner loses that authority (role change, membership removal, disabled account), a user who manages every participating Space may **take over** the Batch.
- Finished Batches are history and cannot be transferred.

**No new roles.**
- No global Planner role.
- Masar administrators gain nothing over Batches.
- The Frappe `Administrator` superuser remains outside contextual permissions (04 §1.1b).

## ADR-044 — Current versus historical Batch membership {#adr-044}

**One source of truth.**
- Every participation is a `Masar Batch Item` row: Batch, Task, Space copied from the Task, timestamps, outcome and finish snapshot.
- The **current** Batch of a Task is the row whose `current_task` equals the Task. It is set only while the Batch is Planned or Active, and it has a **unique index**, so a Task can never be in two current Batches. The database guarantees this even if the service check were bypassed.
- Phase 0 proposed an additional `Masar Task.batch` field (invariant I-BI-2). It was **not** added: a second copy could drift. Filters (`batch` = name / `none` / `any`) and row badges read the Batch Item rows through indexed subqueries.
- Finishing writes only Batch Items, never Task records.

**Removing a Task from a Batch.**
- From a Planned Batch, the row is deleted: this is planning, not history.
- From an Active Batch, the row becomes `Removed`, with time and actor (a scope change).

**Immutability.** Rows of a Finished Batch cannot be changed (controller).

**Deleting a Task.**
- Planned planning rows go.
- Open rows of an Active Batch become `Removed`.
- Finished history rows keep their outcome and Space, with the Task cleared, so finished results never change.

**Planned Batches** can be deleted only when they are empty.

## ADR-045 — Cross-Space Batch visibility {#adr-045}

**Status: Accepted (restrictive provisional policy; replaces the Phase 0 "all Masar users see Batch names" proposal).**

**Who can discover a Batch.** Its owner, and members of a Space that has or had Tasks in it. Users with neither get 404 on every path:
- list, detail, tasks, history;
- the `batch` filter;
- link search;
- `/api/resource`.

**What a visible Batch shows.**
- **Shared metadata:** name, dates, status, the owner's name, and start and finish times with the actors' names. It contains no Space-specific information.
- **Task-derived data:** rows, counts, progress, scope-change counts, history, carry-over links, and finish results. All of it is computed **only from the viewer's own Spaces**. A viewer of Space A in a Batch with 7 Tasks of A and 5 of B sees 7, never 12, and nothing names B.
- **Owner-only:** only the owner is told, without counts, that some current work is outside their access, so they can transfer the Batch.

**Generic API restrictions.**
- `Masar Batch Item` rows are readable only by members of the row's Space.
- The request ids and the finish destination are permlevel-1 fields, hidden from generic reads. Otherwise another viewer could replay a finish, or learn the name of a Batch they cannot see. This was found by an automated security review during Phase 5 and fixed before deployment.

## ADR-046 — Batch lifecycle, planning and Active Batch rules {#adr-046}

**Status: Accepted (provisional).**

**Terminology.** The lifecycle is **Planned → Active → Finished**. "Finished", not Phase 0's "Completed", because ending a Batch does not complete its Tasks. The same three words are used in the database, API, UI and tests.

**Planned.** The owner edits the name and dates (409 on a stale `base`), adds and removes Tasks, and starts the Batch explicitly. Batches never auto-start on their date. A Planned Batch can be deleted only when empty.

**Active.** Name and dates are fixed. Tasks can still be added or removed, recorded as scope changes (`added_after_start`, `Removed`). Several Batches may be Active at once; the only limit is one current Batch per Task.

**Finished.** Read-only, with no reopening (needs an approved policy).

**Moves** (`move_tasks`, bulk `set_batch`, Task detail selector, planner):
- All or nothing, for at most 200 Tasks from any number of Spaces.
- Every Task must be visible (otherwise 404 for the whole request), in a Space the caller manages and may write.
- The source and target Batches must both be managed by the caller.
- Task rows are locked, `expected` detects stale views (409), and the unique `current_task` index is the final guard.

**Grouped Task List.**
- Batch header → Task rows → Action rows, in the existing virtualised list. Rows are keyed by identity, so a collapse or a refresh never moves the selection.
- Moves use the destination menus (bulk bar, Task detail). Dragging rows into groups was not built: the selectors cover the need, and drag inside a virtualised list is where the rejected table implementation failed before.

## ADR-047 — Batch dates and presets {#adr-047}

- **Presets.** Dates are calendar dates in the business calendar (Asia/Qatar). **One Week = 7 inclusive days** (Monday → Sunday); **Two Weeks = 14**. For example, 2 Nov 2026 + One Week ends on 8 Nov.
- **Calculation.** Both sides use pure date arithmetic: Frappe `add_days` on `date`, and `@internationalized/date` `CalendarDate.add` in the Workspace. There are no `Date`/UTC conversions, so no day can shift. Unit tests cover month, year and leap-day boundaries.
- **Validation.** Dates stay editable while Planned; the end may not be before the start.
- **Server.** The clock stays UTC, and timestamps are shown in Qatar time (ADR-026a).

## ADR-048 — Batch progress semantics {#adr-048}

**Base rule.** Progress = completed / total of the Tasks **the viewer may see**. On a Space's Active Batches tab, the base is that Space's Tasks only. `percent` is null when there are no Tasks.

**By status.**
- **Planned / Active:** current participation, live completion.
- **Finished:** participation at finish (outcomes Completed, Carried Over and Returned), with the completion **snapshot** (`completed_at_finish`). Reopening or completing a Task later never changes it.

**Scope changes.** Counted separately and scoped the same way: Tasks added after start, and Tasks removed during the Batch. A Task that leaves and returns has two participation rows; that is history, not duplication.

**Performance.** Two grouped queries per list, served by covering indexes. No velocity, burndown or analytics.

## ADR-049 — Finishing a Batch {#adr-049}

`finish(batch, carry, destination, request_id)` runs in one transaction:
1. Lock the Batch. A replay of the same `request_id` by the finishing user returns the stored result; any other finish of a Finished Batch is a 409.
2. Check authority (ADR-043), then the Active state. Validate the destination: a Planned Batch the caller manages, locked.
3. Lock the current participation rows. Freeze the snapshot and outcome on each (Completed / Carried Over / Returned) and clear `current_task`.
4. Insert the carried rows into the destination (`carried_from`).
5. Mark the Batch Finished with actor and time, and write one `batch_finished` history entry.

Any failure rolls everything back. A transient conflict retries the whole transaction (ADR-042).

**Tests.**
- Five simultaneous finish requests with two request ids give one result. The winning id's repeats all return it; the other id gets 409.
- No duplicate rows or history.
- Results stay stable after Tasks are reopened.

The finish dialog shows the completed and unfinished counts (for the full-scope owner only) and the carry choice, and keeps one request id per dialog.

## ADR-050 — Unfinished Task handling {#adr-050}

The person finishing **must choose**:
- **Unbatched:** unfinished Tasks return to unbatched work.
- **Batch:** they move to a chosen **Planned** Batch that the person manages.

Rules:
- Tasks are never duplicated or completed, and never silently dropped.
- Tasks of **Closed** Spaces are read-only, so they always return to unbatched work; the dialog warns about this.
- Completed Tasks stay Completed in the frozen result.
- Moving into an Active Batch at finish is not offered: it would mix scope-change accounting.

## ADR-051 — Task comments and moderation {#adr-051}

**Status: Accepted (moderation is a provisional policy, Q-04).**

**Model.** A dedicated `Masar Comment` (Task, Space, author, sanitised content, mentions, edited, deleted and notified times, request id) instead of Frappe's `Comment`. Frappe's model is shared by every DocType and cannot carry Space-scoped permissions, moderation rules, mention validation or reactions without overriding its behaviour globally.
- **Author:** always the session user.
- **Reads:** follow the Task's Space membership.
- **Writes:** follow the Space lifecycle (ADR-026).

**Who may do what.**
- **Authors:** edit their own comments, with field-level conflict detection on `modified`.
- **Deleting:** authors delete their own comments; Space Managers may also **delete, never edit**, other members' comments (moderation).

**Deletion is soft.**
- The content, mentions, reactions and the comment's files are removed.
- The row keeps author, times and who deleted it.
- A `comment_deleted` history entry records whether it was moderation.

**Creation.** Idempotent per `(author, client_request_id)` (ADR-042). A thread is one chronological list; there is no nesting.

**Generic APIs.** Generic Frappe writes are denied outside Masar services, and lists are filtered to member Spaces.

## ADR-052 — Rich-text storage and sanitising {#adr-052}

**Storage.** Comments are stored as HTML rebuilt **server-side** from an allow-list with `nh3` (the Rust `ammonia` library), whatever the editor sends.

| Kept | Rule |
|---|---|
| `p`, `br`, `strong`/`b`, `em`/`i`, `s`, `code`, `ul`, `ol`, `li` | — |
| `a` | `http`, `https` and `mailto` only; `rel="noopener noreferrer nofollow"` forced |
| Mentions | `span[data-type=mention][data-id][data-label]`, kept only if `data-id` is a **current member** of the Task's Space; otherwise the mention degrades to plain text |
| `img` | Only `/private/files/…` URLs that belong to this comment's own uploads |

**Removed.** Scripts and styles (with their content), event handlers, `style`, iframes, SVG and MathML, and unknown URL schemes.

**Limits.** Empty comments are refused; input is capped at 100 kB and stored HTML at 50 kB.

**Editor.**
- The Workspace uses Nuxt UI 4's `UEditor` (TipTap) with a limited toolbar. Its built-in link handler uses `window.prompt`, so links use an inline popover instead.
- The default mention markup in `UEditor` **drops the user id**, so Masar renders mentions with `data-id` and `data-label` and keeps them tied to the account.
- Content is rendered with `v-html` only after this server sanitising. Malicious payloads are covered by `test_L_xss_payloads_are_neutralised` (11 payloads) and the browser test.

## ADR-053 — Reactions {#adr-053}

**Set.** A fixed, compact set: 👍 ❤️ 🎉 😄 👀 ✅, stored by key.

**Uniqueness.** One row per (comment, user, emoji), backed by a unique index. Adding is set-style, so a concurrent duplicate collapses into the existing row. A user can only add or remove their own reactions.

**Display.** Counts, "mine" and who reacted are computed per page with one query.

**Lifecycle.** Reactions follow the comment's permissions and lifecycle, and are removed when the comment is deleted.

## ADR-054 — Private attachments and file access {#adr-054}

**Storage.**
- Files are stored as **private** Frappe `File` records attached to the Masar Task, which is the security boundary.
- `Masar Attachment` records the Task, Space, optional comment, size and detected type.
- Downloads use Frappe's `/private/files` handler, proxied by Caddy; there is no other file path.
- The public `/files/` alias cannot serve them, because private files live outside the public folder (verified on production: 404).

**Access follows current Space membership.**
1. **Deny-only `File` permission hook.** Files of Masar Tasks are readable only by current members.
2. **`File.is_downloadable` extension** (Frappe's `extend_doctype_class` hook; core untouched). Frappe's download path calls the File module's own permission function, which **always allows the uploader** and ignores app hooks. Without the extension, a removed member could keep downloading what they uploaded. This was found and fixed during Phase 6.
3. **`File` query condition.** Generic file lists exclude other Spaces' Task files.

**Revocation guarantee.** After a member is removed, every new request is refused:
- the direct URL and saved links (403);
- the timeline and deep links (404);
- generic `File` and `Masar Attachment` APIs (filtered or refused).

The gateway sends `Cache-Control: private, no-store` for private files, replacing Frappe's one-hour private cache, so browsers keep no reusable copy. A copy the user already saved on their device cannot be recalled.

**Deletion.** Files go with their comment, their Task, or explicit removal by the uploader or a Space Manager.

## ADR-055 — Upload validation and composer uploads {#adr-055}

**Checks.**
- An upload needs Task write access, including the Space lifecycle.
- Size is limited to 10 MB by default (`masar_attachment_max_mb` site setting).
- The type is decided from the **content signature**: PNG, JPEG, GIF, WebP, PDF, ZIP-based Office/ODF and ZIP, or UTF-8 text with no NUL bytes. The extension must agree. The browser's MIME type is ignored.
- SVG and HTML are refused.
- File names are reduced to a safe base name.

**Composer uploads** (paste, drop, or the paperclip button) are created as *pending* and bound to the comment on submit. Only the uploader's own pending files for the same Task can be bound, which blocks cross-Task injection. Pending files older than 24 hours are removed by a daily scheduler job.

**Drafts.** The composer keeps its draft, pending files and request id in local storage. Closing the panel, a failed send or an expired session therefore loses nothing, and sending again cannot duplicate the comment.

**Not supported.** Editing a comment does not add new files.

## ADR-056 — Comment notifications {#adr-056}

**Trigger.** One job is enqueued **after the comment transaction commits**, with the job id derived from the comment and deduplicated. It is never enqueued for a rolled-back or repeated create.

**Delivery.**
- The job claims the comment (`notified_at`).
- It rebuilds recipients from **current** membership: enabled users only, one per account.
- For each recipient it writes a `Masar Comment Notification` row (unique per comment and recipient) and **re-checks membership immediately before sending**.
- It then sends a Frappe Email Queue entry synchronously and records Frappe's own result.

**States.** Event created (the comment) → Queued → Sent / Failed (with the error) / Skipped (no longer a member).

**Message.**
- Mentioned members receive the "mentioned you" message **instead of** the general one, never both.
- The content is the author, Task title, a 280-character text preview and a direct comment link. There are no attachments and no Space details.

**Recipient scope.**
- **Implemented:** every current member, including the author, per the Phase 6 directive.
- **Conflicts with:** the Phase 0 catalogue (MASAR-COLLAB-004 said "except the author").
- **Status:** recorded as decision Q-P6-1.

**Delivery status.**
- **Development:** Mailpit receives one message per recipient (verified).
- **Production:** without SMTP, every attempt is recorded as Failed ("Please setup default outgoing Email Account"), and no external mail is sent.

## ADR-057 — Unified Task timeline {#adr-057}

**Read model.** `comments.timeline` is a read model over existing records: `Masar Comment` and the Task's `Masar Activity` entries. Nothing is copied.

**Ordering and paging.**
- Order is `(creation, source, name)`, which is stable for identical timestamps.
- Keyset cursors page in both directions: `before`, `after`, or `anchor`.
- An anchor (deep link) returns the page starting at that comment, at any depth, without loading the whole thread.

**Views.**
- All / Comments / History / Worklog.
- History hides `comment_added` and `comment_edited`; the comments themselves are shown instead. Deletion remains visible as moderation evidence.
- Worklog returns `worklogAvailable: false` and the UI states that time entries arrive later, so Phase 7 only adds a source.

**History payloads.** Rebuilt from resolved references only:
- user names;
- Feature, Release and label titles, which are in the same Space by invariant;
- Batch titles, only when the Batch is visible.

Unresolvable references read neutrally ("a Batch", "(deleted label)"); nothing is invented. Times are shown in Qatar time.

## ADR-058 — Keeping discussions fresh {#adr-058}

**Approach.**
- The timeline re-reads its newest page every 20 s while the page is visible, and on window focus, through the normal permission-checked HTTP API.
- New comments are appended and changed comments replaced.
- The poster sees their own comment immediately.

**Why not websockets.** Frappe's socket.io is not used for this:
- the Workspace has no socket client;
- room authorisation would have to mirror Space membership, including revocation after subscribing;
- polling one small, indexed page (about 5 ms server time) is reliable and leaks nothing.

**Limitation.** Another member's comment appears within about 20 s, not instantly.

## ADR-059 — Deployment consistency: one commit, verified before activation {#adr-059}

**Status: Accepted (Phase 7, corrective work §3.1).**

**Context.** In Phase 6 the first backend deploy silently did not deploy. For under two minutes the new Workspace ran against the old backend. Two things caused it:
- the daily image-retention job removed the build directory of a deploy in progress;
- the deploy output was filtered (`grep`) and the pipeline status was lost, so the failure was hidden.

**Decision.** Releases go through `infrastructure/scripts/release.sh`, which releases one commit (HEAD of a clean tree) in a fixed order with hard gates:
1. **Preconditions:** clean working tree; the commit is resolved.
2. **Build:** the Workspace is built from that commit, with `release.json` (commit, build time) and `api-manifest.json` (every `masar.api.*` method the Workspace calls).
3. **Backup:** a verified Mac backup (checksums plus archive integrity).
4. **Stage:** the Workspace release is uploaded but **not** activated.
5. **Backend:** the image `masar/app:<commit>` is deployed (migrations, health).
6. **Identity:** the running backend image tag must equal the commit, and `masar.api.session.version` must report the same commit.
7. **API contract:** every method in the manifest must exist in the backend's whitelisted method list.
8. **Activate:** the staged Workspace is activated, then the public `/release.json` must report the same commit and `GET /` must return 200.

**Supporting rules.**
- Any failure stops the release (`set -euo pipefail`, no output filtering) and names the failed step. Before step 8 the previous Workspace stays active.
- Full logs go to `logs/deploy/<stamp>/` (git-ignored, mode 700); they contain no secrets.
- `deploy-backend.sh` writes the commit into the image (`build_info.json`) and holds a `/opt/masar/.deploy-in-progress` marker. Image retention skips its run while a marker younger than 120 minutes exists, and never removes a build directory modified in the last 120 minutes.
- **Compatibility rule:** backend changes stay backward compatible with the previous Workspace (additive APIs and schema), because the backend is switched first.

**Rollback.**
1. Re-activate the previous Workspace release (`deploy-frontend.sh --activate <previous-id>`).
2. Then run `rollback-backend.sh <previous-tag>`.

Rolling back after an additive migration leaves the new table and column unused; nothing is dropped.

**Alternatives rejected.**
- Blue/green stacks: a second full stack would not fit the single small instance.
- Frontend first: it would expose calls to methods that do not exist yet.

**Verified (Phase 7).** On its first use, gate 7 stopped a release whose version endpoint under-reported methods; the Workspace stayed on the previous release. The fix was released through all eight gates.

## ADR-060 — Time entries: duration storage, work date and ownership {#adr-060}

**Status: Accepted (Phase 7). Amends ADR-014.**

**Decision.**

| Aspect | Rule |
|---|---|
| Record | `Masar Time Entry`: Task, Space (copied from the Task, validated), worker, work date, minutes, note, correction and void fields, client request id |
| Duration | Integer minutes, 1–1440 per entry (one entry is work on one day). Accepted input: `90`, `90m`, `1h`, `1h 30m`, `1h30m`, `1.5h`, `1:30`. Decimal hours must give whole minutes (`1.33h` is refused, never rounded silently). Shown as `1h 30m`. |
| Worker | Always the signed-in user. Nobody logs time on another person's behalf. |
| Work date | A Qatar business date (`Asia/Qatar`, the system time zone). It defaults to Qatar's "today" whatever the browser's time zone; the Workspace takes "today" from the server's business time zone. Future dates are refused. There is no historical cutoff (provisional, Q-P7-2). |
| Note | Optional plain text, at most 1,000 characters |
| Totals | `Masar Task.logged_minutes` is a cache, recomputed as `SUM(minutes)` of non-voided entries in the same transaction as every change, under the Task row lock (`FOR UPDATE`). Totals are never computed in the browser. |
| Idempotency | Unique `(owner, client_request_id)`. A repeat returns the same entry (`created: false`). Reusing a key for different content returns 422. A duplicate-key race uses the ADR-042 retry. |
| Access | Read: Space members (404 otherwise). Log: users who may edit Tasks in the Space; Completed and Cancelled Spaces allow Managers only (the existing Task rule); a Closed Space allows nobody. Completed Tasks accept time. |
| Generic APIs | `/api/resource` writes are denied by hook; lists are filtered by Space membership. |

**Changes from ADR-014.**
- Managers no longer edit others' entries (see ADR-061).
- No completion prompt: the Phase 7 directive asked for none, and Q-12 stays open.
- Summaries show `1h 30m` rather than decimal hours.

## ADR-061 — Correcting and voiding time {#adr-061}

**Status: Accepted (Phase 7). Manager moderation is provisional (Q-P7-1).**

**Decision.**
- **Corrections:** only the author corrects their own entry, and only its duration, work date and note. The edit is conflict-checked (`base_modified`) and recorded as a `time_edited` history event with before/after values. Nobody, Managers included, rewrites another person's time.
- **Voids:** the author may void their own entry, with an optional reason. A Space Manager may void anyone's entry in the Space, with a **required** reason (moderation). A voided entry:
  - stops counting towards the total;
  - stays visible, struck through, with who voided it, when and why (`time_voided`);
  - can no longer be corrected.

  Voiding again is a no-op.
- **Hard deletion:** none in the Workspace. Entries are removed only when their Task is deleted (cascade).

**Why void rather than delete.** Effort history should be auditable. A deleted entry would silently change past totals with no trace.

## ADR-062 — Remaining estimate semantics {#adr-062}

**Status: Accepted (Phase 7).**

**Decision.**
- **No estimate versus zero:** `Masar Task.remaining_minutes` plus a `has_remaining_estimate` flag, because a Frappe `Int` column cannot hold NULL. "Not estimated" and "0m left" are therefore different states.
  - An additive patch marks existing Tasks with a positive value as estimated.
  - Tasks stored with 0 become "not estimated", which is what 0 meant before Phase 7.
- **Never automatic:** logging time never reduces the estimate, and an estimate of 0 never completes the Task.
- **Setting it:**
  - from the Time row in Task details; or
  - atomically with logging ("Update remaining estimate"): if the stored estimate differs from the one the user saw (`base_remaining`), the whole operation fails with 409 and nothing is logged.
- **Limits:** 0 to 10,000 hours.
- **History:** every change is recorded as `field_changed remainingMinutes` (set, changed, cleared).

## ADR-063 — Worklog inside the Task timeline {#adr-063}

**Status: Accepted (Phase 7). Extends ADR-057.**

**Decision.**
- **Item kind:** time entries are a third timeline item kind (`time`), alongside comments and history. They appear in the **All** and **Worklog** views, ordered by when they were logged, with the same stable cursor pagination.
- **No duplicates:** `time_logged` history events are recorded for audit but hidden from the timeline, so each entry appears once. Corrections and voids appear in **History** as sentences.
- **Comments view:** shows no time entries.
- **Worklog view:** has no comment composer. Its empty state offers **Log time** to users who may log.
- **Payload:** each entry carries its own permissions (`canEdit`, `canVoid`), computed on the server for the viewer.

## ADR-064 — Notification list, e-mail and push derived from history {#adr-064}

**Status: Accepted (client revision 5). Extends ADR-056.**

**Context.** The client asked for a notification list (the bell) with read state for assignment, ownership, Overdue, Space membership and ownership, and mentions, each also sent by e-mail, and for push notifications in the installed app.

**Decision.**
- **Source:** every one of these changes already writes one history entry (`record_activity`) on every path (single and bulk edits, removal of a member, the Overdue job). `inbox_service.from_activity` turns those entries into `Masar Notification` rows in the same transaction, so a notification exists exactly when its change does. Comments and mentions come from `comment_service.create`.
- **Personal records:** a notification is readable only by its recipient and written only by services. Entries about a Space disappear from the list once the person leaves that Space. Nobody is notified of their own change. Assigning someone to a Task without assignees also makes them the owner, but produces one entry, not two.
- **E-mail:** sent through Frappe's Email Queue with one template (`templates/emails/masar_notification.html`; Frappe renders e-mail templates without autoescaping, so every value is escaped in the template). Comment and mention e-mails keep the ADR-056 pipeline, which now uses the same template. Each person can turn Masar e-mails off (`emailNotifications` preference); the list is kept either way.
- **Push:** Web Push with no payload, signed with a per-site VAPID key (`cryptography`, already a Frappe dependency; no new package). A push only wakes the service worker, which reads the newest unread entries with the person's own session. No notification text passes through browser vendors' push services, and nothing stale or no longer permitted is shown. Endpoints must belong to the browser vendors' push services; gone endpoints are removed.
- **Service worker:** `/masar/sw.js` (served by `masar.pwa.ServiceWorkerPage`, `hooks.page_renderer`), push only. It caches nothing and handles no fetches: offline use was explicitly declined by the owner.

