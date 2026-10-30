# ERPNext staging validation — Masar `v0.1.0-4840713a375a`

**Harness:** `infrastructure/staging/staging-validate.sh` in the development repository. It is reusable and makes an isolated, throwaway stack on the release engineer's Mac.

## Environment

| Component | Version / setting |
|---|---|
| Frappe | v16.54.0 (the same build as the development stack) |
| ERPNext | **v16.53.0**: `bench get-app erpnext --branch v16.53.0`, declares Frappe `>=16.50.0,<17.0.0` |
| Python | 3.14.10 |
| Node.js | 24 (bench image), not needed for Masar's prebuilt Workspace |
| Database | MariaDB server 11.8.9 (container `mariadb:11.8.9`) |
| Redis | 7.4 (cache, queue, socket.io) |
| Mail | Mailpit sink as the site's default outgoing account: no mail leaves the machine |
| Isolation | Its own Docker network, database, Redis and bench volume, all removed after the run. Every identity uses the reserved `.invalid` domain, and passwords are random per run, never printed |
| Masar packages | New: the production package of this release. Previous (upgrade test): `v0.1.0-c4f893212a45` |

**Not reproduced:** Akwad's other custom apps and the production topology (supervisor/systemd, reverse proxy). Their versions are unknown until the production site is inspected.

## Scenarios

1. **Upgrade path (site `upgrade.test`):**
   - ERPNext set up first (setup wizard, company);
   - the previous Masar release installed, with Masar data (a Space, Tasks, a Feature, a Task status);
   - the documented upgrade: fetch the new package's tags, check out the new tag, `bench build --app masar`, `bench migrate`;
   - data preserved and the new version reported.
2. **Fresh install on an operational ERPNext site (site `erp.test`):**
   - ERPNext set up, six employees with ERPNext roles (no Masar role), a default outgoing mail account, an employee's private file;
   - an ERPNext smoke test (customer, item, submitted Sales Invoice with ledger entries, Accounts Receivable report);
   - a before snapshot;
   - `install-app masar`, then `migrate` twice, then an after snapshot and comparison;
   - the ERPNext smoke test again.
3. **HTTP checks on `erp.test`:**
   - guest redirects;
   - an ERPNext employee without Masar (ERPNext works, Masar refused, the Apps screen hides Masar), and a System Manager without a Masar role refused;
   - the employee journey ERPNext → Masar → ERPNext in one session, with the Workspace and ERPNext assets served;
   - Masar functions with backend permission checks (Space creation by role, membership, outsider refusal, Tasks, assignment, My Day, comments, Feature/Version/Sprint, linking, list, search, completion);
   - private attachments (member yes; outsider and guest no; ERPNext files unaffected);
   - notification and e-mail through the site's default account to the sink;
   - CSRF enforcement; logout ending both apps.
4. **Backend suite of the same commit** on `erp.test`, with ERPNext installed (test modules added to this throwaway copy only).

## Results

**102 checks passed, 0 failed.**

