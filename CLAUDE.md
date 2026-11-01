# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Masar is Akwad Programming's agile work-management app. It is a **Frappe v16 app** (`masar/`) that you install on an existing Frappe/ERPNext site. It comes with a **Nuxt 4 / Nuxt UI 4 SPA** (the "Workspace", `frontend/`), served at `/masar/` from the same origin. Authentication, sessions, CSRF and users are all Frappe's own. Masar has no login page or user store.

This is the **release repository**: the Frappe app sits at `masar/` in the repo root. In the development repository it lives at `backend/masar`. `frontend/scripts/install-into-app.mjs` handles both layouts. Some docs and comments still say `backend/masar/...`. In this repo, read that as `masar/...`.

## Commands

Frontend (run from `frontend/`, Node 24):

```bash
npm ci
npm run dev                 # Nuxt dev server on :3000; devProxy forwards /api, /assets, /login, ... to MASAR_FRAPPE_URL (default http://localhost:8000)
npm run typecheck
npx vitest run              # unit tests (tests/unit/**/*.test.ts, node env, pure utils only)
npx vitest run tests/unit/duration.test.ts   # single unit test file
npm run build:app           # nuxt generate + copy into ../masar/www/masar.html and ../masar/public/frontend/
npm run check:app           # fails if masar/public/frontend/build.json doesn't match the current frontend sources
E2E_BASE_URL=http://localhost:8000 E2E_PASSWORD_FILE=<file> npx playwright test [tests/e2e/phase1.spec.ts] [--project=webkit]
```

- **The built Workspace is committed.** After any change under `frontend/app`, `frontend/public`, `nuxt.config.ts`, `package-lock.json` or `tsconfig.json`, run `npm run build:app` and commit the regenerated `masar/www/masar.html` and `masar/public/frontend/`. Otherwise `check:app` fails.
- The E2E tests run serially (1 worker). They need QA identities on a dev/test site (`masar_allow_e2e_fixtures`). Several specs change the shared global-setup data, so each project needs fresh fixtures.
- No frontend lint script exists, despite what `docs/10` plans.

Backend (on a bench, dev/test sites only, never production):

```bash
ruff check masar && ruff format --check masar        # tabs, double quotes, line length 110
bench --site <test site> set-config allow_tests true
bench --site <test site> run-tests --app masar
bench --site <test site> run-tests --app masar --module masar.tests.test_my_day   # single module
bench --site <test site> run-tests --app masar --module masar.tests.test_my_day --test test_<name>
```

Backend tests use `frappe.tests.IntegrationTestCase` and the fixed test world in `masar/tests/fixtures.py`: Spaces A/B, users `a_manager`, `a_member`, `b_member`, `ab_member`, `outsider`, `admin`, and so on.

## Backend architecture

Requests flow **API → service → DocType controller**, and every layer is strict about its job:

- `masar/api/<area>.py` contains thin `@frappe.whitelist(methods=["GET"|"POST"])` endpoints. The frontend calls them as `/api/v2/method/masar.api.<area>.<op>`. They parse input, call one service and return its result. **Every write endpoint is wrapped in `@masar_write`** (`masar/utils/context.py`). It enforces a CSRF token, because Frappe creates the token lazily. It also runs the service inside `masar_service()` and retries MariaDB snapshot-isolation conflicts (`QueryDeadlockError`) up to 5 times. Writes must therefore have no external side effects before commit.
- `masar/services/` holds all business logic, capability checks, multi-record orchestration, Activity records and notifications. Per-user features (My Day, timer, preferences) live in `services/personal/`. `serializers.py` shapes responses, and those shapes must match `frontend/app/types/api.ts`.
- `masar/masar/doctype/*` holds DocTypes, all prefixed `Masar ...`. Each controller enforces only its own record's invariants.
- `masar/permissions.py` is the **single source of truth for access**, registered in `hooks.py` for every Masar DocType and for `File`:
  - Access is decided by **Space membership** (`Masar Space Member`, role Manager/Member). It is cached per request (`get_user_spaces`). Call `clear_membership_cache()` after membership changes.
  - Non-members get `DoesNotExistError` (404), so they never learn that a record exists. Members who lack a capability get `PermissionError` (403).
  - Outside `masar_service()`, generic Frappe write paths (`frappe.client`, `/api/resource`) are denied for Masar DocTypes. DocShare is blocked.
  - In Frappe v16 a hook that returns `None` denies, so every hook returns an explicit bool.
  - Child tables have their own query conditions.
- Optimistic concurrency: mutations send `base`/`expected_*` values, and a conflict raises `MasarConflictError` (409). Exceptions live in `masar/exceptions.py`.
- Roles `Masar User`, `Masar Planner` and `Masar Admin` are created on install (`masar/install.py`) and assigned to nobody.
- Scheduled jobs (`hooks.py`) run at 00:05 Asia/Qatar: `mark_overdue` first, then `start_new_day` (My Day resets). Attachment cleanup runs daily.
- Destructive schema changes need a patch under `masar/patches/vN/`, registered in `patches.txt`.
- `masar/demo/`, `masar/utils/seed.py` and `masar/utils/batch_reset.py` are guarded dev-only tools and are not part of production.

