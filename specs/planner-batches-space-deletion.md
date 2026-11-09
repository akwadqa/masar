# Planner-owned Batches and deleting empty Spaces

Client decisions of **2026-11-03**. Branch `feat/planner-batches-space-delete`.

## Decisions

1. **Only Masar Planners create Batches.** Space Managers without the `Masar Planner` role no longer can.
   A Planner needs `Masar User` as well, and need not manage any Space to create a Batch.
2. **Planning still needs full scope.** The owner plans, starts and finishes a Batch only while they hold
   `Masar Planner` **and** manage every Space whose Tasks are in it (unchanged rule of ADR-043).
   Tasks can be added only from Spaces the owner manages.
3. **Owners without the Planner role lose authority** over their existing Batches, including Batches
   created before this change. Their Batch page tells them so. A Planner who manages every participating
   Space may take the Batch over.
4. **Batch transfer goes to Planners only.** The new owner must be an active Masar Planner who manages
   every Space in the Batch. For an empty Batch, every active Planner is a candidate.
5. **A Space can be deleted only when it has no Tasks**, in any status. This replaces the cascade of
   2026-10-31. The user deletes the Tasks first. The Space's Features, Versions, Labels, files, Batch
   rows and activity are deleted with it. Who may delete is unchanged: the Space owner or a Masar
   administrator, after typing the title.
6. **Space owner and Space Manager stay separate** (a merge was considered and declined on 2026-11-03).

## Impact

- **Roles must be assigned before release.** Nobody has `Masar Planner` on production today, so after the
  release nobody can create or plan Batches until an administrator assigns it.
- Existing Batches whose owners lack the role are frozen until the owner gets it or a Planner takes over.
- Spaces with Tasks can no longer be deleted in one step. There is no bulk delete for Tasks; deleting
  many Tasks is one by one.
- API: `SpaceDetail.taskCount` (new), `BatchDetail.ownerLacksPlannerRole` (new);
  `masar.api.spaces.delete` no longer returns `tasksDeleted` and answers 417 while Tasks remain.

## Acceptance criteria

- A Space Manager without Planner, a Member, an outsider and a Masar Admin cannot create a Batch
  (403); `canCreate` is false for them.
- A Planner without any Space creates a Batch, can manage it, and cannot add Tasks of a Space they do
  not manage.
- An owner who loses Planner cannot start, edit or plan the Batch; `ownerLacksPlannerRole` is true; a
  full-scope Planner can claim it. A full-scope Manager without Planner can neither claim nor receive it.
- `owner_candidates` lists only Planners with full scope.
- Deleting a Space with Tasks (including only Completed ones) is refused for its owner and for admins;
  nothing is deleted. After its Tasks are deleted, the owner deletes it and no row links to it.
- The Delete Space card shows the task count and disables the button while Tasks remain.

## Verification

Backend tests (`test_batches.py`, `test_space_deletion.py`) and the E2E spec `space-deletion.spec.ts`
are updated but **cannot run**: there is no dev/test site. Locally verified: ruff, typecheck, vitest,
`build:app`, `check:app`.
