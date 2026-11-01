import type { TaskListRow } from '~/types/api'
import { PRIORITIES } from '~/types/api'

// Column sorting of the Task Lists (client revision 6, 2026-11-01). The lists already hold every
// matching Task (useTasks reads all pages, up to 5000 rows), so sorting happens here, on top of the
// server order. Task, Status and Space sort A to Z first, Priority from Highest to Lowest and Last
// modified newest first; clicking the same column again reverses it. Ties keep the server order.

export type TaskColumn = 'title' | 'status' | 'space' | 'priority' | 'modified'
export type SortDirection = 'asc' | 'desc'
export interface ColumnSort { column: TaskColumn, direction: SortDirection }

export const TASK_COLUMNS: TaskColumn[] = ['title', 'status', 'space', 'priority', 'modified']

/** The direction a column starts with: Priority and Last modified start with the "highest" values. */
export const FIRST_DIRECTION: Record<TaskColumn, SortDirection> = {
  title: 'asc',
  status: 'asc',
  space: 'asc',
  priority: 'desc',
  modified: 'desc'
}

/** The sort after clicking a column header: a new column starts in its first direction, the same one flips. */
export function nextColumnSort(current: ColumnSort | null, column: TaskColumn): ColumnSort {
  if (current?.column !== column) return { column, direction: FIRST_DIRECTION[column] }
  return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}

/** Reads `order` and `dir` from a query; anything unknown means "no column sort". */
export function parseColumnSort(order: string | undefined, dir: string | undefined): ColumnSort | null {
  const column = TASK_COLUMNS.find(c => c === order)
  if (!column) return null
  return { column, direction: dir === 'asc' || dir === 'desc' ? dir : FIRST_DIRECTION[column] }
}

const text = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
// "Ascending" priority means lowest first, so Highest-to-Lowest is the descending direction.
const priorityRank = (task: TaskListRow) => PRIORITIES.length - 1 - PRIORITIES.indexOf(task.priority)

function compare(column: TaskColumn, spaceTitle: (task: TaskListRow) => string) {
  switch (column) {
    case 'title': return (a: TaskListRow, b: TaskListRow) => text.compare(a.title, b.title)
    case 'status': return (a: TaskListRow, b: TaskListRow) => text.compare(a.status, b.status)
    case 'space': return (a: TaskListRow, b: TaskListRow) => text.compare(spaceTitle(a), spaceTitle(b))
    case 'priority': return (a: TaskListRow, b: TaskListRow) => priorityRank(a) - priorityRank(b)
    case 'modified': return (a: TaskListRow, b: TaskListRow) => Date.parse(a.modified) - Date.parse(b.modified)
  }
}

/** A sorted copy; without a column sort the server order is returned unchanged. */
export function sortTasks(
  tasks: TaskListRow[],
  sort: ColumnSort | null,
  spaceTitle: (task: TaskListRow) => string = task => task.spaceTitle || task.space
): TaskListRow[] {
  if (!sort) return tasks
  const order = compare(sort.column, spaceTitle)
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...tasks].sort((a, b) => sign * order(a, b))
}
