import type {
  BulkOperation,
  BulkResult,
  CreateTaskResult,
  EditableTaskFields,
  Page,
  TaskDetail,
  TaskListFilters,
  TaskListRow,
  TaskSearchResult,
  UserRef
} from '~/types/api'
import { FINISHED_STATUSES } from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'

const LIST_PREFIX = 'tasks:list:'
const WORK_PREFIX = 'tasks:mywork:'
const PAGE_SIZE = 500
const MAX_ROWS = 5000

export const DEFAULT_FILTERS: TaskListFilters = {
  completed: 'open',
  assignedToMe: false,
  ownedByMe: false,
  sort: 'manual'
}

/** Stable serialisation: identical filters always produce the same cache key. */
function filterKey(filters: TaskListFilters): string {
  const ordered = Object.keys(filters).sort().reduce<Record<string, unknown>>((acc, key) => {
    const value = (filters as unknown as Record<string, unknown>)[key]
    if (value !== undefined && value !== null && value !== false && value !== '') acc[key] = value
    return acc
  }, {})
  return JSON.stringify(ordered)
}

export function taskListKey(space: string, filters: TaskListFilters) {
  return `${LIST_PREFIX}${space}:${filterKey(filters)}`
}

export function myWorkKey(filters: TaskListFilters) {
  return `${WORK_PREFIX}${filterKey(filters)}`
}

/** Whether a brand-new, unassigned, open task would appear in a list with these filters. */
export function filtersAdmitNewTask(filters: Partial<TaskListFilters>): boolean {
  return filters.completed !== 'completed' && (!filters.statuses?.length || filters.statuses.includes('Open'))
    && !filters.owners?.length && !filters.assignedToMe && !filters.ownedByMe && !filters.important
    && !filters.myDay && !filters.priority && !filters.due && !filters.label && !filters.q
    && (!filters.feature || filters.feature === 'none') && (!filters.release || filters.release === 'none')
    && (!filters.batch || filters.batch === 'none')
}

export function parseListKey(key: string): TaskListFilters | null {
  const json = key.slice(key.indexOf('{'))
  try {
    return { ...DEFAULT_FILTERS, ...(JSON.parse(json) as Partial<TaskListFilters>) }
  } catch {
    return null
  }
}

export function toQuery(f: TaskListFilters) {
  return {
    // Chosen statuses are exact; without a choice the list shows unfinished Tasks.
    completed: f.statuses?.length ? 'all' : f.completed,
    statuses: f.statuses?.length ? f.statuses.join(',') : undefined,
    owners: f.owners?.length ? f.owners.join(',') : undefined,
    assigned_to_me: f.assignedToMe,
    owned_by_me: f.ownedByMe,
    important: f.important || undefined,
    my_day: f.myDay || undefined,
    priority: f.priority || undefined,
    due: f.due || undefined,
    label: f.label || undefined,
    feature: f.feature || undefined,
    release: f.release || undefined,
    batch: f.batch || undefined,
    q: f.q || undefined,
    sort: f.sort
  }
}

function toRow(task: TaskDetail): TaskListRow {
  const {
    description: _d, remainingMinutes: _r, loggedMinutes: _l, createdBy: _c, creation: _cr,
    completedBy: _cb, completedAt: _ca, permissions: _p, sourceTask: _st, sourceAction: _sa, ...row
  } = task
  return row
}

export async function fetchAllPages(fetchPage: (cursor: string | null) => Promise<Page<TaskListRow>>) {
  const rows: TaskListRow[] = []
  let cursor: string | null = null
  do {
    const page: Page<TaskListRow> = await fetchPage(cursor)
    rows.push(...page.items)
    cursor = page.nextCursor
  } while (cursor && rows.length < MAX_ROWS)
  return rows
}

/** All Tasks of a Space for the given filters (server-side filtering, keyset pages). */
export function useTaskList(space: MaybeRefOrGetter<string>, filters: MaybeRefOrGetter<TaskListFilters>) {
  const api = useMasarApi()
  return useMasarQuery<TaskListRow[]>(
    () => taskListKey(toValue(space), toValue(filters)),
    signal => fetchAllPages(cursor => api.get('masar.api.tasks.list', {
      space: toValue(space), ...toQuery(toValue(filters)), cursor: cursor ?? undefined, limit: PAGE_SIZE
    }, signal)),
    { default: () => [] }
  )
}

