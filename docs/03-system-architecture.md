# 03 — System Architecture

Status: **Draft for approval** · Last updated: 2026-10-27

Masar is a **modular monolith**: one Frappe custom app containing the domain, its services and API, plus a statically built Nuxt SPA served from the same origin. No microservices, message buses, or separate API gateways.

## 1. High-level architecture

```mermaid
flowchart TB
    subgraph Browser
      SPA[Nuxt 4 SPA · Nuxt UI 4\nssr: false · served at /]
    end
    subgraph Server["Single origin: https://masar.example.com"]
      NGINX[nginx]
      subgraph Frappe["Frappe v16 bench"]
        WEB[gunicorn: Frappe web\n/api · /login · /private/files · /masar SPA route]
        WORK[RQ workers\nemail · notifications]
        SCHED[scheduler]
        SIO[socket.io server\n(not used by Masar in P1–P7)]
        subgraph MasarApp["masar app"]
          API[api/* whitelisted endpoints]
          SVC[services/*]
          PERM[permissions.py]
          DT[DocTypes + controllers]
        end
      end
      DB[(MariaDB 11.8)]
      REDIS[(Redis/Valkey\ncache · queue)]
      FILES[(sites/<site>/private/files)]
    end
    SMTP[(SMTP server)]

    SPA -- HTTPS, cookie sid, X-Frappe-CSRF-Token --> NGINX
    NGINX --> WEB
    NGINX -. /socket.io .-> SIO
    WEB --> API --> SVC --> DT
    SVC --> PERM
    DT --> DB
    WEB --> REDIS
    WORK --> REDIS
    WORK --> DB
    WORK --> SMTP
    WEB --> FILES
```

## 2. Responsibilities

| Layer | Owns | Must not |
|---|---|---|
| Nuxt SPA | Presentation, interaction state, drafts, optimistic UI, keyboard, routing | Decide permissions, enforce invariants, compute cross-Space aggregates |
| `masar.api.*` | Input parsing, calling one service, response shaping, HTTP method restriction | Business logic |
| `masar.services.*` | Workflows, capability checks, transactions, Activity, side effects (enqueue email) | Bypass permissions without a prior explicit check |
| Controllers | Single-record invariants, same-Space link checks, protected fields | Orchestrate other aggregates |
| `masar.permissions` | Membership resolution, capability matrix, hooks, query conditions | — |
| Frappe core | Auth, sessions, CSRF, ORM, transactions, files, email queue, jobs | — |

## 3. Deployment

**Status: Accepted** — verified by the Phase 0 auth spike (`spikes/frappe-auth/`, see [phase-0-report.md](phase-0-report.md)): a statically generated Nuxt 4.6.3 SPA served same-origin behind nginx completed login → boot → CSRF-protected POST → permission-filtered list → deep-link reload → logout in a headless Chromium run.

Production topology (ADR-016):

