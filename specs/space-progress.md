# Space progress and owner filter on the Spaces page

Status: requested by the client (2026-11-10), awaiting evaluation.
Scope: Spaces page (`/spaces`) cards and filters; Space summaries in `masar.api.spaces.list` and the
session boot payload.

## Decisions (client, 2026-11-10)

1. **Space status stays manual**, as before (In Progress, Completed, Cancelled, Closed, set by
   Space Managers or administrators). An automatic status driven by Tasks was considered and dropped.
2. Each Space card shows a **progress bar** computed from its Tasks:
   - done = Tasks with status **Completed** or **Closed**;
   - **Cancelled** Tasks are left out entirely (neither done nor remaining);
   - every other status (Open, Working, Pending Review, Changes Required, Overdue) is open;
   - percent = done / (all Tasks − Cancelled). With no countable Task the card shows
     "No tasks yet" instead of 0 % (as ADR-035 for Features).
3. The Spaces page can be **filtered by owner** as well as by status (the status filter already
   existed). The owner choices are the owners of the listed Spaces; the choice is kept in the URL
   (`?owner=<user>`), like the status filter.

## Permissions

Progress is Task data, so like `openTaskCount` it is returned only for Spaces the viewer is a member
of. An administrator browsing *All Spaces* sees no progress for Spaces they are not a member of
(`progress: null`), and the card shows no bar.

## Contract

`SpaceSummary.progress: { total, completed, open, percent } | null` (`frontend/app/types/api.ts`,
`SpaceProgress`, same shape as `PlanningProgress`). `total` excludes Cancelled Tasks; `open` equals
`openTaskCount`. One grouped query per request computes it for all listed Spaces.

## Verification

- Backend: `masar/tests/test_space_service.py` (progress counting, empty state, non-member
  administrators). Not run: there is no test site yet (client decision 2026-11-09).
- Frontend: `tests/unit/space-owners.test.ts`; the page was checked in a browser against a mocked API
  (bars, empty state, owner filter in the URL, phone width).
