# Masar — Akwad production integration (authoritative)

Status: **Authoritative** · Owner directive of 2026-10-30 · Supersedes every earlier statement that
`masar.akwad.qa` is Masar's production environment.

## 1. Environments

| Environment | URL | Purpose | Data |
|---|---|---|---|
| Development / testing (temporary) | `https://masar.akwad.qa/masar` (Frappe site name `masar.hariri.ch`) | Development, bug fixes, stabilization, automated tests, UI/UX checks, client acceptance, QA fixtures, development deployments (`infrastructure/scripts/release.sh`) | Fictional demo data, QA identities, a few real `@akwad.qa` accounts |
| Local | `http://localhost:8000/masar` (site `masar.localhost`) | Development stack (`infrastructure/dev`) | Local test data |
| Isolated install test | throwaway containers (`infrastructure/package/install-test.sh`) | Proves the package installs onto an existing Frappe site | Synthetic, deleted afterwards |
| Staging (to be built, separately authorized) | to be decided | Production-like: Frappe + ERPNext + Masar on **one** site | Isolated, synthetic or approved sanitized |
| **Production (target)** | **`https://erp.akwad.qa/masar`** | Akwad's existing, operational Frappe/ERPNext system | Live business data |

The development server is **not** the production environment and is not a model of it: it has no
ERPNext, no other Akwad apps and no outgoing e-mail account. Do not configure Microsoft 365, SMTP or any
mail provider on it.

## 2. Production architecture

```text
https://erp.akwad.qa            (existing Frappe site, operated by Akwad)
├── Frappe Framework            existing users, sessions, CSRF, permissions, e-mail queue, files
├── ERPNext                     existing business data
├── Other Akwad Frappe apps
└── Masar                       added as one more app on the SAME site
    └── /masar/, /masar/my-day, /masar/spaces/…, /masar/tasks/…, /masar/sprints/…
```

- Masar is installed **into the existing site** with `bench get-app` + `bench --site <site> install-app masar`.
  A new production site is never created as a substitute; ERPNext and other apps are never reinstalled,
  reset, updated or overwritten to install Masar.
- **Shared authentication.** Employees sign in with their existing Frappe accounts on Frappe's own login
  page; ERPNext and Masar share that session (same origin). Masar has no login page, user directory or
  credential store of its own and never creates, duplicates or migrates User records.
- **Access.** Installing Masar grants nothing: its roles (`Masar User`, `Masar Planner`, `Masar Admin`, no
  Desk access) are assigned by Akwad per employee. Without a Masar role the Apps screen hides Masar and its
  API answers 403. Space content is visible only to Space members. A user holding System Manager *and* a
  Masar role is a Masar administrator (existing design; owner to confirm for production).
- **E-mail.** Masar sends through Frappe's queue and the site's existing default outgoing E-mail Account
  (Akwad's Microsoft-connected account). Masar holds no mail credentials and creates no E-mail Account.
  Users' Masar e-mail preference is respected; in-app and Web Push notifications are independent of e-mail.
  QA-D07 only stops error logging when no outgoing account exists; it does not disable e-mail.
- **Coexistence.** No Frappe or ERPNext core file is modified. Masar's hooks are limited to its own
  DocTypes, plus deny-only rules on `File` (files attached to Masar Tasks only) and `DocShare` (Masar
  documents only). Scheduled jobs touch Masar records only. No fixtures, Custom Fields, Property Setters,
  site-wide setting changes or ERPNext dependency (`required_apps = []`).
- **Portable routing.** The Workspace uses same-origin relative paths (`/api`, `/assets/masar/frontend/`,
  base `/masar/`); e-mail links come from Frappe's `get_url()` (site `host_name`). The same build runs at
  `masar.akwad.qa/masar` and `erp.akwad.qa/masar` without changes.

## 3. Production package

- Location: **`production_masar_app/`** (sibling of this repository).
  It is a deployment artifact; this repository is the single source of truth.
- Build: `infrastructure/package/build.sh [<ref>] [--install-test]` (see `infrastructure/package/README.md`).
  It packages one committed revision (never uncommitted changes), checks the frontend build identity,
  the Frappe app structure, exclusions and secrets, writes `MANIFEST.json` and `SHA256SUMS`, and switches
  `current` atomically only after every check passed; a failed build leaves the previous package in place.
- Contents: the Frappe app (`app/masar`, installable with `bench get-app`), a reproducible archive,
  manifest, checksums, status and guides (INSTALL, UPGRADE, ROLLBACK, COMPATIBILITY, VALIDATION,
  STAGING-TEST-PLAN).
- Excluded: tests, the demo dataset generator, QA fixture tooling, the one-off Sprint reset, any database
  content, users, credentials, site configuration, logs, backups, caches, virtual environments and
  development history. DocType schemas, patches, roles and the built Workspace are included.
- States: `CANDIDATE` → `VALIDATED_LOCALLY` → `STAGING_VERIFIED` → `PRODUCTION_READY`; `BLOCKED` at any time.
  Only `PRODUCTION_READY` (staging accepted, owner approved) may be installed on `erp.akwad.qa`.

**Synchronization rule.** After a change is implemented, reviewed, committed and verified (test suites
green), run `infrastructure/package/build.sh --install-test`. Development deployments to `masar.akwad.qa`
stay as they are; the package build is an additional step and does not block development.

## 4. Gates before any production change

1. Authorized read-only inspection of `erp.akwad.qa` (versions, apps, topology, `host_name`, outgoing
   account name, routes) — not yet done. Never run install, migrate, update, restart or configuration
   commands there during preparation.
2. Compatibility assessment completed (package `docs/COMPATIBILITY.md`). **Masar requires Frappe ≥ 16.54 <
   17 and Python 3.14.** If production runs an older Frappe (e.g. v15), installation needs a Frappe/ERPNext
   upgrade decision with its own impact assessment; Masar must not force it.
3. Isolated staging with ERPNext and Masar on one site; the ERPNext → Masar → ERPNext employee journey and
   the scenarios of the package's `docs/STAGING-TEST-PLAN.md` accepted.
4. Verified backup and rehearsed rollback (code rollback, Masar-only data recovery; whole-database restore
   only as an owner-decided disaster measure).
5. Agreed installation window and the owner's explicit final approval. No automatic production deployment.

## 5. Rules for all future work

- Keep Masar installable as an additional app in an existing site; no development-domain assumptions,
  no absolute URLs, no separate frontend server or authentication origin.
- Do not change shared authentication, other apps' permissions, global site configuration, Frappe/ERPNext
  core, or add global hooks without a documented necessity and compatibility review.
- Never move QA or demo data to production. Keep development, staging and production separate.
- Preserve the approved UI/UX and features; portability work does not justify product changes.
- Historical reports and task records that call `masar.akwad.qa` "pre-production" are kept as history.
