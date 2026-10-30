import type { BatchRef, TaskAction, TaskListRow } from '~/types/api'
import type { TaskDraft } from '~/utils/drafts'

// Flattened row model rendered by the virtualised TaskList (ADR-008). Rows are keyed by record
// identity (never by index), so virtual row reuse cannot move selection or expansion state.
export type TaskListItem =
  | { kind: 'task', key: string, task: TaskListRow }
  | { kind: 'draft', key: string, draft: TaskDraft }
  | { kind: 'action', key: string, action: TaskAction, task: TaskListRow }
  | { kind: 'actions-status', key: string, task: TaskListRow, status: 'loading' | 'empty' | 'error' }
  | { kind: 'group', key: string, batch: BatchRef | null, count: number, collapsed: boolean }

export type ExpandedActions = Record<string, TaskAction[] | 'loading' | 'error'>

export interface BatchGrouping {
  /** Batch names whose groups are collapsed ('none' = the unbatched group) */
  collapsed: ReadonlySet<string>
}

const STATUS_ORDER = { Active: 0, Planned: 1, Finished: 2 } as const

/** Batch groups in display order: Active, then Planned (by title), then tasks without a Batch. */
export function groupTasksByBatch(tasks: TaskListRow[]): Array<{ batch: BatchRef | null, tasks: TaskListRow[] }> {
  const groups = new Map<string, { batch: BatchRef | null, tasks: TaskListRow[] }>()
  for (const task of tasks) {
    const key = task.batch?.name ?? 'none'
    if (!groups.has(key)) groups.set(key, { batch: task.batch, tasks: [] })
    groups.get(key)!.tasks.push(task)
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.batch || !b.batch) return a.batch ? -1 : b.batch ? 1 : 0
    return STATUS_ORDER[a.batch.status] - STATUS_ORDER[b.batch.status] || a.batch.title.localeCompare(b.batch.title)
  })
}

/** Pending drafts sit directly under the inline input, then tasks, each followed by its expanded Actions.
 *  With `grouping`, tasks are preceded by Batch group headers; collapsed groups show only the header. */
export function buildTaskRows(
  tasks: TaskListRow[],
  drafts: TaskDraft[],
  expanded: ExpandedActions = {},
  grouping?: BatchGrouping
): TaskListItem[] {
  const confirmed = new Set(tasks.map(t => t.clientRequestId).filter(Boolean))
  const rows: TaskListItem[] = drafts
    .filter(draft => !confirmed.has(draft.id))
    .map(draft => ({ kind: 'draft', key: `draft:${draft.id}`, draft }))
  if (grouping) {
    for (const group of groupTasksByBatch(tasks)) {
      const id = group.batch?.name ?? 'none'
      const collapsed = grouping.collapsed.has(id)
      rows.push({ kind: 'group', key: `group:${id}`, batch: group.batch, count: group.tasks.length, collapsed })
      if (!collapsed) appendTasks(rows, group.tasks, expanded)
    }
    return rows
  }
  appendTasks(rows, tasks, expanded)
  return rows
}

function appendTasks(rows: TaskListItem[], tasks: TaskListRow[], expanded: ExpandedActions) {
  for (const task of tasks) {
    rows.push({ kind: 'task', key: `task:${task.name}`, task })
    const actions = expanded[task.name]
    if (actions === undefined) continue
    if (actions === 'loading' || actions === 'error') {
      rows.push({ kind: 'actions-status', key: `actions-status:${task.name}`, task, status: actions })
    } else if (!actions.length) {
      rows.push({ kind: 'actions-status', key: `actions-status:${task.name}`, task, status: 'empty' })
    } else {
      for (const action of actions) rows.push({ kind: 'action', key: `action:${action.name}`, action, task })
    }
  }
}

/** New tasks take the top position (server places them first in manual order and recency). */
export function insertTask(rows: TaskListRow[], task: TaskListRow): TaskListRow[] {
  if (rows.some(row => row.name === task.name)) return rows
  return [task, ...rows]
}

export function nextFocusIndex(current: number, delta: number, length: number): number {
  if (length === 0) return -1
  if (current < 0) return delta > 0 ? 0 : length - 1
  return Math.min(length - 1, Math.max(0, current + delta))
}
