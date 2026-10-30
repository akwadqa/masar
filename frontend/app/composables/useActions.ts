import type { Label, LabelColor, PromoteResult, TaskAction, TaskListRow } from '~/types/api'

/** Actions of one Task (loaded on demand: Task detail or an expanded Task List row). */
export function useTaskActions(task: MaybeRefOrGetter<string>) {
  const api = useMasarApi()
  return useMasarQuery<TaskAction[]>(
    () => `actions:${toValue(task)}`,
    signal => api.get('masar.api.actions.list', { task: toValue(task) }, signal),
    { default: () => [], refetchOnFocus: false }
  )
}

export function fetchTaskActions(task: string) {
  return useMasarApi().get<TaskAction[]>('masar.api.actions.list', { task })
}

/** Keep the counters shown in Task List rows in step with the loaded Actions. */
function syncCounters(task: string) {
  const actions = readCache<TaskAction[]>(`actions:${task}`)
  if (!actions) return
  const counts = { actionCount: actions.length, actionDoneCount: actions.filter(a => a.isDone).length }
  updateCachedQueries<TaskListRow[]>('tasks:', rows => rows.map(row => (row.name === task ? { ...row, ...counts } : row)))
}

function patchActions(task: string, update: (actions: TaskAction[]) => TaskAction[]) {
  const key = `actions:${task}`
  const previous = readCache<TaskAction[]>(key)
  writeCache(key, update(previous ?? []))
  syncCounters(task)
  return () => {
    if (previous) writeCache(key, previous)
    syncCounters(task)
  }
}

function replaceAction(task: string, action: TaskAction) {
  patchActions(task, list => list.map(a => (a.name === action.name ? { ...a, ...action } : a)))
}

export function useActionMutations() {
  const api = useMasarApi()

  const add = useMasarMutation(
    (vars: { task: string, title: string, clientRequestId: string }) =>
      api.post<{ action: TaskAction, created: boolean }>('masar.api.actions.add', {
        task: vars.task, title: vars.title, client_request_id: vars.clientRequestId
      }),
    {
      onSuccess: (result, vars) => patchActions(vars.task, list =>
        list.some(a => a.name === result.action.name) ? list : [...list, result.action]),
      toastOnError: false // the add field keeps the text and shows the error inline
    }
  )

  const update = useMasarMutation(
    (vars: { action: TaskAction, title: string }) =>
      api.post<TaskAction>('masar.api.actions.update', { action: vars.action.name, title: vars.title, base_title: vars.action.title }),
    {
      optimistic: vars => patchActions(vars.action.task, list => list.map(a => (a.name === vars.action.name ? { ...a, title: vars.title } : a))),
      onSuccess: (action, vars) => replaceAction(vars.action.task, action)
    }
  )

  const setDone = useMasarMutation(
    (vars: { action: TaskAction, done: boolean }) =>
      api.post<TaskAction>('masar.api.actions.set_done', { action: vars.action.name, done: vars.done }),
    {
      optimistic: vars => patchActions(vars.action.task, list => list.map(a => (a.name === vars.action.name ? { ...a, isDone: vars.done } : a))),
      onSuccess: (action, vars) => replaceAction(vars.action.task, action)
    }
  )

  const move = useMasarMutation(
    (vars: { action: TaskAction, before?: string, after?: string, reordered: TaskAction[] }) =>
      api.post<TaskAction>('masar.api.actions.move', { action: vars.action.name, before: vars.before, after: vars.after }),
    {
      optimistic: vars => patchActions(vars.action.task, () => vars.reordered),
      onSuccess: (action, vars) => replaceAction(vars.action.task, action)
    }
  )

  const remove = useMasarMutation(
    (vars: { action: TaskAction }) => api.post('masar.api.actions.delete', { action: vars.action.name }),
    { optimistic: vars => patchActions(vars.action.task, list => list.filter(a => a.name !== vars.action.name)) }
  )

  const promote = useMasarMutation(
    (vars: { action: TaskAction }) => api.post<PromoteResult>('masar.api.actions.promote', { action: vars.action.name }),
    {
      onSuccess: (result, vars) => {
        replaceAction(vars.action.task, { ...result.action, promotedTaskCompleted: result.task.isCompleted })
        writeCache(`task:${result.task.name}`, result.task)
      },
      invalidate: () => ['tasks:', 'spaces:list']
    }
  )

  return { add, update, setDone, move, remove, promote }
}

// ----------------------------------------------------------------------------- labels

export function useSpaceLabels(space: MaybeRefOrGetter<string | null | undefined>) {
  const api = useMasarApi()
  return useMasarQuery<Label[]>(
    () => `labels:${toValue(space) ?? 'none'}`,
    async (signal) => {
      const value = toValue(space)
      return value ? api.get<Label[]>('masar.api.labels.list', { space: value }, signal) : []
    },
    { default: () => [] }
  )
}

export function useLabelMutations() {
  const api = useMasarApi()
  const create = useMasarMutation(
    (vars: { space: string, title: string, color?: LabelColor }) =>
      api.post<{ label: Label, created: boolean }>('masar.api.labels.create', vars),
    { invalidate: (_r, vars) => [`labels:${vars.space}`] }
  )
  // Managers rename, recolour and delete labels (Space settings); Tasks show the change everywhere.
  const update = useMasarMutation(
    (vars: { space: string, label: string, title?: string, color?: LabelColor }) =>
      api.post<Label>('masar.api.labels.update', { label: vars.label, title: vars.title, color: vars.color }),
    { invalidate: (_r, vars) => [`labels:${vars.space}`, 'tasks:', 'task:'] }
  )
  const remove = useMasarMutation(
    (vars: { space: string, label: string }) => api.post('masar.api.labels.delete', { label: vars.label }),
    { invalidate: (_r, vars) => [`labels:${vars.space}`, 'tasks:', 'task:'] }
  )
  return { create, update, remove }
}