- **Updated 2026-10-27 (ADR-023, ADR-024):** the Workspace is served at the **domain root** by a **Caddy** gateway (TLS, security headers, SPA fallback to `/200.html`); an explicit list of Frappe paths (`/api`, `/app`, `/desk`, `/apps`, `/assets`, `/files`, `/private/files`, `/socket.io`, `/update-password`, `/printview`, `/website_script.js`) is proxied to Frappe's nginx. The Workspace owns `/login` (it signs in through Frappe's `/api/method/login`). The Phase 0 spike verified the same mechanism with nginx under `/`; the earlier `/masar/` base-path proposal is superseded.
- The SPA build is a static artifact deployed independently of the Python image (`infrastructure/scripts/deploy-frontend.sh`).
- **Alternative for managed hosting without nginx access** (e.g. Frappe Cloud): serve the same build from the app via `website_route_rules` (`/masar/<path:app_path>` → `masar` www page), the pattern used by Frappe CRM/Gameplan/Helpdesk (VERIFIED in their sources; also VERIFIED working in the spike, at the cost of coupling the Nuxt build into the app's `public/` and `www/`). The frontend code is identical for both; only packaging differs.
- Frappe Desk (`/app`) remains available to System Managers for administration only.
- HTTPS mandatory; `Secure` on the `sid` cookie follows from the HTTPS scheme (VERIFIED: absent over plain http in the spike).
- `developer_mode` off in production: in developer mode error responses include tracebacks (VERIFIED in spike).
- The SPA router renders its own not-found page: nginx returns the shell (200) for unknown Workspace paths (VERIFIED).

Development topology (VERIFIED by the spike):

- Frappe v16.54.0 bench runs in the official `frappe/bench` Docker image (arm64; Python 3.14.10, Node 24.22.1, bench 5.31.1) with MariaDB 11.8 and Redis 7 containers via Docker Compose, the `masar` app source bind-mounted. Native bench on this macOS machine failed (`pkg-config` missing, no Homebrew); Docker avoids host changes.
- Nuxt dev server on `http://localhost:3000/` with `nitro.devProxy` forwarding `/api`, `/desk`, `/app`, `/assets`, `/files`, `/private/files`, `/socket.io`, `/update-password` to Frappe, so the browser sees one origin; an `nginx` container replicates the production gateway for E2E runs.
- Playwright runs from the official Playwright Docker image on the compose network (used successfully in the spike).
- Realtime: bench's default `socketio_backend` is still Node in v16 (VERIFIED); irrelevant until OPT-03.

## 4. Authentication and session

```mermaid
sequenceDiagram
    participant B as Browser (SPA)
    participant F as Frappe
    B->>F: GET /api/v2/method/masar.api.session.boot
    alt not logged in
      F-->>B: 403 (Guest)
      B->>B: navigate to Workspace /login?redirect=/...
      B->>F: POST /api/method/login
      F-->>B: Set-Cookie: sid (HttpOnly; SameSite=Lax; Secure)
      B->>B: navigate back to the requested route
      B->>F: GET boot again
    end
    F-->>B: {user, full_name, roles, spaces:[{name,title,role}], csrf_token, server_time, timezone}
    B->>F: POST /api/v2/method/masar.api.tasks.create  (X-Frappe-CSRF-Token)
    F-->>B: {data: Task}
```

Rules:
- Session cookie only; never API key/secret in the browser. Verified `sid` attributes: `HttpOnly; Path=/; SameSite=Lax`, 7-day expiry; `Secure` added under HTTPS. The non-HttpOnly cookies `user_id`, `full_name`, `system_user` are readable by JS but are never trusted by the SPA (boot is the source of truth).
- **CSRF token lifecycle (VERIFIED finding):** Frappe only enforces CSRF once a token exists in the session; a token is created lazily by `get_csrf_token()`. Between login and the first boot call, a logged-in session accepts POSTs without the header. Generating the token in an `on_session_creation` hook is **not** viable (login then fails with 400, because the new token is enforced against the login request itself). Mitigations:
  1. the SPA calls `boot` immediately on start and after login (boot generates the token);
  2. every Masar write endpoint is wrapped by `@masar_write`, which rejects the request (400) unless the session has a CSRF token *and* the header matches — closing the gap for Masar endpoints regardless of Frappe's lazy behaviour (to implement and test in P1, SEC-T17);
  3. `SameSite=Lax` keeps the cookie off cross-site POSTs in modern browsers (browser behaviour, not tested in the spike).
- CSRF token refreshed by re-calling boot after a `CSRFTokenError` (400) once, then forcing re-login.
- **Logged-out requests return 403, not 401** (VERIFIED, message "...is not whitelisted"). The transport therefore treats a 403 as "session lost" only when a follow-up `boot` reports Guest; otherwise it is a genuine permission error and shown in-app.
- Masar users are created with an explicit `user_type`. The spike observed that users created with only a non-desk role still became `System User` (cause not investigated); P1 sets and tests the intended type (`Website User` for users who must not access Desk — to be verified that DocPerm/hook behaviour is unchanged for Website Users).
- Logout: `POST /api/method/logout` then hard navigation to `/login`; all client caches cleared (`clearNuxtData()`), drafts in `sessionStorage` cleared.
- Session expiry mid-use: transport detects Guest/401, saves the current route, redirects to login; unsaved inline drafts survive in `sessionStorage` for the same tab.

## 5. API style

- Endpoint pattern: `GET|POST /api/v2/method/masar.api.<area>.<operation>`; v2 envelope `{"data": ...}` for success and `{"errors": [{type, message, ...}]}` for failures (VERIFIED by curl in the spike). Frappe's own `/api/method/login|logout` use the v1 envelope (`{"message": ...}`, errors with `exc_type` and `_server_messages` as a JSON string of JSON strings); the transport normalises both shapes.
- Reads are `GET` with query parameters; writes are `POST` with JSON bodies.
- Error semantics:

| HTTP | Frappe exception | Masar meaning | UI behaviour |
|---|---|---|---|
| 400 | `CSRFTokenError` | Session token stale/missing | Re-boot once, retry |
| 403 (Guest) | `PermissionError` as Guest (VERIFIED: never 401) | Not logged in | Confirm via boot → login redirect |
| 403 | `PermissionError` | Member lacks capability | Toast "You don't have permission"; revert optimistic change |
| 404 | `DoesNotExistError` | Not found **or no access** | Not-found state |
| 409 | `MasarConflictError` | Field conflict / stale state | Inline conflict resolution |
| 417 | `ValidationError` (and subclasses, incl. `TimestampMismatchError` — VERIFIED) | Invalid input / invariant / stale whole-doc save | Field error or toast with server message |
| 429 | `RateLimitExceededError` | Too many requests | Backoff |
| 5xx | — | Server error | Keep drafts; retry affordance |

- Date/time serialisation: Date fields `YYYY-MM-DD`; datetimes as ISO 8601 with the site timezone offset; durations as integer minutes. The boot payload includes the site timezone.

## 6. Frontend resource layer

Goal: frappe-ui-like ergonomics (reactive data, loading/error, reload, params, pagination, mutations, invalidation) on Nuxt-native primitives, with a strict separation between the generic layer and Masar domain operations.

```text
composables/api/transport.ts      createMasarFetch(): $fetch.create({ baseURL: '/', credentials: 'same-origin',
                                    onRequest: CSRF header for non-GET, onResponseError: normalise → MasarApiError })
composables/api/keys.ts           typed key builders: ['tasks','list',space,filtersHash], ['task',name], ...
composables/api/useMasarQuery.ts  wraps useAsyncData(key, handler, { dedupe:'defer', getCachedData, watch })
composables/api/useMasarMutation.ts  { execute(vars), pending, error } with optimistic(), rollback(), invalidate()
composables/domain/*.ts           useTaskList(spaceRef, filtersRef), useTask(nameRef), createTask(), updateTaskField() ...
```

Behaviour (Nuxt facts VERIFIED in nuxt.com/docs/4.x where noted in the spike report):

| Need | Mechanism |
|---|---|
| Reactive data, pending, error, refresh | `useAsyncData` return values (`data`, `status`, `error`, `refresh`). |
| Duplicate request avoidance | Shared key ⇒ shared refs (Nuxt ≥ 3.17 behaviour, retained in 4.x); `dedupe: 'defer'` for background refreshes, `'cancel'` when params change. |
| Parameterised queries / filters | Reactive key including a stable hash of params; key change triggers refetch. |
| Pagination | Cursor (`after`) pagination for timelines; keyset (`modified,name`) for "recently updated"; `limit+1` to compute `has_more`. Infinite scroll appends pages into one list state owned by the domain composable. |
| Back-navigation instant render | `getCachedData` returns cached payload; a background refresh revalidates when stale (> 30 s) or on window focus. |
| Mutations with optimistic update | Snapshot affected query data → apply patch → call API → replace with server row (authoritative) → on error restore snapshot and surface error. |
| Targeted invalidation | `invalidate(prefix)` refreshes active queries whose key starts with prefix (e.g. after moving a Task between Batches: `['batches', from]`, `['batches', to]`, `['tasks','list',space]`). Inactive cached entries are dropped (`clearNuxtData`). |
| SSR/hydration | Not applicable — `ssr: false` removes hydration mismatch and cross-user SSR state risk. |
| Simultaneous edits | Mutations send `base` values; 409 → conflict UI (ADR-018). |
| Request cancellation | `AbortSignal` from `useAsyncData` handler passed to `$fetch`. |

Not built: a normalised entity store, offline mode, or a general-purpose query library. Mutation handlers update the specific list/detail caches they know about; domain composables encapsulate those relationships.

## 7. API contracts (key workflows)

TypeScript notation; Python services return the same shapes. Full set is maintained in `frontend/app/types/api.ts` once implementation starts.

```ts
// Boot
interface Boot {
  user: string; fullName: string; userImage: string | null
  roles: Array<'Masar User' | 'Masar Admin' | 'Masar Planner'>
  spaces: Array<{ name: string; title: string; role: 'Manager' | 'Member'; status: SpaceStatus }>
  csrfToken: string; timezone: string; serverTime: string
}

// Task list row (one query, no N+1)
interface TaskListRow {
  name: string; title: string; space: string; priority: Priority
  dueDate: string | null; isCompleted: boolean; isImportant: boolean; isMyDay: boolean
  assignees: UserRef[]; taskOwner: string | null
  feature: Ref | null; release: Ref | null; batch: Ref | null
  labels: LabelRef[]; actionCount: number; actionDoneCount: number; commentCount: number
  sortOrder: number; modified: string
}

// GET masar.api.tasks.list
interface TaskListParams {
  space?: string            // omitted ⇒ all spaces of the user (e.g. "Assigned to me" global view)
  batch?: string | 'none'; feature?: string; release?: string; label?: string
  assignedToMe?: boolean; ownedByMe?: boolean; important?: boolean; myDay?: boolean
  completed?: 'open' | 'completed' | 'all'
  sort?: 'manual' | 'recently_updated' | 'due_date' | 'priority'
  cursor?: string; limit?: number   // limit ≤ 200
}
interface Page<T> { items: T[]; nextCursor: string | null }

// POST masar.api.tasks.create (idempotent)
interface CreateTaskInput {
  clientRequestId: string   // UUID v4 generated per draft
  space: string; title: string
  batch?: string; feature?: string; release?: string   // context of the group the user typed in
  afterTask?: string        // ordering hint
}
// → TaskListRow (existing row returned when clientRequestId was already used by this user)

// POST masar.api.tasks.update (field-scoped concurrency)
interface UpdateTaskInput {
  task: string
  changes: Partial<Pick<Task, 'title'|'description'|'priority'|'dueDate'|'feature'|'release'|'isImportant'|'isMyDay'|'remainingMinutes'>>
  base: Partial<Record<keyof UpdateTaskInput['changes'], unknown>>   // values the edit was based on
}
// → Task ; 409 { type: 'MasarConflictError', conflicts: [{ field, current, yours }] }

// POST masar.api.batches.assign_tasks (bulk, cross-Space)
interface AssignTasksInput { batch: string | null; tasks: string[] }   // null ⇒ remove from batch
// → { moved: string[]; unchanged: string[] }   // tasks the user cannot edit cause 404 for the whole call (no partial leak)

// GET masar.api.batches.get
interface BatchView {
  batch: { name: string; batchName: string; startDate: string; endDate: string; status: BatchStatus; owner: UserRef }
  permissions: { canEdit: boolean; canStart: boolean; canFinish: boolean }
  progress: { total: number; completed: number }    // viewer-visible items only
  groups: Array<{ space: Ref; tasks: TaskListRow[] }>  // only the viewer's Spaces
}

// POST masar.api.actions.promote
interface PromoteResult { action: TaskAction; task: TaskListRow; created: boolean }

// GET masar.api.timeline.list
interface TimelineParams { task: string; kinds?: Array<'comment'|'history'|'worklog'>; cursor?: string; limit?: number }
type TimelineItem =
  | { kind: 'comment'; at: string; comment: Comment }
  | { kind: 'history'; at: string; activity: Activity }
  | { kind: 'worklog'; at: string; entry: TimeEntry }

// Every detail response includes server-computed permissions for UI affordances:
interface TaskDetail extends TaskListRow {
  description: string | null; remainingMinutes: number | null; loggedMinutes: number
  createdBy: UserRef; creation: string; completedBy: UserRef | null; completedAt: string | null
  sourceTask: Ref | null; sourceAction: string | null
  permissions: { canEdit: boolean; canDelete: boolean; canManageLabels: boolean }
}
```

Idempotency: `tasks.create`, `comments.post`, `worklog.log` accept `clientRequestId`; `actions.promote` and `batches.assign_tasks` are idempotent by nature (state-based).

**Phase 7 time API (as implemented; the planned `worklog.*` and `timeline.list` names above became `masar.api.time.*` and `masar.api.comments.timeline`).**

| Method | HTTP | Input | Result |
|---|---|---|---|
| `masar.api.time.summary` | GET | `task` | `{ loggedMinutes, remainingMinutes }` |
| `masar.api.time.get` | GET | `entry` | `TimeEntry` |
| `masar.api.time.log` | POST | `task, duration, client_request_id, work_date?, description?, set_remaining?, remaining?, base_remaining?` | `{ entry, task: TaskDetail, created }`; 409 on a stale estimate, 422 on request-id reuse |
| `masar.api.time.update` | POST | `entry, changes{duration?, workDate?, description?}, base_modified?` | `{ entry, task, created: false }`; 409 when stale |
| `masar.api.time.void` | POST | `entry, reason?` (required for moderation) | `{ entry, task, created: false }` |
| `masar.api.comments.timeline` | GET | `task, view (all/comments/history/worklog), before/after/anchor, limit` | items of kind `comment`, `history` or `time` |
| `masar.api.session.version` | GET (guest) | — | `{ commit, apiMethods[] }` for the release gates (ADR-059) |

```ts
interface TimeEntry {
  name: string; task: string; worker: UserRef | null; workDate: string; minutes: number
  description: string | null; loggedAt: string; editedAt: string | null; modified: string
  isVoided: boolean; voidedAt: string | null; voidedBy: UserRef | null; voidReason: string | null
  permissions: { canEdit: boolean; canVoid: boolean }
}
```

## 8. Background processing

> **Implemented (Phase 6).**
> - `masar.services.notification_service.notify_comment` runs on the `short` queue, enqueued after commit with job id `masar-comment-notify-<comment>` and deduplication. One e-mail goes to each recipient; mentioned members get the mention variant, never both.
> - `masar.services.attachment_service.cleanup_abandoned_uploads` runs daily.
> - Comment, attachment and timeline contracts: `masar.api.comments.{timeline,get,create,update,delete,react,mention_candidates}` and `masar.api.attachments.{list,upload,delete}` (ADR-051 to ADR-057).


| Job | Queue | Trigger | Notes |
|---|---|---|---|
| Comment notification | `default` | `comment_service.post` → `enqueue_after_commit=True` | Recipients resolved at run time (04 §7). Frappe Email Queue handles SMTP retry. |
| Mention notification | same job | | Merged into the same email per recipient. |
| Order renormalisation | `short` | when fractional gaps collapse | Rare. |

## 9. Dependencies (planned production set)

| Package | Why | Status |
|---|---|---|
| `nuxt` 4.6.3 | Required framework | ADR-001 |
| `@nuxt/ui` 4.12.0 | Required UI library (brings Tailwind 4, Reka UI, TanStack Table/Virtual, TipTap integration as peers) | ADR-001 |
| `@vueuse/nuxt` / `@vueuse/core` | Keyboard, debounce, focus, storage helpers (Nuxt UI already depends on VueUse) | Planned |
| `@tanstack/vue-virtual` 3.13.49 | Task List virtualisation (already installed by Nuxt UI; declared because Masar imports it) | ADR-008 |
| ~~`@vueuse/integrations` + `sortablejs`~~ | Not needed: drag uses native HTML5 events to group/column targets (ADR-008); the spike showed `useSortable` mis-maps DOM indices in grouped lists | Rejected |
| TipTap 3 peers required by `UEditor` | Rich text + mentions | ADR-019, added in P6 |
| `@internationalized/date` | Date-only values with Nuxt UI calendar/input-date | Nuxt UI peer |
| Dev: `vitest`, `@nuxt/test-utils`, `@playwright/test` 1.64.1, `@axe-core/playwright`, `@nuxt/eslint`, `typescript` 6.0.3, `vue-tsc` 3.3.13 | Quality toolchain (TS 7 incompatible with vue-tsc — VERIFIED) | Planned |

Note: install with npm 11 may block dependency postinstall scripts (observed for `esbuild` in the auth spike, build still succeeded); the allowed-scripts policy is configured explicitly in P1.

Backend: Frappe v16 only. No extra Python dependencies planned; HTML sanitisation uses Frappe's bundled sanitiser utilities (to be verified in P6) before considering any addition.
