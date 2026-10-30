# Installing Masar on an existing Frappe/ERPNext site

Release `v0.1.0-4840713a375a`. This procedure adds Masar to the **existing** bench and site. It never creates a new site, and never reinstalls, updates or reconfigures ERPNext or other apps. It was rehearsed on an isolated ERPNext v16.53.0 site (`STAGING_VALIDATION.md`).

> **Production gate.** Install on `erp.akwad.qa` only with the owner's explicit written approval and an agreed window.

## 1. Compatibility checks (read-only)

```bash
cd ~/frappe-bench
bench version                    # frappe must be >=16.54.0,<17; note every app and version
./env/bin/python --version       # Python 3.14
bench --site <site> list-apps    # masar must not be listed
bench --site <site> show-config | grep -E "host_name|maintenance_mode"   # host_name should be the public URL
bench --site <site> doctor       # workers and scheduler healthy
```

- **Stop if** Frappe is below 16.54 or Python is not 3.14. Masar cannot be installed on that bench; upgrading Frappe/ERPNext is a separate decision.
- **Confirm** that no Web Page, Web Form or other app already uses the route `/masar`.

## 2. Backup (in the window)

```bash
bench --site <site> backup --with-files
```

- Copy the files off the server and check their checksums.
- This backup protects the whole shared site. Restoring it discards all ERPNext work done after it, so it is a disaster-recovery measure only (§6).

## 3. Get the app

Use **either** the production package (recommended: it excludes development-only tools, and `verify.sh` checks its checksums):

```bash
tar -xzf masar-0.1.0-4840713a375a.tar.gz -C /opt/masar-packages/v0.1.0-4840713a375a
bench get-app /opt/masar-packages/v0.1.0-4840713a375a/masar
```

**or** this repository at the release tag (needs read access to the private repository from the server):

```bash
bench get-app git@github.com:<owner>/masar_akwad.git --branch v0.1.0-4840713a375a
```

- `get-app` installs the app into the bench's Python environment and links its prebuilt assets. No Node.js build is needed, and there are no extra Python dependencies.
- Depending on the bench configuration, it may restart the bench processes; do it inside the window.

## 4. Install on the site

```bash
bench --site <site> install-app masar
bench --site <site> list-apps          # masar 0.1.0 listed
```

**What this creates:**
- Masar's DocTypes (`tabMasar …` tables);
- the roles `Masar User`, `Masar Planner` and `Masar Admin`, without Desk access and assigned to nobody;
- two scheduled jobs that touch only Masar records;
- a Desktop Icon only on sites that use the Desktop Icon grid.

**What it does not create:** no Spaces, Tasks, users or sample data. Masar's data patches are recorded as done without running.

Restart the processes the usual way (`bench restart` or supervisor/systemd).

## 5. Verify, then give access

```bash
curl -sI https://<host>/masar | grep -i location     # /login?redirect-to=/masar (Frappe login)
curl -s https://<host>/api/v2/method/masar.api.session.version | head -c 120   # commit 4840713a375a
curl -sI https://<host>/assets/masar/frontend/manifest.json | head -1          # 200
```

**Giving access:**
- In Desk → User → *Roles*, add **Masar User** to the employees who should use Masar, and **Masar Admin** to those who create Spaces and manage membership.
- A user holding System Manager **and** a Masar role is a Masar administrator.
- Employees open Masar from the Apps screen or at `https://<host>/masar`, with their existing session.
- With no Spaces yet, they see a valid empty state.

**E-mail:** Masar sends through the site's existing default outgoing E-mail Account; nothing needs configuring. Users can turn Masar e-mail off in Masar's notification settings.

## 6. Upgrading to a later Masar release

1. **Check and back up:** read-only checks as in §1, then `bench --site <site> backup --with-files`.
2. **Fetch the new release and switch Masar's code only:**

   ```bash
   cd ~/frappe-bench/apps/masar
   git fetch <new package path or repository> 'refs/tags/*:refs/tags/*'
   git checkout --detach <new tag>
   ```

3. **Build, migrate and restart:**

   ```bash
   cd ~/frappe-bench
   bench build --app masar
   bench --site <site> migrate      # site-wide: confirm no other app has code waiting to be migrated
   ```

   Then restart the processes.

**Never upgrade Masar with** `bench update`, `bench update --pull` or `get-app --overwrite`: they touch other apps.

## 7. Rollback and recovery

- **Code:** `git -C apps/masar checkout --detach <previous tag>`, then `bench build --app masar` and restart. Database changes are not reversed by this.
- **Disable access** without uninstalling: remove the Masar roles from users.
- **Masar data only:** before an upgrade, back up Masar's tables (`bench --site <site> backup --include "<Masar DocTypes>"`). To restore them, use `bench --site <site> partial-restore <file>`; ERPNext tables are not touched.
- **Uninstall** (last resort; deletes Masar's records): `bench --site <site> uninstall-app masar`.
- **Whole-site restore:** only as an owner-decided disaster measure, after weighing the ERPNext data lost since the backup.
