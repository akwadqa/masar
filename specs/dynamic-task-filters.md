# Dynamic task filters and extra sorts

Status: approved by the client (2026-10-31), open questions below.
Scope: Task List filter bar (Space Task List and All Tasks), All Tasks sorts, Spaces page sort.

## Why

The filter bar has one fixed control per field (Status, Owner, Assignee, Space, Priority, Label).
It grows with every new field and cannot express "is not" or "is empty" (for example unassigned
Tasks). The client asked for a field / operator / value filter that stays simple.

## Decisions (client, 2026-10-31)

1. Filters are **chips** built with one "+ Filter" button: pick a field, then its values. A chip
   reads `Field · operator · values · ×`; each part can be changed by clicking it.
2. **Values in one chip are OR**, **chips are AND**. There is no user-chosen AND/OR between chips and
   no grouping. One chip per field: choosing a field that already has a chip opens that chip.
3. Operators: `is` (any of the values), `is not` (none of the values), `is empty`, `is not empty`.
   Each field offers only the operators that mean something for it (table below).
4. Feature, Version and Batch keep their side panels and chips as they are today.
5. Search, "Assigned to me", "Important", "Group by Batch" and Sort stay outside the chip builder,
   because they are used constantly.
6. Task List sorts, both on the Space Task List and on All Tasks: **Recently updated** (default) and
   **Creation date** (newest first). **Manual order is removed from both lists** (client, 2026-10-31):
   `sort_order` values of different Spaces cannot be compared, and Task rows cannot be reordered by
   hand anyway. The backend keeps the `manual` sort for Batch boxes (`useBatches`), which still use
   it. Old links with `sort=manual` fall back to Recently updated.
7. Spaces page gets a sort: **Name** (A–Z, today's order and the default) and **Creation date**
   (newest first).
8. The E2E specs are updated to the new controls.

## Fields and operators

| Field    | Where                     | is | is not | is empty | is not empty | Notes |
|----------|---------------------------|----|--------|----------|--------------|-------|
| Status   | both lists                | ✓  | ✓      |          |              | Required field |
| Assignee | both lists                | ✓  | ✓      | ✓        | ✓            | Empty = no assignee |
| Owner    | both lists                | ✓  | ✓      |          |              | Every Task has an owner |
| Priority | both lists                | ✓  | ✓      |          |              | Becomes multi-value |
| Label    | Space list; All Tasks with one Space chosen | ✓ | ✓ | ✓ | ✓ | Becomes multi-value |
| Space    | All Tasks                 | ✓  |        |          |              | Scope of the list; Labels need exactly one Space |

`is not` on Assignee or Label excludes a Task that has *any* of the chosen values.
`is not` keeps Tasks with no value (an unassigned Task is "not assigned to Alaa").

## URL and API contract

Existing links keep working: a plain `status=a,b` still means `is`.

- URL: `<param>=<values>` plus an optional `<param>_op=not|empty|set`
  (`is` is the default and is never written). `empty` and `set` carry no values.
  Params: `status`, `assignee`, `owner`, `priority`, `label`, `spaces`.
- API (`masar.api.tasks.list` / `my_work`): the same idea, `statuses_op`, `assignees_op`,
  `owners_op`, `priority_op`, `label_op`. `priority` accepts a list. Unknown operators, or an
  operator the field doesn't support, raise a validation error (no silent fallback).
- New sort value `created` (`creation desc, name desc`) in `task_service.SORTS`.
- `SpaceSummary` gains `creation` (ISO datetime). `frontend/app/types/api.ts`, tests and docs are
  updated together.

Security: the operators only narrow Tasks of Spaces already authorised in `_query_tasks`; Label
values are still validated against the listed Space. No new data is read about users.

## Phases

1. **Backend**: operators, multi-value priority, `created` sort, `creation` on Space summaries.
   Integration tests.
2. **Frontend**: `useTaskFilters` reads and writes operators; new chip builder replaces the fixed
   Status/Owner/Assignee/Space/Priority/Label controls in `TaskFilterBar`; All Tasks sorts; Spaces
   sort. Unit tests for URL parsing.
3. **E2E** updates, build (`npm run build:app`), docs (`docs/05-product-ux.md`).

## Acceptance criteria

- A user can add "Assignee is empty" and see only unassigned Tasks, in both lists.
- "Status is not Done" plus "Priority is High, Urgent" shows Tasks matching both.
- Removing a chip, "Clear filters", reload and back navigation behave as today (URL is the state).
- Old URLs (`?status=Open&owner=x`) give the same results as before.
- Choosing an unsupported operator via the URL is ignored by the UI and rejected by the API.
- Both Task Lists offer Recently updated and Creation date only; each orders correctly and pages
  without duplicates or gaps. `sort=manual` in an old link shows Recently updated.
- The Spaces page sorts by name or newest first; the choice is kept in the URL.
- Keyboard: the builder is reachable and usable by keyboard, chips have accessible names,
  layout works on phones (no horizontal scroll).
- Non-members still get 404 and no filter combination reveals Tasks from other Spaces.

## Tests

- Backend (`masar/tests/test_task_filter_operators.py`): each operator per field, AND of chips,
  `is not` keeping empty values, invalid operator rejected, label of another Space rejected,
  Space isolation, `created` sort and keyset paging, Space `creation`.
- Frontend unit: URL ⇄ filter parsing (operators, legacy links, invalid values).
- E2E: replace the "Filter by status/owner/priority/label" steps with the chip builder; add one
  flow for "Assignee is empty" and one for the All Tasks and Spaces sorts.

## Verification environment

Backend tests, the build and E2E need Bench and Node 24. They run on a dev/test site only, never
on production (`CLAUDE.md`). The target host is still to be confirmed.
