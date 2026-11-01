# 05 — Product UX & Interaction Design

Status: **Draft for approval** · UI library: Nuxt UI **4.12.0** · Last updated: 2026-10-27

References used as inspiration (not to clone): Linear (keyboard-first lists, inline creation, side panel), Jira (Batch/sprint planning, versions), Frappe Gameplan (Spaces, comments, reactions, `?comment=` deep links — VERIFIED in its source), Frappe CRM (side panel + full page, Kanban). Masar vocabulary only.

## 1. Nuxt UI v4 component compatibility

Names from the client brief mapped to verified Nuxt UI 4.12.0 components (VERIFIED in the installed package during the Phase 0 spike).

| Brief name | Nuxt UI 4.12 component | Masar usage |
|---|---|---|
| UCard | `UCard` | Summary cards, Feature cards, Batch cards |
| UTable | `UTable` | Releases, Batch list/history, Worklog, members. **Not** the main Task List (ADR-008) |
| USheet | **`USlideover`** (no `USheet` exists) | Task detail panel (`side="right"`) |
| UModal | `UModal` + `useOverlay` | Confirmations, Batch finish, create Batch/Release |
| UBadge | `UBadge` | Priority, labels, status, Release/Batch chips |
| UDropdown | **`UDropdownMenu`** (`UDropdown` was v2) | Row menus, bulk actions, "Move to Batch" |
| UCommandPalette | `UCommandPalette` (supports `virtualize`) | ⌘K: jump to Space/Task/Batch/Release, run commands |
| UTabs | `UTabs` | Space tabs: Active Batches / Task List / Summary; timeline filters |
| — | `UDashboardGroup`, `UDashboardSidebar`, `UDashboardPanel`, `UDashboardNavbar`, `UDashboardToolbar` | App shell (free in v4; were paid Pro in v3) |
| — | `UNavigationMenu` | Sidebar navigation |
| — | `UContextMenu` | Right-click on Task rows (same items as row menu) |
| — | `UEditor`, `UEditorMentionMenu`, `UEditorToolbar` | Description and comments (ADR-019) |
| — | `UInputDate`, `UCalendar`, `UPopover` | Due date, Batch dates, Release date |
| — | `UFieldGroup` (v3 name was `UButtonGroup`) | Grouped controls (presets) |
| — | `USelectMenu`, `UInputMenu` | Assignee, Feature, Release, label pickers (with create-label item) |
| — | `UAvatar`, `UAvatarGroup`, `UTooltip`, `UKbd`, `UCheckbox`, `UProgress`, `USkeleton`, `UForm`, `UFormField`, `UInput`, `UTextarea`, `UToast` (`useToast`), `UChip` | Throughout |

Rules: no v2/v3 names (`UDropdown`, `USheet`, `UButtonGroup`, `useModal`); theme via `app.config.ts` (`ui.colors.primary`, `ui.colors.neutral`) and component `ui` props; no edits to Nuxt UI source.

## 2. Information architecture

**Route map (updated 2026-10-27, ADR-023: the Workspace owns the root of `https://masar.hariri.ch`).**

```text
/login                             Workspace sign-in (Frappe session; honours ?redirect= and Frappe's ?redirect-to=)
/                                  → last Space or Spaces overview
/spaces                            Spaces overview                                   [P1]
/spaces/:space/tasks               Space · Task List (default tab)                   [P1]
/spaces/:space/summary             Space · Summary                                   [P1]
/spaces/:space/batches             Space · Active Batches                            [P5]
/spaces/:space/settings            Space settings (Managers edit; Members read)      [P2]
/spaces/:space/roadmap             Feature roadmap (Space-scoped, Q-03)              [P4]
/spaces/:space/releases[/:rel]     Releases of the Space                             [P4]
/tasks/:task[?comment=:id]         Full Task page (direct links)                     [P1]
/my-work                           Cross-Space: Assigned / Owned / My Day / Important [P3]
/batches[/:batch]                  Batches (cross-Space planning)                    [P5]

Frappe-owned (proxied by the gateway, never SPA routes):
/api/*  /desk  /app  /apps  /assets/*  /files/*  /private/files/*  /socket.io/*  /update-password  /printview
```

The Task panel (`USlideover`) opens over any list by adding `?task=:id` to the current URL, so the panel state is shareable and back-button friendly; "Open as page" switches to `/tasks/:id`. Only implemented tabs are shown (no placeholder tabs).

## 3. Screens

