# 01 — Requirements Analysis

Status: **Draft for approval** · Last updated: 2026-10-27

This document breaks the client brief into traceable requirements. Every item carries a status:

| Status | Meaning |
|---|---|
| **CONFIRMED** | Stated explicitly by the client brief. |
| **PROPOSED** | Akwad engineering recommendation; not stated by the client. |
| **UNRESOLVED** | Needs a business decision (see [11 — Approval & Open Decisions](11-approval-questions.md)). |
| **OPTIONAL** | Outside confirmed scope; listed for awareness only, not planned. |
| **CONFLICT** | Statements in the client material that contradict each other or reality. |

Technology version choices are an Akwad responsibility (see [ADR-001](06-architecture-decisions.md#adr-001)) and are not treated as product requirements.

---

## 1. Product understanding

Masar is a dedicated Agile work-management application for Akwad's client. It replaces an ERPNext-based task-management experience that the client found too generic. It is built as a **Frappe custom app** (data, rules, permissions, files, email) with a **decoupled Nuxt frontend** that should feel like Frappe CRM / Gameplan / Linear rather than Frappe Desk.

**Business problems it solves**

1. Work is scattered across projects with no clear, access-controlled working context → **Spaces**.
2. Capturing and updating work is slow → **fast inline Tasks**, lightweight **Actions**, minimal navigation.
3. Stakeholders cannot see business progress without reading technical tasks → **Feature roadmap** (Now / Next / Later / Done).
4. Short delivery plans span several projects → **cross-Space Batches**.
5. Work needs to be tied to product versions → **Releases**.

**Primary users**

| User | Typical goals |
|---|---|
| Space Member (developer, analyst) | Capture tasks, update own work, log time, comment. |
| Space Manager (team lead, PM) | Organise the Space, membership, labels, Releases, Features. |
| Planner (lead coordinating several Spaces) | Build and run Batches across Spaces. |
| Business stakeholder | Read the Feature roadmap and Release contents. |
| System administrator | Operate the Frappe site, manage users. |

---

## 2. Terminology reconciliation

The client material mixes Jira vocabulary with Masar's own. Masar uses **its own terms only** in the UI and data model.

| Term in client material | Masar concept | Confirmed meaning | Remaining ambiguity | User-facing term |
|---|---|---|---|---|
| Project / workspace | Space | CONFIRMED: project-level work context controlling access | None | **Space** |
| Epic | Feature | INTERPRETATION: "conceptually similar to an Epic" is stated; no separate Epic type requested | Whether a Feature may span Spaces → [Q-03](11-approval-questions.md) | **Feature** |
| Story / Task / Issue | Task | INTERPRETATION: Task is the single primary work item. No Story type. | None | **Task** |
| Sub-task | Action | INTERPRETATION: Action is a lightweight checklist item that *may* be promoted to a Task. It is not a Jira sub-task (no own assignee, no own lifecycle). | None | **Action** |
| Sprint | Batch | CONFIRMED: "short, sprint-style development plans" | Lifecycle details → [ADR-012](06-architecture-decisions.md#adr-012) | **Batch** |
| Sprint backlog | Unbatched Tasks of a Space | INTERPRETATION | None | "Not in a Batch" |
| Version / Release | Release | CONFIRMED: "Version and Release refer to the same concept" | Scope → [Q-01](11-approval-questions.md) | **Release** (field label "Version" shown as the Release name) |
| Board / Kanban | Feature roadmap board | CONFIRMED for Features only. Tasks never get a stage board. | None | **Roadmap** |
| Status (Task) | Completion flag | CONFIRMED: Tasks have no stages; a task can be completed | None | "Completed" / "Open" |

---

## 3. Requirement catalogue

IDs are stable; never renumber. Columns: **Status**, **Model** (see [02](02-domain-data-model.md)), **Screen** (see [05](05-product-ux.md)), **Phase** (see [07](07-implementation-roadmap.md)), **Verification** (U = unit, I = integration/API, P = permission test, E = end-to-end browser, M = manual review).

### 3.1 Spaces

| ID | Requirement | Status | Model | Screen | Phase | Verif. |
|---|---|---|---|---|---|---|
| MASAR-SPACE-001 | Space has Title, Category, Owner, Details, Completion date, Type (Internal/External), Status (In Progress/Completed/Cancelled/Closed), Department (ERP/App), Gameplan link | CONFIRMED | Masar Space | Space Summary / Settings | P1 (core), P2 (full) | U, E |
| MASAR-SPACE-002 | Space lists users with access, each with role Manager or Member | CONFIRMED | Masar Space Member | Space Settings | P1 | U, P |
| MASAR-SPACE-003 | Space access determines who can view and modify its data | CONFIRMED | Permission hooks | All | P1 | P |
| MASAR-SPACE-004 | Space has three tabs: Active Batches, Task List, Summary | CONFIRMED | — | Space detail | P1 (Task List), P2 (Summary), P5 (Active Batches) | E |
| MASAR-SPACE-005 | Gameplan relationship is a link only; no synchronisation | CONFIRMED | `gameplan_url` | Summary | P2 | U |
| MASAR-SPACE-006 | Space Owner is always a Manager and cannot lose access without an explicit ownership transfer | PROPOSED | Masar Space validate | Settings | P2 | U, P |
| MASAR-SPACE-007 | A Space always has at least one Manager | PROPOSED | Masar Space validate | Settings | P2 | U |
| MASAR-SPACE-008 | Removing a member removes them from open-task assignees in that Space and reassigns task ownership in the same transaction; history is preserved | PROPOSED | `space_service.remove_member` | Settings | P2 | I, P |
| MASAR-SPACE-009 | Non-"In Progress" Spaces are read-only for Members and hidden from default pickers | UNRESOLVED (Q-06) | Masar Space | Overview | P2 | P |
| MASAR-SPACE-010 | Who may create Spaces | UNRESOLVED (Q-05) | Role | Overview | P2 | P |
| MASAR-SPACE-011 | Space lifecycle Status is distinct from the Feature Roadmap field | CONFIRMED | — | — | P1 | M |

### 3.2 Tasks

| ID | Requirement | Status | Model | Screen | Phase | Verif. |
|---|---|---|---|---|---|---|
| MASAR-TASK-001 | Task has Title, Description, Due date, Priority (Lowest/Low/Medium/High/Highest), Creator, Created timestamp | CONFIRMED | Masar Task | Task List, Detail | P1 | U, E |
| MASAR-TASK-002 | Task has exactly one primary Space | CONFIRMED (relationship model PROPOSED in brief, confirmed here) | `Masar Task.space` | — | P1 | U, P |
| MASAR-TASK-003 | Task optionally links to one Feature, one Batch (current), one Release | PROPOSED cardinality | Masar Task | Detail, List | P4/P5 | U |
| MASAR-TASK-004 | Feature and Release referenced by a Task must belong to the Task's Space | PROPOSED | Masar Task validate | — | P4 | U, P |
| MASAR-TASK-005 | Multiple assignees supported | CONFIRMED | Masar Task Assignee | Detail, List | P1 | U |
| MASAR-TASK-006 | With assignees present, a task owner is mandatory and must be an assignee; the first assignee is the default owner | CONFIRMED (+ "must be an assignee" PROPOSED) | Masar Task validate | Detail | P1 | U |
| MASAR-TASK-007 | Assignees and owner must be current members of the Task's Space | PROPOSED | validate | Detail | P1 | U, P |
| MASAR-TASK-008 | Tasks have no stages; no stage workflow, filter or board | CONFIRMED | — | — | All | M |
| MASAR-TASK-009 | Task can be marked completed and reopened; completion records actor and timestamp | CONFIRMED (completion) / PROPOSED (audit fields) | `is_completed`, `completed_at`, `completed_by` | List, Detail | P1 | U, E |
| MASAR-TASK-010 | Inline task entry directly in the Task List without a form | CONFIRMED | `task_service.create` | Task List | P1 | E |
| MASAR-TASK-011 | Inline entry never loses typed content and never creates empty or duplicate tasks | CONFIRMED | `client_request_id` | Task List | P1 | I, E |
| MASAR-TASK-012 | Task opens in a side panel and as a full page (direct-link compatible) | CONFIRMED | — | Detail panel / page | P1 | E |
| MASAR-TASK-013 | Concurrent edits to the same field are detected, not silently overwritten | PROPOSED | field-base conflict check | Detail, List | P1 | I |

### 3.3 Actions

| ID | Requirement | Status | Model | Screen | Phase | Verif. |
|---|---|---|---|---|---|---|
| MASAR-ACTION-001 | Each Task has a dynamically editable, ordered list of Actions (add, edit, complete, reorder) | CONFIRMED (reorder PROPOSED) | Masar Task Action | List (expanded), Detail | P3 | U, E |
| MASAR-ACTION-002 | Actions appear indented under an expanded Task row | CONFIRMED | — | Task List | P3 | E |
| MASAR-ACTION-003 | An Action can be promoted to a standalone Task, exactly once, transactionally, with lineage | CONFIRMED (promotion) / PROPOSED (rules) | `action_service.promote` | List, Detail | P3 | I, E |

### 3.4 Labels and attributes

| ID | Requirement | Status | Model | Screen | Phase | Verif. |
|---|---|---|---|---|---|---|
| MASAR-LABEL-001 | Labels are shared within a Space; users can create new ones | CONFIRMED | Masar Label | List, Detail, Settings | P3 | U, P |
| MASAR-LABEL-002 | Built-in Important (star) and My Day (sun) are shared Space attributes, not personal markers | CONFIRMED | `is_important`, `is_my_day` on Task | List, Detail | P3 | U |
| MASAR-LABEL-003 | A Task can only carry labels of its own Space; label names are unique per Space (case-insensitive) | PROPOSED | validate + unique index | — | P3 | U, P |

### 3.5 Collaboration

| ID | Requirement | Status | Model | Screen | Phase | Verif. |
|---|---|---|---|---|---|---|
| MASAR-COLLAB-001 | Task activity timeline filterable by Comments, History, Worklog | CONFIRMED | Comment, Activity, Time Entry | Detail | P6 | I, E |
| MASAR-COLLAB-002 | Comments with create, edit (own), delete (own) | CONFIRMED | Masar Comment | Detail | P6 | U, P |
| MASAR-COLLAB-003 | Managers may soft-delete others' comments; nobody edits others' comments | UNRESOLVED (Q-04, default proposed) | Masar Comment | Detail | P6 | P |
| MASAR-COLLAB-004 | Email notification on new comment to all users currently authorised for the Task's Space (except the author) | CONFIRMED | `notification_service` | — | P7 | I |
| MASAR-COLLAB-005 | @mentions of Space members | CONFIRMED | parsed from content | Detail | P6 | U |
| MASAR-COLLAB-006 | Emoji reactions incl. like / thumbs-up; one reaction per user per emoji per comment | CONFIRMED (uniqueness PROPOSED) | Masar Comment Reaction | Detail | P6 | U |
| MASAR-COLLAB-007 | Direct link to an individual comment opens the Task and focuses the comment, only if authorised | CONFIRMED | — | Detail | P6 | P, E |
| MASAR-COLLAB-008 | Pasted images/files in comments and Task-level attachments | CONFIRMED | Frappe File (private) | Detail | P6 | P, E |
| MASAR-COLLAB-009 | Activity history records task changes | CONFIRMED | Masar Activity | Detail | P1 (recording), P6 (UI) | U |

### 3.6 Time tracking

| ID | Requirement | Status | Model | Screen | Phase | Verif. |
|---|---|---|---|---|---|---|
| MASAR-TIME-001 | Users record time spent on a Task | CONFIRMED | Masar Time Entry | Detail | P7 | U, E |
| MASAR-TIME-002 | Optionally update estimated remaining time when logging | CONFIRMED | `Masar Task.remaining_minutes` | Detail | P7 | U |
| MASAR-TIME-003 | Saved entries are reviewable in the Worklog | CONFIRMED | — | Detail | P7 | E |
| MASAR-TIME-004 | Default interaction is manual entry; no timer in the initial release | PROPOSED | — | Detail | P7 | M |

### 3.7 Main Task List

| ID | Requirement | Status | Screen | Phase | Verif. |
|---|---|---|---|---|---|
| MASAR-LIST-001 | Sidebar/adjacent navigation with Batches and Releases | CONFIRMED | Shell, Task List | P1 (shell), P5 | E |
| MASAR-LIST-002 | Filters: Feature, Release, Batch, Assigned to Me, Owned by Me, Recently Updated | CONFIRMED | Task List | P1 (me-filters), P4, P5 | I, E |
| MASAR-LIST-003 | Hover controls to change Batch or Release | CONFIRMED | Task List | P4/P5 | E |
| MASAR-LIST-004 | Multi-selection and bulk assignment to a Batch, including Tasks from different Spaces | CONFIRMED | Task List, Batch planning | P5 | I, P, E |
| MASAR-LIST-005 | Batch-grouped display with header rows | CONFIRMED | Task List | P5 | E |
| MASAR-LIST-006 | Drag Tasks between Batch groups, with a keyboard/menu alternative | CONFIRMED (alternative PROPOSED) | Task List | P5 | E |
| MASAR-LIST-007 | Expandable rows revealing indented Actions | CONFIRMED | Task List | P3 | E |
| MASAR-LIST-008 | Keyboard-first navigation and editing | PROPOSED | Task List | P3 | E |

### 3.8 Features

| ID | Requirement | Status | Model | Screen | Phase | Verif. |
|---|---|---|---|---|---|---|
| MASAR-FEATURE-001 | Feature represents a business capability; has Roadmap ∈ {Now, Next, Later, Done} exactly | CONFIRMED | Masar Feature | Roadmap | P4 | U |
| MASAR-FEATURE-002 | Kanban board by Roadmap value; move Features between columns | CONFIRMED | — | Roadmap | P4 | E |
| MASAR-FEATURE-003 | Inspect a Feature's Tasks | CONFIRMED | — | Feature panel | P4 | E |
| MASAR-FEATURE-004 | Feature belongs to exactly one Space | UNRESOLVED (Q-03, default proposed) | Masar Feature | — | P4 | P |
| MASAR-FEATURE-005 | Feature progress = completed / total linked Tasks; independent of the roadmap column (Done does not complete Tasks) | PROPOSED (directive P4) | derived | Roadmap, Feature panel | P4 | U, E |
| MASAR-FEATURE-006 | A Task links to 0..1 Feature of its own Space; filter and bulk-assign by Feature | PROPOSED (directive P4) | `Masar Task.feature` | Task List, Detail, My Work | P4 | U, I, E |

### 3.9 Batches

| ID | Requirement | Status | Model | Screen | Phase | Verif. |
|---|---|---|---|---|---|---|
| MASAR-BATCH-001 | Batch has Name, Start date, End date, included Tasks; One Week / Two Weeks presets | CONFIRMED | Masar Batch | Batch planning | P5 | U, E |
| MASAR-BATCH-002 | A Batch can include Tasks from multiple Spaces (mandatory) | CONFIRMED | Masar Batch Item | Batch planning | P5 | I, P |
| MASAR-BATCH-003 | Lifecycle Planned → Active → Completed; multiple Active Batches allowed | PROPOSED | Masar Batch | Batch planning | P5 | U |
| MASAR-BATCH-004 | A Task is in at most one Planned/Active Batch at a time; participation history is retained | PROPOSED | Masar Batch Item | — | P5 | U, I |
| MASAR-BATCH-005 | Finishing a Batch requires choosing where unfinished Tasks go (another open Batch or no Batch); no duplication | PROPOSED | `batch_service.finish` | Batch | P5 | I, E |
| MASAR-BATCH-006 | Progress = completed / total of the viewer-visible Tasks; historical outcome snapshot at finish | PROPOSED | Masar Batch Item | Batch | P5 | U, P |
| MASAR-BATCH-007 | A viewer only ever sees Tasks (and any derived data) from Spaces they can access | CONFIRMED | permission services | All Batch views | P5 | P |
| MASAR-BATCH-008 | Batch authority (create/edit/start/finish) | UNRESOLVED (Q-02, default proposed) | Role + owner | Batch | P5 | P |

### 3.10 Releases

| ID | Requirement | Status | Model | Screen | Phase | Verif. |
|---|---|---|---|---|---|---|
| MASAR-RELEASE-001 | Release has Version/name, Release date, Status, associated Tasks | CONFIRMED | Masar Release | Releases | P4 | U, E |
| MASAR-RELEASE-002 | Statuses: Planned, Released, Archived | PROPOSED | Masar Release | Releases | P4 | U |
| MASAR-RELEASE-003 | Release scope: one Space | UNRESOLVED (Q-01, default proposed) | Masar Release | — | P4 | P |
| MASAR-RELEASE-004 | Marking Released with open Tasks warns but is allowed | UNRESOLVED (Q-07, default proposed) | `release_service` | Releases | P4 | I |
| MASAR-RELEASE-005 | Release name/version unique per Space after normalisation (trim, collapse spaces, case-insensitive) | PROPOSED (directive P4) | `Masar Release.release_key` | Releases | P4 | U |
| MASAR-RELEASE-006 | Archived Releases are read-only and keep their Task links frozen | PROPOSED (directive P4) | Task controller | Releases, Detail | P4 | U, E |
| MASAR-RELEASE-007 | A Task links to 0..1 Release of its own Space; filter and bulk-assign by Release | PROPOSED (directive P4) | `Masar Task.target_release` | Task List, Detail, My Work | P4 | U, I, E |

### 3.11 Security and platform

| ID | Requirement | Status | Phase | Verif. |
|---|---|---|---|---|
| MASAR-SEC-001 | Authentication via Frappe sessions; no privileged credentials in the frontend | CONFIRMED (no shared credentials) / PROPOSED (mechanism) | P1 | I, E |
| MASAR-SEC-002 | Space roles are contextual per Space; global roles alone are insufficient | CONFIRMED | P1 | P |
| MASAR-SEC-003 | Every list, detail, search, count, aggregate, file, email and realtime event is filtered by Space access on the server | CONFIRMED | All | P |
| MASAR-SEC-004 | Unauthorised and non-existent records are indistinguishable to the caller (404) | PROPOSED | P1 | P |
| MASAR-SEC-005 | Rich text is sanitised server-side | PROPOSED | P6 | U |
| MASAR-SEC-006 | ERPNext is not a dependency; ERPNext DocTypes are not used | CONFIRMED | All | M |
| MASAR-PLAT-001 | Backend: dedicated Frappe custom app; frontend: decoupled Nuxt + Nuxt UI + TypeScript | CONFIRMED (versions: Akwad decision, ADR-001) | P0 | M |
| MASAR-PLAT-002 | frappe-ui-inspired resource layer on Nuxt primitives; frappe-ui not imported as the data layer | CONFIRMED | P1 | U |

---

### 3.12 Implementation traceability: Phase 4

| Requirement | Implemented by | Decision | Evidence |
|---|---|---|---|
| MASAR-FEATURE-001 | MASAR-DATA-003, MASAR-API-008 | ADR-034 | `TestFeatures`, E2E A |
| MASAR-FEATURE-002 | MASAR-API-008, MASAR-UI-009 | ADR-038 | `test_roadmap_order_and_movement`, `test_duplicate_slot_is_renumbered`, E2E B, C, J |
| MASAR-FEATURE-003 | MASAR-UI-009 | — | E2E D, E |
| MASAR-FEATURE-004 | MASAR-DATA-003, MASAR-AUTHZ-003 | ADR-034, ADR-037 | `test_features_are_invisible_outside_the_space`, E2E I |
| MASAR-FEATURE-005 | MASAR-API-008 | ADR-035 | `test_create_list_progress_and_empty_state`, `test_progress_counts_only_linked_tasks_of_the_space`, E2E D |
| MASAR-FEATURE-006 | MASAR-API-010, MASAR-UI-011 | ADR-034 | `TestTaskPlanningLinks`, E2E E, H |
| MASAR-RELEASE-001 | MASAR-DATA-003, MASAR-API-009, MASAR-UI-010 | ADR-036 | `TestReleases`, E2E F |
| MASAR-RELEASE-002 | MASAR-API-009 | ADR-036 | `test_lifecycle_open_task_warning_and_archived_freeze`, E2E G |
| MASAR-RELEASE-003 | MASAR-DATA-003, MASAR-AUTHZ-003 | ADR-034, ADR-037 | `test_invalid_transition_and_permissions`, E2E I |
| MASAR-RELEASE-004 | MASAR-API-009, MASAR-UI-010 | ADR-036 | E2E G (warning dialog; Tasks stay open) |
| MASAR-RELEASE-005 | MASAR-DATA-003 | ADR-040 | `test_version_uniqueness_is_normalised_per_space`, E2E F, J |
| MASAR-RELEASE-006 | MASAR-DATA-003, MASAR-API-009 | ADR-036, ADR-039 | `test_lifecycle_…`, E2E G |
| MASAR-RELEASE-007 | MASAR-API-010, MASAR-UI-011 | ADR-034 | `test_bulk_set_feature_and_release`, E2E H |

Q-01, Q-03 and Q-07 are implemented with their proposed defaults and remain **provisional** ([11](11-approval-questions.md)).

### 3.13 Implementation traceability: Phase 5

| Requirement | Implemented by | Decision | Evidence |
|---|---|---|---|
| MASAR-BATCH-001 | MASAR-DATA-004, MASAR-API-011, MASAR-UI-012 | ADR-046, ADR-047 | `test_presets_are_inclusive_calendar_days`, unit `batches.test.ts`, E2E Planning |
| MASAR-BATCH-002 | MASAR-API-011, MASAR-API-012, MASAR-UI-012 | ADR-043, ADR-046 | `test_cross_space_planning_keeps_each_task_in_its_space`, E2E Planning (two Spaces) |
| MASAR-BATCH-003 | MASAR-API-011 | ADR-046 (Planned → Active → Finished; "Finished" replaces "Completed") | `test_start_is_explicit_idempotent_and_changes_no_task`, `test_N_lifecycle_validation`, E2E Start |
| MASAR-BATCH-004 | MASAR-DATA-004 | ADR-044 | `test_H_one_current_batch_per_task`, live concurrent assignment |
| MASAR-BATCH-005 | MASAR-API-011, MASAR-UI-012 | ADR-049, ADR-050 | `test_J_K_…`, `test_finish_returns_unfinished_work_and_closed_spaces`, `test_I_O_…`, E2E Finish |
| MASAR-BATCH-006 | MASAR-API-011 | ADR-048 | `test_A_E_partial_viewers_see_only_their_spaces`, E2E Execution and progress |
| MASAR-BATCH-007 | MASAR-AUTHZ-004 | ADR-045 | `TestBatchVisibility`, E2E Isolation |
| MASAR-BATCH-008 | MASAR-AUTHZ-004 | ADR-043 (provisional Q-02 default) | `TestBatchAuthority`, E2E Isolation |

Q-02 and Q-09 are implemented with restrictive provisional policies ([11](11-approval-questions.md)).

### 3.14 Implementation traceability: Phase 6

| Requirement | Implemented by | Decision | Evidence |
|---|---|---|---|
| MASAR-COLLAB-001 | MASAR-API-016, MASAR-UI-014 | ADR-057 | `TestTimeline`, E2E 7, 11 |
| MASAR-COLLAB-002 | MASAR-API-014, MASAR-UI-014 | ADR-051 | `test_create_list_and_idempotency_N`, `test_C_D_…`, E2E 1–5 |
| MASAR-COLLAB-003 | MASAR-API-014 | ADR-051 (provisional Q-04 default) | `test_C_D_ownership_and_moderation`, E2E 4–6 |
| MASAR-COLLAB-004 | MASAR-API-017 | ADR-056 (author included pending Q-P6-1; external SMTP Pending) | `TestNotifications`, E2E 12 (mail sink, local only) |
| MASAR-COLLAB-005 | MASAR-API-014, MASAR-UI-014 | ADR-052 | `test_F_mentions_are_members_only`, E2E 1–3 |
| MASAR-COLLAB-006 | MASAR-API-014 | ADR-053 | `test_M_reactions_are_unique_and_own`, E2E 6, 13 |
| MASAR-COLLAB-007 | MASAR-API-016, MASAR-UI-014 | ADR-057 | `test_H_anchor_reaches_old_comments`, E2E 7, 10 |
| MASAR-COLLAB-008 | MASAR-API-015, MASAR-AUTHZ-005 | ADR-054, ADR-055 | `TestAttachments`, E2E 8–10, I/J |
| MASAR-COLLAB-009 | MASAR-API-016 | ADR-057 | `test_ordering_pagination_and_history`, `test_Q_…` |

MASAR-COLLAB-004 was planned for P7 in Phase 0. Phase 6 implements it on request, with external delivery pending SMTP.

### 3.15 Implementation traceability: Phase 7

| Requirement | Implemented by | Decision | Evidence |
|---|---|---|---|
| MASAR-TIME-001 | MASAR-DATA-006, MASAR-API-018, MASAR-AUTHZ-006, MASAR-UI-015 | ADR-060, ADR-061 | `TestModel`, `TestLogging`, `TestCorrections`, `TestTimeAuthorization`; E2E A–C, E–I, N, O |
| MASAR-TIME-002 | MASAR-DATA-006, MASAR-API-018, MASAR-UI-015 | ADR-062 | `test_D_estimate_…`, `test_J_…`; E2E D, J; UI "rejected save" |
| MASAR-TIME-003 | MASAR-API-019, MASAR-UI-015 | ADR-063 | `TestWorklogAndInvariants`; E2E K, L, M |
| MASAR-TIME-004 | MASAR-UI-015 | ADR-060 (no timer, no completion prompt) | Manual review: no timer UI or completion prompt exists |
| Deployment consistency (directive §3.1) | MASAR-DEPLOY-007 | ADR-059 | `release.sh` gates in the Phase 7 release log |

ADR-014 (Phase 0) is amended by ADR-060 and ADR-061: Managers void others' entries with a reason instead of editing them, and there is no completion prompt (Q-12 stays open).

## 4. Conflicts and their resolution

| ID | Conflict | Resolution |
|---|---|---|
| CONFLICT-01 | Brief requires Nuxt 3 + Nuxt UI v3. Nuxt 3 reached end-of-life on 2026-07-31; Nuxt UI v3 is frozen at v3.3.7 (Oct 2025). | Akwad selects Nuxt 4.6.x + Nuxt UI 4.12.x under its technology authority. Recorded in ADR-001. |
| CONFLICT-02 | Brief suggests native UTable for grouped, expandable, draggable rows. Verified UTable behaviour does not combine grouping, expanded rows, virtualisation and drag-and-drop reliably. | Decided after Phase 0 Task List spike — ADR-008. |
| CONFLICT-03 | Jira vocabulary (Epic, Story, Sub-task, Sprint) vs Masar vocabulary. | Masar vocabulary only (§2). No extra DocTypes. |
| CONFLICT-04 | "Task does not have stages" vs "a task can be marked completed". | Single completion flag with audit fields; not a stage (ADR-010). |
| CONFLICT-05 | Space statuses "Completed" and "Closed" both exist with no stated difference. | Kept as given; behavioural difference asked in Q-06. |

## 5. Explicitly out of scope

- ERPNext, ERPNext Project/Task/Timesheet DocTypes.
- Task stages, task-stage Kanban, task-stage filters, workflow engines.
- Separate Epic / Story / Sub-task DocTypes.
- Gameplan synchronisation or API integration (link only).
- Portfolio management, resource forecasting, Gantt charts, dependency graphs, financials.
- Advanced reporting / BI platform, exports (none requested).
- Release deployment automation / CI-CD integration.
- In-app notification centre (only email notifications are requested).
- Personal (private) task markers — Important/My Day are shared.
- Start/stop timers (initial release).
- AI assistants.

## 6. Optional future considerations (not planned)

| ID | Idea | Why it might matter |
|---|---|---|
| OPT-01 | Start/stop timer on top of manual entry | Convenience for heavy time loggers. |
| OPT-02 | In-app notification inbox | Reduces email reliance. |
| OPT-03 | Realtime live list updates for other users' edits | Collaboration freshness (Phase 1 uses refetch-on-focus). |
| OPT-04 | Saved personal filter views | Faster navigation. |
| OPT-05 | Burn-down chart for Batches | Richer sprint analytics. |
| OPT-06 | CSV export of a Space's Tasks | Reporting. Would require the same permission filtering. |