/** Cross-Space work of the session user (only Spaces they currently belong to). */
export function useMyWork(filters: MaybeRefOrGetter<TaskListFilters>) {
  const api = useMasarApi()
  return useMasarQuery<TaskListRow[]>(
    () => myWorkKey(toValue(filters)),
    signal => fetchAllPages(cursor => api.get('masar.api.tasks.my_work', {
      space: toValue(filters).space || undefined,
      spaces: toValue(filters).spaces?.length ? JSON.stringify(toValue(filters).spaces) : undefined,
      ...toQuery(toValue(filters)), cursor: cursor ?? undefined, limit: PAGE_SIZE
    }, signal)),
    { default: () => [] }
  )
}

/** People who own Tasks in one Space or across the user's Spaces (owner filter options). */
export function useTaskOwners(scope: MaybeRefOrGetter<{ space?: string | null, spaces?: string[] | null }>) {
  const api = useMasarApi()
  return useMasarQuery<UserRef[]>(
    () => `tasks:owners:${toValue(scope).space ?? ''}:${(toValue(scope).spaces ?? []).join(',')}`,
    signal => api.get('masar.api.tasks.owners', {
      space: toValue(scope).space || undefined,
      spaces: toValue(scope).spaces?.length ? JSON.stringify(toValue(scope).spaces) : undefined
    }, signal),
    { default: () => [] }
  )
}

export function useTask(name: MaybeRefOrGetter<string>) {
  const api = useMasarApi()
  return useMasarQuery<TaskDetail | null>(
    () => `task:${toValue(name)}`,
    signal => api.get('masar.api.tasks.get', { task: toValue(name) }, signal),
    { default: () => null }
  )
}

export function searchTasks(q: string) {
  return useMasarApi().get<TaskSearchResult[]>('masar.api.tasks.search', { q, limit: 20 })
}

export function lookupTasks(names: string[]) {
  return useMasarApi().get<TaskSearchResult[]>('masar.api.tasks.lookup', { names: JSON.stringify(names) })
}

// ----------------------------------------------------------------------------- cache helpers

/** Write a server-confirmed Task into every cached list (Space lists and My Work) and its detail. */
export function applyServerTask(task: TaskDetail) {
  updateCachedQueries<TaskListRow[]>('tasks:', rows =>
    rows.map(row => (row.name === task.name ? { ...row, ...toRow(task) } : row))
  )
  writeCache(`task:${task.name}`, task)
}

export function applyServerRows(rows: TaskListRow[]) {
  const byName = new Map(rows.map(row => [row.name, row]))
  updateCachedQueries<TaskListRow[]>('tasks:', list =>
    list.map(row => (byName.has(row.name) ? { ...row, ...byName.get(row.name)! } : row))
  )
  for (const row of rows) {
    updateCachedQueries<TaskDetail | null>(`task:${row.name}`, task => (task ? { ...task, ...row, spaceTitle: row.spaceTitle ?? task.spaceTitle } : task))
  }
}

/** Cached My Day lists (any filters): their membership changes with My Day and with finishing a Task. */
function myDayKeys() {
  return cacheKeys(WORK_PREFIX).filter(key => parseListKey(key)?.myDay)
}

/** Removes a Task from every cached My Day list at once (finished, or taken out of My Day). Returns a rollback. */
function leaveMyDay(name: string) {
  const rollbacks = myDayKeys().map(key => updateCachedQueries<TaskListRow[]>(key, rows => rows.filter(row => row.name !== name)))
  return () => rollbacks.forEach(rollback => rollback())
}

/** My Day lists refetch now when shown, and on their next visit otherwise (no page refresh needed). */
export function refreshMyDay() {
  const keys = myDayKeys()
  return keys.length ? invalidateQueries(...keys) : Promise.resolve()
}

