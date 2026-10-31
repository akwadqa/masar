import type { TaskDetail, TaskListRow } from '~/types/api'
import { errorMessage } from '~/utils/apiError'
import {
  type DraftState,
  commitInput,
  emptyDraftState,
  markFailed,
  markSaving,
  removeDraft,
  restoreDraftState
} from '~/utils/drafts'
import { insertTask } from '~/utils/taskRows'

const storageKey = (space: string) => `masar:drafts:${space}`

function readStorage(space: string): DraftState {
  try {
    return restoreDraftState(sessionStorage.getItem(storageKey(space)))
  } catch {
    return emptyDraftState()
  }
}

function writeStorage(space: string, state: DraftState) {
  try {
    if (!state.input && !state.drafts.length) sessionStorage.removeItem(storageKey(space))
    else sessionStorage.setItem(storageKey(space), JSON.stringify(state))
  } catch {
    // Storage may be unavailable (private mode); drafts still live in memory.
  }
}

/** Inline creation for one Space: draft text, optimistic rows, idempotent commit and retry. */
export function useInlineDrafts(space: MaybeRefOrGetter<string>) {
  const states = useState<Record<string, DraftState>>('masar:drafts', () => ({}))
  const { create } = useTaskMutations()

  const state = computed<DraftState>({
    get() {
      const key = toValue(space)
      if (!states.value[key]) states.value[key] = import.meta.client ? readStorage(key) : emptyDraftState()
      return states.value[key]!
    },
    set(value) {
      states.value[toValue(space)] = value
      writeStorage(toValue(space), value)
    }
  })

  const input = computed({
    get: () => state.value.input,
    set: (value: string) => {
      state.value = { ...state.value, input: value }
    }
  })

  function addToLists(task: TaskDetail) {
    // Insert into every cached view (Space lists and cross-Space lists) whose filters admit a new open task.
    for (const key of [...cacheKeys(`tasks:list:${task.space}:`), ...cacheKeys('tasks:mywork:')]) {
      const filters = parseListKey(key)
      if (!filters || !filtersAdmitNewTask(filters)) continue
      if (key.startsWith('tasks:mywork:') && filters.space && filters.space !== task.space) continue
      const rows = readCache<TaskListRow[]>(key)
      if (rows) writeCache(key, insertTask(rows, task))
    }
    writeCache(`task:${task.name}`, task)
  }

  async function send(id: string, title: string) {
    try {
      const result = await create.execute({ space: toValue(space), title, clientRequestId: id })
      addToLists(result.task)
      state.value = removeDraft(state.value, id)
      void invalidateQueries('spaces:list')
      return result.task
    } catch (error) {
      state.value = markFailed(state.value, id, errorMessage(error))
      return null
    }
  }

  /** Commit the current input (Enter, or blur with text). Empty input never creates a task. */
  function commit() {
    const result = commitInput(state.value, () => crypto.randomUUID())
    if (!result) return null
    state.value = result.state
    return send(result.draft.id, result.draft.title)
  }

  function retry(id: string) {
    const draft = state.value.drafts.find(d => d.id === id)
    if (!draft || draft.status === 'saving') return null
    state.value = markSaving(state.value, id)
    return send(id, draft.title)
  }

  function discard(id: string) {
    state.value = removeDraft(state.value, id)
  }

  return { input, drafts: computed(() => state.value.drafts), commit, retry, discard }
}
