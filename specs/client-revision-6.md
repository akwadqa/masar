# Client revision 6 (2026-11-01)

Requests from the client on 2026-11-01, the decisions taken the same day, and the delivery plan.
Decisions recorded here are final (CLAUDE.md, "Client decisions are final once given").

## Group 1: minor fixes (straight to `master`, one commit each)

| # | Request | Cause / current behaviour | Change |
|---|---|---|---|
| R1 | Roadmap Kanban: cards get narrower and cropped when a column is full. | Cards are flex items with `overflow-hidden`, so they shrink to fit the fixed-height column (`RoadmapBoard.vue`). | Cards keep their height; the board grows and the page scrolls (client wording: "the page expands and scrolls to the bottom"). |
| R2 | The latest comment disappears after opening a Task from an e-mail; it is back after a reload. | An anchored load (`?comment=`) shows the comment and newer items; the 20 s poll then appended the older items of the newest page after it, so newest-first display moved the comment to the bottom (`useCollaboration.ts`, `refreshNewest`). | Fixed together with R3: the whole timeline is loaded, the poll only adds items newer than the last known one, in server order. |
| R3 | Do not hide older comments behind "Show earlier activity". | Timeline pages of 30 with before/after/anchor cursors (ADR-057). | The timeline loads every item of the chosen view (pages are fetched until the end). A deep link scrolls to and highlights the comment. Supersedes ADR-057's windowing. |
| R4 | The timeline opens on "All". | Opened on Comments (client revision 5, R14). | Default view "All", also for e-mail deep links. |
| R5 | 12-hour clock. | `formatTime` was 24-hour (`en-GB`); `formatDateTime` already 12-hour. | `formatTime` gives e.g. "2:05 PM". |
| R6 | Mobile: choosing a filter field freezes the page. | The modal "+ Filter" menu locks the body (pointer events, scroll, iOS touchmove) and the values picker opens while it is still closing; on iOS the lock can stay. | Non-modal filter menus; the values picker opens after the menu has closed. Confirmed on the client's phone (2026-11-02). |
| R7 | Task lists show active Tasks by default again. | Since 8f0c589 (2026-10-31) the lists showed all Tasks. | Default = active (Open, Working, Pending Review, Changes Required, Overdue). Choosing a Status filter shows any status. Reverses the 2026-10-31 decision. |

## Group 2: task list views (branch `feat/task-list-views`, PR)

- **Saved filters**: per list (All Tasks, each Space's list), in this browser (`localStorage`, key `masar:task-filters:all` or `masar:task-filters:space:<Space>`). Saved are the filter, sort and grouping parameters of the URL (`useTaskFilters.FILTER_KEYS`), not the open task panel. A link that carries filters wins and becomes the saved state; "Clear filters" is saved too. My Day keeps no saved filters.
- **Header sorting**: Task, Status and Space sort A to Z, Priority Highest to Lowest, Last modified newest first; a second click reverses. Sorted in the browser over the loaded list (up to 5000 rows); ties keep the server order. Kept in the URL as `order` and `dir` (so it is saved with the filters); choosing a sort in the Sort menu removes the header sort.
- **Click to filter**: clicking a Space or Priority cell toggles an "is" filter on that value, like Frappe Desk. Not for Status: its cell keeps changing the status (decision 2026-11-01).
- **Last modified column**: relative time ("just now", "5 minutes ago", ...), from the Task's own last edit. Comments, time logs, Action changes and the automatic Overdue switch do not count (decision 2026-11-01).

## Group 3: notification rules (branch `feat/notification-rules`, PR)

Rules (client, 2026-11-01 and 2026-11-02; the 2026-11-02 refinement narrowed who hears about what):

| Event | Task owner, assignees, mentioned | Other Space members | The actor |
|---|---|---|---|
| New comment | e-mail + push + bell (mentioned: "mentioned you") | push + bell | nothing (reverses ADR-056 / Q-P6-1) |
| Status change | owner + assignees: e-mail + push + bell | nothing | nothing |
| Assignment | only the new assignee: e-mail + push + bell (unchanged) | nothing | nothing |
| Owner change | only the new owner: e-mail + push + bell (unchanged) | nothing | nothing |
| Overdue | owner + assignees: e-mail + push + bell (the owner is new) | nothing | (automatic) |
| Reaction to a comment | only the comment's author: push + bell, no e-mail | nothing | nothing |
| Bulk status change | one summary per person (owner/assignee of any changed Task), not one per Task | nothing | nothing |

Space events (member added, role changed, ownership transferred) and all other Task changes are unchanged.
New notification kinds: Status and Reaction (`Masar Notification.kind` options; the site reloads that
DocType when deployed).

The user's e-mail switch keeps muting e-mail. Docs (ADR-056, ADR-064, docs/01, docs/04 §6-7, docs/08 AS-15) and tests are updated with the change.

## Follow-up: "Owned by me" (2026-11-02, minor, to `master` after #2 and #3)

Managers want to track the Tasks they own. The Task Lists get an **Owned by me** toggle beside
**Assigned to me** (`TaskFilterBar`, URL `mine=owned`, which the API already supported as `owned_by_me`).
Both toggles can be on together: then the list shows Tasks I own AND am assigned to (client decision
2026-11-02; URL `mine=assigned,owned`). A three-way "Everyone ·
Assigned · Owned" control was tried and reverted the same day (client decision: a separate button).

## Not changed

- Batch planning permissions (Managers only, ADR-043): the client asked to leave this as it is (2026-11-01).

## Verification limits

There is no test site: backend tests and E2E specs cannot run. Frontend typecheck, unit tests, `build:app` and `check:app` run locally; behaviour is checked by the client on production.
