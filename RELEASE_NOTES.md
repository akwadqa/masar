# Release notes — Masar `v0.1.0-4840713a375a`

## Identity

| | |
|---|---|
| Version | 0.1.0 |
| Release tag | `v0.1.0-4840713a375a` |
| Source commit | `4840713a375a4422615bf1e63c62f2889e13c337` (2026-10-30T18:31:24+01:00) |
| Workspace build | `9913bf39fc95deab68c84af12e9b6c0a143e8575efa13e5ea4646627c15ece05` (built 2026-10-30T16:30:35.796Z) |

- **Approved version:** the application is byte-identical to the version the owner verified on `masar.akwad.qa` (development server, commit `7e2e4737d9eb`), including on a physical iPhone. This release adds only release tooling and documentation.
- **Packaging:** the installable production package is built from the same commit (`production_masar_app`, `MANIFEST.json`, `SHA256SUMS`).

## Functionality

**Spaces:**
- Spaces with categories and identity (icon and colour), Space members with Manager/Member roles, Space settings.
- Owner transfer, archive and close.

**Tasks:**
- Statuses (with automatic Overdue), owner and assignees, priorities, due dates, labels, important flag.
- Markdown descriptions, actions (checklists) with promotion to Tasks.
- Search and filters, bulk actions, keyboard navigation.

**Personal views:** My Day, All Tasks.

**Planning:**
- Features (roadmap Now / Next / Later / Done) and Versions (Releases), with progress.
- Sprints (Batches) across Spaces, with a planning board and a backlog.
- The Features and Versions panels can be open together.

**Collaboration:**
- Comments with mentions and reactions, attachments (private, Space members only), activity history.
- Notifications: in-app, Web Push and e-mail, with a per-user e-mail preference.

**Time and preferences:**
- Time tracking: timer and work log.
- Preferences: three design themes, Light/Dark/System, full-width pages, pinned Spaces.

**Installable app:** an iPhone/Android Home Screen app (manifest and push service worker), with no offline mode.

## Recent corrections (confirmed on the owner's iPhone)

**Installed iPhone app:**
- A solid status bar. The page fits the screen, with no bands below the Task composer or the menu's account footer.
- No frosted band at the top from launch on: an opaque full-width surface sits at the top edge from the first frame.

**Mobile Task pages:**
- One natural page scroll, with no hide-on-scroll.
- The composer stays at the bottom.
- "+" opens the composer above the keyboard, like tapping the field.
- New task shows its Plus icon only on phones.

**Earlier stabilization:**
- phone layouts (Space Settings, Sprint header, Task details);
- the notification badge;
- accessibility names;
- no Error Log entry per notification while no outgoing mail account exists;
- QA data cleanup;
- preference persistence;
- the removed Settings tooltip.

## Tested

- **Development repository suites:** backend (Frappe) and unit tests (Vitest); browser end-to-end in Chromium and WebKit (Playwright), including mobile viewports and the installed-app geometry; pixel comparisons across themes and appearances.
- **ERPNext staging:** an isolated validation with ERPNext v16.53.0 installed first on the same site, covering a fresh install and an upgrade from an earlier Masar release. See `STAGING_VALIDATION.md`.
- **Physical iPhone (installed app):** verified by the owner on the development server.

## Compatibility and limitations

- **Requirements:** Frappe `>=16.54.0,<17.0.0` and Python 3.14. ERPNext is not required; v16.53.0 is validated side by side.
- **Production versions unverified:** the Frappe/ERPNext/Python versions of the production site `erp.akwad.qa` have **not** been inspected (no authorized access yet). A production installation needs that check first (`INSTALLATION.md` §1).
- **iOS blur:** the top-edge treatment on the installed iPhone app depends on iOS 26+ behaviour (WebKit bug 301994). Masar provides the surface iOS needs; later iOS versions could change this.
- **Keyboard Escape:** on the Space Task List, Escape does not close the account menu or the phone drawer. This was already the case before this release, and touch closing works.
- **Real mail delivery:** Microsoft 365 delivery on the production site has not been tested. Masar uses the site's existing outgoing account, and in staging a local mail sink stood in for it.