export function patchTaskEverywhere(name: string, patch: Partial<TaskDetail>) {
  const rollbackLists = updateCachedQueries<TaskListRow[]>('tasks:', rows =>
    rows.map(row => (row.name === name ? { ...row, ...patch } : row))
  )
  const rollbackDetail = updateCachedQueries<TaskDetail | null>(`task:${name}`, task =>
    task ? { ...task, ...patch } : task
  )
  return () => {
    rollbackLists()
    rollbackDetail()
  }
}

// ----------------------------------------------------------------------------- mutations

export function useTaskMutations() {
  const api = useMasarApi()

  const create = useMasarMutation(
    (vars: { space: string, title: string, clientRequestId: string }) =>
      api.post<CreateTaskResult>('masar.api.tasks.create', {
        space: vars.space,
        title: vars.title,
        client_request_id: vars.clientRequestId
      }),
    { toastOnError: false }
  )

  const update = useMasarMutation(
    (vars: { task: TaskDetail | TaskListRow, changes: Partial<EditableTaskFields> }) => {
      const base: Partial<Record<keyof EditableTaskFields, unknown>> = {}
      for (const field of Object.keys(vars.changes) as Array<keyof EditableTaskFields>) {
        if (field === 'feature' || field === 'release') base[field] = vars.task[field]?.name ?? null
        else if (field in vars.task) base[field] = (vars.task as unknown as Record<string, unknown>)[field]
      }
      return api.post<TaskDetail>('masar.api.tasks.update', { task: vars.task.name, changes: vars.changes, base })
    },
    {
      // Feature / Release links are shown from the server's refs, so they are not patched optimistically.
      optimistic: (vars) => {
        const { feature: _f, release: _r, ...changes } = vars.changes
        const patch: Partial<TaskDetail> = { ...changes }
        if (changes.status) patch.isCompleted = FINISHED_STATUSES.includes(changes.status)
        const rollback = patchTaskEverywhere(vars.task.name, patch)
        // A finished Task leaves My Day (client revision 4); the server removes it for everyone.
        if (!patch.isCompleted) return rollback
        const rollbackMyDay = leaveMyDay(vars.task.name)
        return () => { rollbackMyDay(); rollback() }
      },
      onSuccess: (task, vars) => {
        applyServerTask(task)
        if ('feature' in vars.changes || 'release' in vars.changes) void invalidateQueries('features:', 'feature:', 'releases:', 'release:', 'tasks:')
        // A status decides list membership and progress counts (finished or not).
        if ('status' in vars.changes || 'dueDate' in vars.changes) void invalidateQueries('tasks:', 'spaces:list', 'features:', 'releases:', 'batches:', 'batch:')
      },
      // Conflicts are resolved inline by the caller after refreshing the task.
      toastOnError: (error: MasarApiError) => error.kind !== 'conflict'
    }
  )

  /** Adds the Task to, or removes it from, the user's own My Day. */
  const setMyDay = useMasarMutation(
    (vars: { task: TaskListRow, value: boolean }) =>
      api.post<TaskDetail>('masar.api.tasks.set_my_day', { task: vars.task.name, value: vars.value }),
    {
      optimistic: (vars) => {
        const rollback = patchTaskEverywhere(vars.task.name, { isMyDay: vars.value })
        if (vars.value) return rollback
        const rollbackMyDay = leaveMyDay(vars.task.name)
        return () => { rollbackMyDay(); rollback() }
      },
      onSuccess: (task) => {
        applyServerTask(task)
        void refreshMyDay()
      }
    }
  )

  const setCompleted = useMasarMutation(
    (vars: { task: TaskListRow, completed: boolean }) =>
      api.post<TaskDetail>('masar.api.tasks.set_completed', { task: vars.task.name, completed: vars.completed }),
    {
      optimistic: (vars) => {
        const rollback = patchTaskEverywhere(vars.task.name, { isCompleted: vars.completed })
        if (!vars.completed) return rollback
        const rollbackMyDay = leaveMyDay(vars.task.name)
        return () => { rollbackMyDay(); rollback() }
      },
      onSuccess: task => applyServerTask(task),
      invalidate: () => ['tasks:', 'spaces:list']
    }
  )

  const addAssignee = useMasarMutation(
    (vars: { task: TaskListRow, user: string }) =>
      api.post<TaskDetail>('masar.api.tasks.add_assignee', { task: vars.task.name, user: vars.user }),
    { onSuccess: task => applyServerTask(task) }
  )

  const removeAssignee = useMasarMutation(
    (vars: { task: TaskListRow, user: string }) =>
      api.post<TaskDetail>('masar.api.tasks.remove_assignee', { task: vars.task.name, user: vars.user }),
    {
      optimistic: vars => patchTaskEverywhere(vars.task.name, {
        assignees: vars.task.assignees.filter(a => a.name !== vars.user)
      }),
      onSuccess: task => applyServerTask(task)
    }
  )

  const setOwner = useMasarMutation(
    (vars: { task: TaskListRow, user: string }) =>
      api.post<TaskDetail>('masar.api.tasks.set_owner', { task: vars.task.name, user: vars.user }),
    {
      optimistic: vars => patchTaskEverywhere(vars.task.name, { taskOwner: vars.user }),
      onSuccess: task => applyServerTask(task)
    }
  )

  const addLabel = useMasarMutation(
    (vars: { task: TaskListRow, label: string }) =>
      api.post<TaskDetail>('masar.api.tasks.add_label', { task: vars.task.name, label: vars.label }),
    { onSuccess: task => applyServerTask(task) }
  )

  const removeLabel = useMasarMutation(
    (vars: { task: TaskListRow, label: string }) =>
      api.post<TaskDetail>('masar.api.tasks.remove_label', { task: vars.task.name, label: vars.label }),
    {
      optimistic: vars => patchTaskEverywhere(vars.task.name, {
        labels: vars.task.labels.filter(l => l.name !== vars.label)
      }),
      onSuccess: task => applyServerTask(task)
    }
  )

  const remove = useMasarMutation(
    (vars: { task: TaskListRow }) => api.post<{ name: string }>('masar.api.tasks.delete', { task: vars.task.name }),
    {
      optimistic: vars => updateCachedQueries<TaskListRow[]>('tasks:', rows =>
        rows.filter(row => row.name !== vars.task.name)
      ),
      invalidate: () => ['tasks:', 'spaces:list']
    }
  )

  /** All-or-nothing bulk change; `expected` carries the values the user saw (409 on conflict). */
  const bulk = useMasarMutation(
    (vars: { tasks: TaskListRow[], operation: BulkOperation, value: unknown }) => {
      const expected: Record<string, unknown> = {}
      if (vars.operation === 'priority') vars.tasks.forEach((t) => { expected[t.name] = t.priority })
      if (vars.operation === 'set_completed') vars.tasks.forEach((t) => { expected[t.name] = t.isCompleted })
      if (vars.operation === 'set_status') vars.tasks.forEach((t) => { expected[t.name] = t.status })
      if (vars.operation === 'set_feature') vars.tasks.forEach((t) => { expected[t.name] = t.feature?.name ?? null })
      if (vars.operation === 'set_release') vars.tasks.forEach((t) => { expected[t.name] = t.release?.name ?? null })
      if (vars.operation === 'set_batch') vars.tasks.forEach((t) => { expected[t.name] = t.batch?.name ?? null })
      return api.post<BulkResult>('masar.api.tasks.bulk_update', {
        tasks: vars.tasks.map(t => t.name),
        operation: vars.operation,
        value: vars.value,
        expected
      })
    },
    {
      onSuccess: result => applyServerRows(result.items),
      invalidate: () => ['tasks:', 'spaces:list', 'features:', 'feature:', 'releases:', 'release:', 'batches:', 'batch:', 'batch-tasks:', 'batch-history:'],
      toastOnError: (error: MasarApiError) => error.kind !== 'conflict'
    }
  )

  return { create, update, setMyDay, setCompleted, addAssignee, removeAssignee, setOwner, addLabel, removeLabel, remove, bulk }
}
