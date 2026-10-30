import type { EditableTaskFields } from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'

export const TASK_FIELD_LABELS: Record<keyof EditableTaskFields, string> = {
  title: 'title', description: 'description', status: 'status', priority: 'priority', dueDate: 'due date',
  isImportant: 'Important', isMyDay: 'My Day', remainingMinutes: 'remaining time',
  feature: 'Feature', release: 'Release'
}

/** One Task editor for the side panel and the full page: the Task, its save path with optimistic
 *  concurrency (a conflict keeps the user's value so they can re-apply it) and people and Batch changes. */
export function useTaskEditor(name: MaybeRefOrGetter<string>) {
  const { data: task, status, error, refresh } = useTask(name)
  const mutations = useTaskMutations()
  const batchMutations = useBatchMutations()
  const editable = computed(() => !!task.value?.permissions.canEdit)
  const conflict = ref<{ field: keyof EditableTaskFields, yours: unknown } | null>(null)

  async function save(changes: Partial<EditableTaskFields>) {
    if (!task.value) return
    conflict.value = null
    try {
      await mutations.update.execute({ task: task.value, changes })
    } catch (caught) {
      if ((caught as MasarApiError).kind !== 'conflict') return
      const field = Object.keys(changes)[0] as keyof EditableTaskFields
      conflict.value = { field, yours: changes[field] }
      await refresh()
    }
  }

  async function applyMine() {
    if (!conflict.value) return
    const { field, yours } = conflict.value
    conflict.value = null
    await save({ [field]: yours } as Partial<EditableTaskFields>)
  }

  async function toggleAssignee(user: string) {
    if (!task.value) return
    const assigned = task.value.assignees.some(person => person.name === user)
    const mutation = assigned ? mutations.removeAssignee : mutations.addAssignee
    await mutation.execute({ task: task.value, user }).catch(() => refresh())
  }

  async function setOwner(user: string) {
    if (task.value && user !== task.value.taskOwner) {
      await mutations.setOwner.execute({ task: task.value, user }).catch(() => refresh())
    }
  }

  async function setBatch(batch: string | null) {
    if (!task.value || batch === (task.value.batch?.name ?? null)) return
    await batchMutations.moveTasks.execute({ tasks: [task.value], batch }).catch(() => undefined)
    await refresh()
  }

  return { task, status, error, refresh, editable, conflict, save, applyMine, toggleAssignee, setOwner, setBatch, mutations }
}

export type TaskEditor = ReturnType<typeof useTaskEditor>
