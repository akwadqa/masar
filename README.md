# Masar

Masar is Akwad Programming's agile work-management application: Spaces, Tasks, Features, Versions (Releases), Sprints, My Day, comments, attachments, time tracking and notifications. It is a **Frappe application**, installed as one more app on an existing Frappe/ERPNext site, with its Workspace at **`/masar/`** (for example `/masar/my-day`).

| | |
|---|---|
| Release | `v0.1.0-4840713a375a` (version 0.1.0) |
| Source commit (development repository) | `4840713a375a4422615bf1e63c62f2889e13c337` (2026-10-30T18:31:24+01:00) |
| Workspace build | `9913bf39fc95deab68c84af12e9b6c0a143e8575efa13e5ea4646627c15ece05`, see `masar/public/frontend/build.json` |
| Frappe | `>=16.54.0,<17.0.0` (developed and tested on v16.54.0) |
| ERPNext | not required. Validated side by side with ERPNext **v16.53.0** on the same site (see `STAGING_VALIDATION.md`) |
| Python | 3.14 |
| Node.js | 24 (only to rebuild the Workspace; the built Workspace is included) |
| Database | MariaDB (validated on 11.8) |

## Architecture

- **Backend.** The `masar` Frappe app: DocTypes of module *Masar*, permission hooks (Space membership), services, and a whitelisted API under `/api/v2/method/masar.api.*`.
- **Workspace.** A Nuxt 4 / Nuxt UI single-page application (`frontend/`), built into the app:
  - `masar/www/masar.html` is served at `/masar` and every `/masar/...` route;
  - the assets are under `masar/public/frontend` and served at `/assets/masar/frontend/`.

  No separate web server or origin is used.
- **Authentication.** Frappe's own login, session, CSRF and users. Masar has no login page or user store. Employees use their existing Frappe accounts, and ERPNext and Masar share the session.
- **Access.** The roles `Masar User`, `Masar Planner` and `Masar Admin` (no Desk access) are created at installation and **assigned to nobody**; the site administrator assigns them per person. Space content is visible only to Space members.
- **E-mail.** Masar uses Frappe's queue and the site's existing default outgoing E-mail Account. It has no SMTP settings.
- **Installed iPhone/Android app.** The PWA manifest and the push-only service worker at `/masar/sw.js` are included. No offline mode.

## Repository layout

| Path | Contents |
|---|---|
| `pyproject.toml`, `masar/` | The Frappe app, including the built Workspace (`masar/www/masar.html`, `masar/public/frontend/`) |
| `masar/tests/` | Backend tests (Frappe `bench run-tests --app masar`) |
| `masar/demo/`, `masar/utils/seed.py`, `masar/utils/batch_reset.py` | **Development-only** tools (demo dataset for development sites, browser-test identities, a one-off reset). They are guarded: the demo tool refuses any site but its two development sites, and the test identities require `masar_allow_e2e_fixtures`. They are **not** part of the production package |
| `frontend/` | Workspace source, unit tests (Vitest) and browser tests (Playwright) |
| `docs/` | Architecture, data model, security and permissions, UX, decisions, and the Akwad integration |
| `INSTALLATION.md` | Installing on an existing Frappe/ERPNext site; upgrades; rollback |
| `RELEASE_NOTES.md`, `STAGING_VALIDATION.md` | What this release contains and how it was validated |
| `RELEASE.json` | Release identity (source commit, Workspace build) |

## Installing

See **`INSTALLATION.md`**. In short, on the existing bench:

```bash
bench get-app <this repository or the release package> --branch v0.1.0-4840713a375a
bench --site <site> install-app masar
```

Nothing else on the site is changed, and no sample data is created.

## Building the Workspace

The built Workspace is committed. Rebuild it only after changing `frontend/`:

```bash
cd frontend
npm ci
npm run build:app     # generates the SPA and writes it into ../masar (www/masar.html, public/frontend)
npm run check:app     # verifies masar/public/frontend/build.json matches the frontend sources
```

## Tests

```bash
bench --site <test site> set-config allow_tests true
bench --site <test site> run-tests --app masar          # backend
cd frontend && npx vitest run                           # unit
E2E_BASE_URL=http://localhost:8000 E2E_PASSWORD_FILE=<file> npx playwright test   # browser (needs QA identities)
```

Run tests only on development or test sites, never on production.

## Environments

| Environment | URL | Notes |
|---|---|---|
| Development and testing | `https://masar.akwad.qa/masar` | Demo data, QA runs |
| Production (target) | `https://erp.akwad.qa/masar` | Akwad's existing Frappe/ERPNext site; installed only with the owner's explicit approval |

Licence: proprietary (Akwad Programming).
