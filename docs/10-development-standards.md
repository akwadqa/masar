# 10 — Development Standards

Status: **Draft for approval** · Last updated: 2026-10-27

Practical rules for implementing Masar with Claude Code and human review. These standards are binding for every session.

## 1. Workflow per capability (one session = one bounded capability)

1. Read: the phase section in [07](07-implementation-roadmap.md), relevant sections of [02](02-domain-data-model.md), [03](03-system-architecture.md), [04](04-security-permissions.md), [05](05-product-ux.md), and applicable ADRs.
2. Restate scope and acceptance criteria in the session before writing code. If the docs do not answer a question, stop and ask; do not invent behaviour.
3. Backend first: DocType/controller → service → API → tests (unit, integration, permission).
4. Frontend: types → domain composable → components → tests.
5. Run all checks (§6). Fix, do not skip.
6. Browser-verify the user flow (record screenshots/GIF for the completion note).
7. Update docs/ADRs if anything deviated. Architecture changes require an ADR update approved by the Akwad lead *before* merging.
8. Completion note: what was built, evidence (test output summary, screenshots), known gaps.

## 2. Hard rules (non-negotiable)

- No scope beyond the approved phase. Good ideas go to [01 §6](01-requirements-analysis.md#6-optional-future-considerations-not-planned).
- No new dependency without a written justification (problem, why Nuxt UI/Frappe/VueUse cannot solve it, size, maintenance status) recorded in the PR and the dependency table in [03](03-system-architecture.md).
- No placeholder functionality presented as complete; unfinished UI is not merged behind a visible entry point.
- No fake, skipped or assertion-free tests; no claims of passing tests without output.
- Never weaken permissions, CSRF, validation or sanitisation to make the UI work.
- No unrelated refactors in a capability session.
- No breaking API contract changes without updating `frontend/types/api.ts`, contract tests and the docs together.
- No destructive schema change (field removal/rename, type change) without a Frappe patch (`patches.txt`) and a tested migration.
- English only for identifiers, comments, commit messages, docs and reports.

## 3. Backend conventions (Frappe app `masar`)

```text
masar/
  hooks.py                    # has_permission, permission_query_conditions, doc_events, website_route_rules
  permissions.py              # get_user_spaces, can(), hooks, query conditions (single source)
  exceptions.py               # MasarConflictError(409), MasarValidationError
  masar/doctype/<doctype>/    # DocType JSON + controller (invariants only)
  services/                   # space_service, task_service, action_service, batch_service, release_service,
                              # feature_service, comment_service, worklog_service, file_service, notification_service
  api/                        # thin whitelisted endpoints per area: session, spaces, tasks, actions, labels,
                              # features, releases, batches, comments, files, worklog, lookup
  utils/                      # sanitiser, durations, ordering
  tests/                      # fixtures + test modules mirroring services/api
  patches/                    # data migrations
```

- **Controllers** enforce invariants of their own record; they do not orchestrate other records except cached counters and Activity.
- **Services** orchestrate multi-record operations, perform capability checks via `can()`, and run inside `masar_service()` context (sets the request-local flag that allows writes).
- **API modules** validate/parse input, call one service, shape the response. No business logic. Every endpoint: `@frappe.whitelist(methods=["GET"])` or `["POST"]`, typed parameters, docstring stating capability required.
- Use `frappe.qb` or `frappe.get_list` (permission-aware). `frappe.get_all` and `frappe.db.sql` only in services after authorization, with a comment.
- Exceptions: `frappe.DoesNotExistError` (no access or missing), `frappe.PermissionError` (member lacks capability), `frappe.ValidationError` subclasses (invalid input), `MasarConflictError` (409).
- Python 3.14, ruff format + lint, type hints on public functions.

## 4. Frontend conventions (`frontend/`, Nuxt 4 `app/` directory)

```text
frontend/                      (as implemented in P1; later phases add folders under components/)
  nuxt.config.ts               # ssr: false, components without path prefix, icon client bundle, devProxy to Frappe
  app/
    app.vue, app.config.ts     # UApp, theme (primary teal, neutral zinc)
    layouts/                   # default (UDashboardGroup shell), auth (login)
    middleware/auth.global.ts  # boot-driven route guard
    pages/                     # login, spaces/, spaces/[space]/(tasks|summary), tasks/[task], [...slug]
    components/
      shell/                   # MasarLogo, UserMenu
      tasks/                   # TaskListView, TaskList (virtualised), TaskRow, TaskPanel, TaskDetail
      common/                  # StatePanel, NoAccessState
    composables/               # flat (Nuxt auto-import): useSession, useMasarApi, useMasarQuery,
                               # useMasarMutation, useSpaces, useTasks, useInlineDrafts
    types/api.ts               # API contracts mirrored from backend/masar/services
    utils/                     # apiError, drafts, taskRows, format, redirect (pure, unit-tested)
  tests/unit (Vitest)  tests/e2e (Playwright)
```

- **Nuxt UI native first.** Use documented v4.12 components/props/slots and `app.config.ts` theming. Do not restyle primitives with scattered Tailwind; extend via `ui` prop or theme config. Custom components compose Nuxt UI primitives and add *product behaviour*, not visuals.
- Components never call `$fetch` directly; they use domain composables. Business rules (owner resolution, permission decisions) live on the server; the UI only reflects server-provided `permissions` flags.
- TypeScript `strict`; no `any` in domain code; API types in `types/api.ts` are the contract.
- Keyboard: every action reachable without a mouse; shortcuts registered via Nuxt UI `defineShortcuts`; drag-and-drop always has a menu equivalent.
- Accessibility: semantic roles, visible focus, labels on icon buttons (`aria-label`), reduced-motion respected.
- Dates: use `@internationalized/date` (Nuxt UI peer) for date-only values; never construct `Date` from date-only strings.

## 5. Comments and naming

- English, concise, only where they explain *why* (invariants, security reasons, non-obvious framework behaviour). No line-by-line narration.
- Names follow the product vocabulary: Space, Task, Action, Feature, Batch, Release, Label, Worklog. Never Epic/Story/Sprint/Sub-task in code or UI.

## 6. Checks (must pass before a session is considered done)

| Check | Command (planned) |
|---|---|
| Python lint/format | `ruff check masar && ruff format --check masar` |
| Backend tests | `bench --site masar.test run-tests --app masar` |
| Frontend lint | `npm --prefix frontend run lint` |
| Typecheck | `npm --prefix frontend run typecheck` |
| Frontend unit | `npm --prefix frontend run test` |
| E2E (smoke) | `npm --prefix frontend run e2e -- --grep @smoke` |
| Banned patterns | `scripts/check-banned-patterns.sh` (see [08 §6](08-testing-quality.md#6-static-and-review-gates)) |

## 7. Review

- **Self-review** with the diff before completion (correctness, scope, security, naming).
- **Specialised review passes** (separate agent/reviewer, given the diff and the relevant doc section, not the implementer's conclusions):
  - Security review: every change touching `permissions.py`, `api/`, `services/`, file handling, email, sanitiser.
  - Backend data review: DocType/schema changes, migrations, indexes.
  - Frontend UX review: new screens/interactions against [05](05-product-ux.md).
  - Test review: at phase end, that tests assert behaviour from [08](08-testing-quality.md).
- Keep reviews narrow; do not run multi-agent reviews for small changes.
- Diff size guideline: ≤ ~600 changed lines per reviewable unit (excluding generated JSON/lockfiles).

## 8. Version control (once Git is approved)

- Trunk-based with short-lived branches per capability: `p1/inline-task-create`.
- Conventional commit messages in English (`feat(tasks): idempotent inline creation`).
- Lockfiles committed; `spikes/` excluded from the product build and removed or archived after Phase 0 sign-off.
