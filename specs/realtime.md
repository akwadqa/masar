# Realtime updates (OPT-03)

Client decisions of **2026-11-09**. Branch `feat/realtime`. Supersedes ADR-058 and moves ADR-017 from
deferred to accepted.

## Decisions

1. **Sockets replace polling as the main way to stay fresh.** Polling stays as the fallback and slows down
   while the socket is connected (supersedes ADR-058's 20 s discussion polling).
2. **New dependency `socket.io-client` (v4) is approved.** Frappe's Desk bundles its own copy, which the
   Workspace cannot load; the server runs socket.io 4.
3. **All five phases are in scope**, including typing and "is editing" markers.
4. **Every notification type shows a toast** (not only mentions and assignments).
5. **Presence shows on Tasks, Batches and Spaces.**
6. Changes are evaluated on production; there is no test site (client decision 2026-11-09).
7. **Viewers are named across Spaces** (client decision 2026-11-09, after evaluation). Frappe's
   `doc_viewers` already sends viewer ids (e-mail addresses) to everyone in a room, so a Batch shared by
   several Spaces shows the real names of all its viewers instead of "Someone". Users without Masar
   access are never named. Presence shows compact avatars, each with a pulsing green "online" dot, so they
   are not mistaken for member avatars; the names show on hover.

## Principles

- Frappe's own stack only: its socket.io server, session-cookie authentication, Redis channel and
  `frappe.publish_realtime`. No custom socket handlers, servers or brokers.
- **Personal rooms and document rooms only.** DocType rooms and Frappe's `list_update` are never used for
  Masar data: joining them checks DocType-level read only, so they would leak ids across Spaces (ADR-017).
- **Ids only.** An event says what changed; the Workspace refetches through the permission-checked API.
  A user removed from a Space gets nothing new: the refetch answers 404.
- **After commit.** Events are published with `after_commit=True`, so a rolled-back write, or one retried by
  `@masar_write` after a deadlock, sends nothing.
- **Polling is the fallback**, never removed. With the socket down, Masar behaves as before.

## Module design

One owner per job (see the proposal's "Module design" section for the reasoning).

| Module | Responsible for | Exposes |
|---|---|---|
| `masar/services/realtime_service.py` (new) | All room and payload rules; one event per target per transaction; the only caller of `frappe.publish_realtime`, always with an explicit room (inside a background job Frappe would otherwise use the job's progress room) | `space_changed(space)`, `batch_changed(batch)`, `users_notified(users)`, `task_changed(task)`, `task_activity(task, event, data)` |
| `services/activity.py` | Calls `space_changed` for an entry with a Space, `batch_changed` for a Batch entry and `task_changed` for a Task entry (comments, files, time and field changes all record Task history) | — |
| `services/comment_service.py` | `react` calls `task_changed` (reactions record no history); `typing(task)` | — |
| `services/task_service.py` | `editing(task, field, active)` for `title` and `description` | — |
| `services/space_service.py` | `people(users)`: names and avatars of active Masar users (across Spaces, decision 7); others stay unnamed | `masar.api.spaces.people` |
| `api/comments.py`, `api/tasks.py` | `comments.typing`, `tasks.editing`: POST, CSRF (`masar_write`), rate-limited to 60 a minute per Task and IP, write nothing | — |
| Task controller `on_trash` | Calls `space_changed` (a deleted Task's history is deleted with it) | — |
| `services/inbox_service.py` | Calls `users_notified` next to the Web Push wake-up | — |
| `api/session.py` | Boot adds `sitename` (Frappe's own key) and `realtime` (false when the site sets `disable_async`) | — |
| `composables/useRealtime.ts` (new) | Connect, reconnect, status; document rooms (`doc_subscribe` + `doc_open`, rejoined after reconnect) and their viewers | `useRealtime().on`, `connected`, `useDocumentRoom` |
| `utils/realtimeEvents.ts`, `utils/liveSignals.ts` (new) | Event names, the event → query-prefix map, "busy" detection; expiring typing/editing signals | — |
| `composables/workspace/useLiveRefresh.ts` (new) | Debounced invalidation that waits while the person types or drags (`queueRefresh`) | `useLiveRefresh`, `queueRefresh` |
| `composables/workspace/useTaskSignals.ts`, `usePeople.ts` (new) | Typing and edit markers for one Task; names for ids | `useTypingSignal`, `useEditMarkers`, `usePeople` |
| `components/collab/PresenceAvatars.vue` (new) | Other viewers of a Task, Batch or Space | — |
| Existing composables | React to their own events, slow their polling while connected (bell 5 min, timeline 2 min) | — |

Why `record_activity` rather than `doc_events`: the services make many direct updates (`db.set_value`,
`db_set`, `qb.update`) that skip document hooks, while every change records history.

## Events

| Event | Room | Payload | Sent when |
|---|---|---|---|
| `masar_space_changed` | `user:` of each current member and Space admin | `{space}` | Any history entry of the Space; a Task deleted |
| `masar_batch_changed` | `user:` of each user who can see the Batch | `{batch}` | Any Batch history entry |
| `masar_notification` | `user:` of each recipient | `{}` | A Masar notification was written |
| `masar_timeline` | `doc:Masar Task/<task>` | `{task}` | Comment or reaction added, edited, deleted |
| `masar_typing` | `doc:Masar Task/<task>` | `{task, user}` | Typing in the composer (at most every 3 s) |
| `masar_editing` | `doc:<DocType>/<name>` | `{doctype, name, field, user, active}` | A field opened or closed for editing |
| `doc_viewers` (Frappe) | `open_doc:<DocType>/<name>` | `{doctype, docname, users}` | A viewer opens, closes or disconnects |

## Phases

1. **Foundation:** boot `sitename`/`realtime`, `socket.io-client`, `useRealtime`, `realtime.py`.
2. **Instant notifications (F2):** `users_notified`; bell refresh and a toast for every type.
3. **Live boards (F1):** `space_changed`, `batch_changed`; invalidation of task, Batch, planning and Space
   queries.
4. **Live discussion and presence (F3, F4):** `masar_timeline`; viewers on Tasks, Batches and Spaces.
5. **Typing and edit markers (F3, F4):** write-nothing endpoints `comments.typing` and `tasks.editing`.

## Acceptance criteria

- A change by one user appears for another member within 2 s; a member of another Space receives no event.
- A rolled-back or retried write sends no event; the actor gets no toast for their own action.
- The bell badge and list update within 2 s of a notification; every notification type shows a toast.
- A comment appears in an open Task for other viewers within 2 s; a non-member cannot join the Task room.
- Viewers appear within 2 s on Tasks, Batches and Spaces and disappear within a few seconds of leaving.
- Typing and editing markers clear within 5 s and 30 s; they never block saving.
- With the socket server stopped, every screen still refreshes by polling as before.

## Verification

Local: ruff, typecheck, vitest (event map), `build:app`, `check:app`. Backend tests for `realtime.py`
(recipients, Space boundaries, rollback) are written but cannot run (no test site). Evaluation on
production with two real users in two browsers, including a phone.