```
PASS bench get-app erpnext v16.53.0
INFO erpnext 16.53.0, MariaDB server 11.8.9-MariaDB-ubu2404
PASS new-site upgrade.test
PASS install-app erpnext on upgrade.test
PASS ERPNext setup wizard completed (Staging Trading WLL)
PASS bench get-app masar (previous package v0.1.0-c4f893212a45)
PASS install-app masar v0.1.0-c4f893212a45 on upgrade.test
PASS previous release holds Masar data: 1 Space, 3 Tasks, 1 Feature
PASS upgrade: git fetch new package
PASS upgrade: checkout v0.1.0-4840713a375a
PASS upgrade: bench build --app masar
PASS upgrade: migrate upgrade.test
PASS upgrade kept every Space and Task
PASS upgrade kept Task fields: {'feature': 'l3a7m696hd', 'status': 'Working'}
PASS upgraded site reports the new commit 4840713a375a
PASS all Masar patches recorded after the upgrade
PASS ERPNext still installed on the upgraded site
PASS new-site erp.test
PASS install-app erpnext on erp.test
PASS ERPNext setup wizard completed (Staging Trading WLL)
PASS 6 employees with ERPNext roles, default outgoing account (sink), an employee's private file
PASS ERPNext before Masar: Sales Invoice submitted, 2 ledger entries
PASS ERPNext before Masar: Accounts Receivable report lists the invoice
PASS baseline migrate erp.test
PASS install-app masar v0.1.0-4840713a375a on erp.test
PASS migrate erp.test
PASS second migrate erp.test (idempotent)
PASS installed apps: ['frappe', 'erpnext', 'masar']
PASS unchanged by Masar: users
PASS unchanged by Masar: user_roles
PASS unchanged by Masar: roles
PASS unchanged by Masar: non_masar_docperms
PASS unchanged by Masar: system_settings
PASS unchanged by Masar: website_settings
PASS unchanged by Masar: selling_settings
PASS unchanged by Masar: accounts_settings
PASS unchanged by Masar: site_config_keys
PASS unchanged by Masar: global_defaults
PASS unchanged by Masar: email_accounts
PASS unchanged by Masar: custom_fields
PASS unchanged by Masar: property_setters
PASS unchanged by Masar: custom_docperms
PASS unchanged by Masar: workspaces
PASS unchanged by Masar: non_masar_doctypes
PASS unchanged by Masar: non_masar_scheduled_jobs
PASS unchanged by Masar: files
PASS Masar roles created without Desk access: {'Masar Planner': 0, 'Masar Admin': 0, 'Masar User': 0}
PASS nobody received a Masar role at install (holders: [])
PASS 4 data patches recorded as done (not run) on the fresh install
PASS data-free install: {'Masar Space': 0, 'Masar Task': 0, 'Masar Batch': 0, 'Masar Feature': 0, 'Masar Release': 0, 'Masar Notification': 0}
PASS Masar scheduled jobs only: ['masar.services.attachment_service.cleanup_abandoned_uploads', 'masar.services.task_service.mark_overdue']
PASS version endpoint reports commit 4840713a375a
PASS installed apps: ['frappe', 'erpnext', 'masar']
PASS ERPNext after Masar: Sales Invoice submitted, 2 ledger entries
PASS ERPNext after Masar: Accounts Receivable report lists the invoice
PASS guest /masar/my-day -> Frappe login
PASS guest ERPNext Desk asks to sign in (301)
PASS service worker and manifest served
PASS emp.sales signs in with the existing Frappe account
PASS employee without Masar opens ERPNext Sales Invoice list (/desk)
PASS ERPNext API answers the ERPNext employee
PASS same session reaches Masar, which knows the user is not a Masar user
PASS Masar data refused without a Masar role (403)
PASS Apps screen: ERPNext shown, Masar hidden (['erpnext'])
PASS emp.sysadmin signs in with the existing Frappe account
PASS System Manager without a Masar role is refused Masar data
PASS emp.masar signs in with the existing Frappe account
PASS journey 1: ERPNext Sales Invoice list
PASS journey 2: Masar /masar/my-day without a second sign-in
PASS journey 3: Masar knows the same user; no Spaces yet (empty state)
PASS 95 Workspace assets served (all)
PASS journey 4: back to ERPNext in the same session
PASS Desk page and ERPNext assets load (5 checked)
PASS emp.manager signs in with the existing Frappe account
PASS Masar Admin creates a Space (200)
PASS a Masar User cannot create Spaces (403)
PASS Space manager adds a member
PASS the member sees the Space
PASS emp.other signs in with the existing Frappe account
PASS a Masar user outside the Space neither lists nor opens it
PASS member creates a Task (200)
PASS member edits the Task status
PASS member assigns the manager
PASS member adds the Task to My Day
PASS member comments
PASS Feature, Version and Sprint created (200, 200, 200)
PASS Task linked to the Feature and Version
PASS Task List shows the Task
PASS search finds the Task
PASS outsider cannot open the Task
PASS member completes the Task
PASS member uploads a private attachment (200)
PASS member downloads it
PASS outsider is refused it
PASS guest is refused it
PASS ERPNext private file: owner still downloads, others still refused
PASS assignment created an in-app notification and queued e-mail (2 in Frappe's queue)
PASS the e-mail went out through the site's default account to the local sink (2 message(s); queue [('Sent', ''), ('Sent', ''), ('Not Sent', ''), ('Not Sent', '')])
PASS a write without the session's CSRF token is refused (400)
PASS logout
PASS after logout Masar is signed out
PASS after logout ERPNext asks to sign in too (301)
PASS backend suite with ERPNext: Ran 240 tests in 13.764s
RESULT PASS
```

## Assessment

**Validated in staging:**
- Masar installs onto an operational ERPNext v16.53.0 site and upgrades in place.
- It changes nothing outside its own DocTypes and roles, and shares Frappe's session with ERPNext.
- It enforces its permissions on the server and uses the site's mail account.
- ERPNext keeps working.

**Not yet production-ready:** this needs the read-only inspection of the production site's versions, apps and topology (`INSTALLATION.md` §1), a rehearsal against those versions if they differ, and the owner's approval.