## Frontend architecture

- `ssr: false`, with `app.baseURL = /masar/`. In production the assets are served from `/assets/masar/frontend/` (`cdnURL`). Frappe serves `masar/www/masar.html` for every `/masar/<path>` route (`website_route_rules`). The push-only service worker is served at `/masar/sw.js` by `masar/pwa.py`. The app has no offline mode.
- Components are auto-registered **without a path prefix**, so component names must be globally unique. Composables are auto-imported from `composables/**`, including subfolders such as `composables/workspace/`.
- Data layer:
  - `useMasarApi` is the transport. It adds the CSRF header and normalises both the v1 and v2 error envelopes into `MasarApiError` (`utils/apiError.ts`).
  - `useMasarQuery` wraps `useAsyncData` with keyed caching and dedupe. `useMasarMutation` adds optimistic updates, rollback and invalidation.
  - Domain composables (`useSpaces`, `useBatches`, `usePlanning`, `useCollaboration`, ...) build on those two.
  - **Components never call `$fetch` directly.** The UI only reflects server-provided `permissions` flags and never makes permission decisions itself.
- `middleware/auth.global.ts` guards routes using the `masar.api.session.boot` payload. Logged-out requests return 403, not 401. A 403 only counts as a lost session if a follow-up boot reports Guest.
- Inline drafts persist in `sessionStorage` (`utils/drafts.ts`, `useInlineDrafts`).
- Use Nuxt UI components and props first, themed through `app.config.ts` and `assets/css/themes.css`. Avoid scattered Tailwind restyling.
- Use `@internationalized/date` for date-only values. Never construct a `Date` from a `YYYY-MM-DD` string.
- Icons are bundled at build time with no icon server. Icons chosen at runtime must be added to `icon.clientBundle.icons` in `nuxt.config.ts`.
## Vocabulary

The UI and the code use different words for one thing:

| UI | Code / DocType / API |
|---|---|
| Version | `Release` (`Masar Release`) |

Batches are called Batches in both (`Masar Batch`, routes `/batches`). They were shown as "Sprints" in client revision 4; that was reverted on 2026-10-31, and old `/sprints` links redirect. Spaces, Tasks, Features, Labels and Actions also use the same names in both. Don't introduce Epic/Story/Sprint/Sub-task terms.

## Delivery workflow

- There is no dev/test site yet, only production. Never create, change or delete site data there: backend tests, E2E specs and fixtures cannot run until a test site exists. Say so in reports and commit messages instead of claiming they pass.
- Work locally and touch the server last: explore, edit, build and verify in the local repository; only the final, verified, complete files are copied to the server, replacing the old versions (and removing deleted files). Never build, clone or try things out on the server, and leave nothing behind there (no clones, patches, archives, caches or temp files). (Client decision 2026-11-01.)
- Big changes (new features, changes across several areas, API contract, permission or schema changes, patches, migrations, architecture) go on a `feat/<name>` branch and reach `master` through a pull request. Minor changes (small fixes, tweaks, copy or style changes) go straight to `master`. When unsure, treat it as big. (Client decision 2026-11-01.)
- A feature request is not permission to change data. Any write to site data (patches that change rows, cleanups, backfills, deletions) needs the client's explicit approval first, stating what changes and how many records. Read-only checks are fine.
- If a change affects other features (behaviour, URLs, permissions, shared components, API contracts, existing data), list the impact and get the client's go-ahead before implementing.
- Verify locally (ruff, typecheck, vitest, `build:app`, `check:app`, with an LF worktree: `core.autocrlf=false`), then copy the changed files to the app for the client to evaluate and confirm that the server tree matches the local tree. Python changes need a restart of the bench web and worker processes.
- Commit only after the client approves, one logical change per commit. Minor changes: push `master`. Big changes: push the branch and open a PR; the client merges it. Then move the server's checkout to the resulting `master` commit.
- This repository is public: never commit server hosts, user names, paths or the names of other sites. Environment details live in each developer's private Claude memory and skills.
- Client decisions are final once given: record them with their date in `specs/` or `docs/` and in code comments, and update any document they contradict.

## Project rules (from `docs/10-development-standards.md`)

- Stay within the requested scope. If the docs don't answer a behaviour question, ask instead of inventing behaviour.
- Add no new dependency without a written justification.
- Never weaken permissions, CSRF, validation or sanitisation to make the UI work.
- An API contract change updates `frontend/app/types/api.ts`, the tests and the docs together.
- Only write tests that make real assertions. Never claim tests pass without showing their output.
- English everywhere. Comments explain *why*: invariants, security reasons, non-obvious framework behaviour. Existing comments often cite ADRs in `docs/06-architecture-decisions.md` and client revisions; keep doing this.
- Security-sensitive areas are `permissions.py`, `api/`, `services/`, file handling, email and `rich_text.py`. Changes there deserve a focused security review.

Some deployment details in `docs/03` are outdated: it describes serving at the domain root behind Caddy. The current model is the in-app `/masar` route described in `README.md` and `INSTALLATION.md`.