### 3.1 Application shell
- **Purpose:** constant orientation and one-step access to Spaces, My Work, Batches; ⌘K for everything else.
- **Layout:** `UDashboardGroup` → `UDashboardSidebar` (collapsible, resizable) with: Space switcher (`UDropdownMenu` listing the user's Spaces with role badge), `UNavigationMenu` (My Work, Batches, then current Space: Task List, Active Batches, Roadmap, Releases, Summary, Settings), user menu (logout). `UDashboardPanel` hosts pages; `UDashboardNavbar` holds breadcrumb + page actions.
- **Keyboard:** `⌘K` palette; `g s` Spaces, `g m` My Work, `g b` Batches, `g t` current Space tasks, `?` shortcut sheet (`defineShortcuts`, sequences with `-` as documented).
- **Mobile:** sidebar becomes a slideover menu; panel pages full-width.
- **States:** boot loading skeleton; boot failure → retry screen; no Spaces → empty state explaining that a Manager or Admin must add them.

### 3.2 Spaces overview
- **Purpose:** find and enter Spaces. **User:** everyone.
- **Content:** `UCard` grid or compact list (toggle) with title, department, type, status badge, my role, open-task count, active Batch names. Search input + status filter (default *In Progress*; Q-06).
- **Actions:** open Space; *New Space* (Q-05 role only, `UModal` form).
- **Empty:** "You're not a member of any Space yet." **Permission:** only the user's Spaces are returned by the server.

### 3.3 Space detail (tabs via `UTabs` bound to the route)
- **Active Batches tab:** cards for Planned/Active Batches containing this Space's Tasks: name, dates, days left, viewer-scoped progress (`UProgress`), counts; click → Batch page filtered to this Space.
- **Task List tab:** §3.4.
- **Summary tab:** properties (title, category, owner, details, completion date, type, status, department, Gameplan link as external link), members with roles (`UAvatarGroup` + list), counts by completion, Features by roadmap stage, upcoming Releases. Managers see an *Edit* action (to Settings).

### 3.4 Main Task List (the central screen)

**Structure (ADR-008 `TaskList` component).**

```text
[Filters bar]  Feature ▾  Release ▾  Batch ▾  Labels ▾  ☆ Important  ☀ My Day   Assigned to me · Owned by me · Recently updated   [Group by: Batch | None]
──────────────────────────────────────────────────────────────────────────────────────────────
▾ Batch 2026-W45 · Active · Nov 3–9 · 12/31 done                                        [⋯]
   ☐  ▸ ○  Add VAT field to invoice print      ☆  ERP-2.4  E-invoicing   Lina +1   Nov 12  High
          ↳ ☑ Update print format
          ↳ ☐ Add test invoice            [Promote]
   ☐    ○  Fix login timeout                    …
   +  Add task…                                   (inline create row; inherits Batch context)
▾ Not in a Batch · 84
   …
```

- Row: selection checkbox (`UCheckbox`), expand caret (only when Actions exist), completion circle, title (inline-editable on `Enter`/double-click), Important star / My Day sun toggles (shown on hover or when set), Release and Feature chips (`UBadge`), labels, assignees (`UAvatarGroup`), due date, priority icon. Hover reveals quick controls: *Batch ▾*, *Release ▾*, row menu (`UDropdownMenu`).
- **Grouping:** by Batch (default when the Space has Planned/Active Batches) or none. Group header shows name, status, dates, viewer-visible progress; collapsible.
- **Inline creation (ADR-011):** an "Add task…" row at the end of each group and a top input focused with `c`. Typing creates a local draft; `Enter` commits and opens a fresh draft below (rapid entry); `Esc` cancels the empty draft or blurs a non-empty one (blur commits); `Shift+Enter` commits and opens the panel. The created Task inherits the group context (Batch, current Feature/Release filter). Optimistic row with a subtle pending indicator; failure shows *Not saved — Retry / Discard*.
- **Selection & bulk:** click checkbox, `x`, `Shift`+click range, `⌘A` all visible. A bulk bar (`UDashboardToolbar` area) appears: *Move to Batch ▾*, *Set Release ▾*, *Assign ▾*, *Mark complete*, *Clear selection*. Selections can include Tasks from multiple Spaces in *My Work* and Batch planning views; bulk Batch assignment works across Spaces (MASAR-LIST-004). Only actions valid for every selected Task are enabled (server re-checks).
- **Drag & drop:** drag a row (or the selection) onto another group header to move Batch; within a group, drag to reorder (manual sort). Every drag has a menu/keyboard equivalent (`m` → "Move to Batch" picker; `⌥↑/⌥↓` reorder).
- **Actions:** `e` or caret expands; Action rows support inline add (`Enter`), toggle (`Space`), edit, delete, *Promote to Task*.
- **Keyboard map:** `j/k` or `↓/↑` move focus, `Enter` open panel, `x` select, `e` expand, `c` new task, `Space` toggle complete (with undo toast), `s` star, `d` My Day, `a` assign, `m` move to Batch, `r` set Release, `/` focus filter, `Esc` clear selection/close panel. Shortcuts are suppressed while typing in inputs.
- **Filters:** server-side; reflected in the URL query (shareable, back-button safe). "Recently updated" switches sort to `modified desc` and disables manual reordering.
- **Filter chips (client, 2026-10-31; `specs/dynamic-task-filters.md`):** "+ Filter" adds one chip per field (Status, Assignee, Owner, Priority, Label, Space). A chip reads `Field · operator · values`; operators are *is*, *is not*, *is empty*, *is not empty* where the field supports them. Values of a chip are OR, chips are AND. URL: `<param>=<values>` plus `<param>_op=not|empty|set`; API: `statuses_op`, `assignees_op`, `owners_op`, `priority_op`, `label_op`.
- **Sorts (client, 2026-10-31):** both Task Lists sort by *Recently updated* (default) or *Creation date* (`sort=created`, newest first); manual order is no longer offered on Task Lists. The Spaces page sorts by *Name* (default) or *Creation date* (`sort=created`).
- **States:** skeleton rows on first load; filtered-empty ("No tasks match these filters — Clear filters"); Space-empty (inline create focused, short hint); error (retry, cached rows kept visible); no-access (404 view).
- **Performance:** virtualised rendering (spike: p95 16.7 ms/frame for 1,500 rows in a production build); server pages of 200 rows with background fetch of further pages; counts from cached Task columns.
- **Mobile:** single-column rows with title, chips collapsed; actions via row menu; no drag (menu moves only).

### 3.5 Task detail panel and full page

> **Implemented (Phase 6, 2026-10-28).** The Task panel and page now show:
> - an **Attachments** section (upload, drop, previews, private downloads);
> - an **Activity** timeline (All / Comments / History / Worklog);
> - a rich-text composer (toolbar, @mentions, : emoji, paste or drop images, ⌘/Ctrl+Enter, drafts kept).
>
> Comments have a menu (copy link, edit own, delete or moderate) and compact reactions. The description stays plain text. See ADR-051 to ADR-058.

> **Implemented (Phase 7, 2026-10-28): time.** Task details show a **Time** row: *Logged 2h 15m · Remaining 4h / not estimated*. The estimate opens a small editor.
>
> **Log time** opens an inline form:
> - **time spent**, with live feedback (`= 1h 30m`);
> - **work date**, defaulting to Qatar today, with future dates not selectable;
> - an optional **note**;
> - an optional **Update remaining estimate**.
>
> Enter saves. The draft and its request id survive failures, reloads and re-sign-in, so retrying never logs twice. The total changes only after the server confirms.
>
> **Worklog** lists entries with author, duration, date and note:
> - authors can **Correct entry** or **Void entry**;
> - Managers can **Void entry (moderation)** with a required reason;
> - voided entries stay visible, struck through, with the reason;
> - its empty state offers **Log time**.
>
> There is no timer and no completion prompt. Read-only Spaces show the Worklog without controls. See ADR-060 to ADR-063.

- **Panel:** `USlideover` (right, width ~640 px, non-modal overlay off so the list stays usable on wide screens). Full page reuses the same `TaskDetail` component in a focused layout.
- **Layout:** header (completion toggle, title inline-editable, Important/My Day toggles, row menu: copy link, open as page, delete); properties grid (Space read-only, assignees with owner crown, priority, due date, Feature, Release, Batch, labels, remaining/logged time); description (`UEditor`, edit on click, saved on blur/⌘Enter); Actions checklist; Attachments (drop zone + list); Timeline with `UTabs` filter: All / Comments / History / Worklog; composer at the bottom (sticky).
- **Assignees:** `USelectMenu` multi, Space members only; owner shown with a crown; clicking the crown on another assignee transfers ownership; removing the owner moves the crown to the first remaining assignee instantly (server confirms).
- **Time logging:** "Log time" button → inline form: duration (`1h 30m`), date (today default), note, remaining (pre-filled) → `Enter` saves.
- **Concurrency:** if a field changed underneath (409), the field shows *Changed by Lina · Keep theirs / Use mine*.
- **Navigation:** `j/k` inside the panel moves to next/previous Task of the list without closing; `Esc` closes.

### 3.6 Shared comment navigation

> **Implemented (Phase 6).** Links use `/tasks/:task?comment=:id` (page) or `?task=…&comment=…` (panel). Since client revision 6 (2026-11-01) the timeline loads every item and opens on All; the comment is found in the loaded list, so no separate `locate` call is needed, and it works at any depth. The comment is scrolled into view and highlighted for 4 s. No access gives "Task not found". Deleted comments show a placeholder.

`/tasks/:task?comment=:id` → page loads the Task (404 view if no access), then `comments.locate` returns the page cursor containing the comment; the timeline loads that window, scrolls the comment into view, highlights it for 2 s and moves focus to it (accessible). A deleted comment shows its placeholder. Copy-link is available in each comment's menu.

### 3.7 Feature roadmap
- Four columns Now / Next / Later / Done (`UCard` per Feature: title, owner, task progress `UProgress`, Release chips of its Tasks). Drag between/within columns (native drag, column targets) and keyboard/menu "Move to → Now/Next/Later/Done", "Move up/down".
- Click a card → Feature slideover: description, Tasks list (compact `TaskList` variant), add existing Tasks, create Task in Feature.
- Empty column hints; a Space selector in the navbar (Q-03).

### 3.8 Batch planning
- **Batches index:** `UTable` of Planned / Active / Completed Batches (name, dates, owner, viewer-visible progress, status badge); *New Batch* (`UModal`: name, start date with `UInputDate`, preset `UFieldGroup` [One week | Two weeks | Custom], end date).
- **Batch page:** header (name, dates, status, days left, progress), actions (*Start*, *Finish*, *Edit*, per permissions), Tasks grouped by Space (only the viewer's Spaces), *Add tasks* opens a cross-Space task picker (`UModal` with search over the user's Spaces, filters, multi-select).
- **Finish flow:** `UModal` showing visible unfinished count, destination choice (`USelectMenu` of Planned/Active Batches or "No Batch"), confirmation. The server applies the choice to all unfinished items (04 §5.3).
- **Completed Batch:** read-only history (Completed / Carried Over / Removed tabs).

### 3.9 Releases
Releases list per Space (`UTable`: name, date, status, open/total tasks), Release page (Tasks via compact `TaskList`, status actions for Managers with the open-task warning on *Mark released*), Archived hidden behind a filter.

### 3.10 Space settings
Sections: Details (`UForm`), Members (`UTable` with role `USelect`, *Add member* `USelectMenu` of Masar users, *Remove* with impact preview per ADR-021, *Transfer ownership* for the owner), Labels (list with colour, rename, delete; Managers), Danger zone (status changes). Members see the page read-only.

## 4. Cross-cutting UX principles

- **No lost input:** drafts (inline tasks, comments, time entries) persist in `sessionStorage` until confirmed.
- **Optimistic but honest:** immediate UI change, subtle pending state, authoritative server row replaces it; failures revert with an explanatory toast.
- **Undo over confirm** for reversible actions (complete, move, remove label) via toast action; **confirm** for destructive or wide actions (delete Task, remove member, finish Batch).
- **Permission-aware affordances:** controls hidden or disabled based on server `permissions` flags; server always re-checks.
- **Accessibility:** WCAG 2.2 AA target; focus rings, `aria-live` announcements for moves/completions, keyboard alternatives for all drag interactions, reduced-motion support.
- **Consistency:** one row component family, one picker pattern, one toast pattern, one empty-state component.

## 5. High-impact refinements (PROPOSED, all within confirmed scope)

| # | User problem | Interaction | Benefit | Complexity |
|---|---|---|---|---|
| 1 | Capturing many tasks is slow | Rapid inline entry: `Enter` commits and opens the next draft in the same group with inherited context | Brain-dump 10 tasks in seconds | Low |
| 2 | Context switching to see a task | Panel opens over the list with `j/k` navigation inside the panel | Review a backlog without losing place | Medium |
| 3 | Mouse-heavy triage | Single-key shortcuts + ⌘K command palette with "Move to Batch…", "Set Release…" commands | Power users never leave the keyboard | Medium |
| 4 | Fear of mistakes | Undo toasts for completion, moves, label removal | Confidence; fewer confirmations | Low |
| 5 | Unclear relationships | Promoted Actions show a live link and mirrored completion; new Tasks show "Promoted from …" | Lineage is visible, no duplicates | Low |
| 6 | Planning across Spaces is fiddly | Cross-Space task picker with multi-select and keyboard, bulk move | Batch planning in one dialog | Medium |
| 7 | Conflicting edits are silent | Field-level conflict notice with "Keep theirs / Use mine" | No silent overwrites | Medium |
| 8 | Empty screens feel dead | Purposeful empty states with the next action focused (e.g. inline create already focused) | Faster onboarding | Low |
| 9 | Dates are error-prone | Batch presets (One week / Two weeks) with end date computed and visible; natural duration input for worklog | Fewer input errors | Low |
