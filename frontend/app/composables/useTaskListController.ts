import type { Ref } from 'vue'
import type { TaskAction, TaskListRow, TaskStatus } from '~/types/api'
import { FINISHED_STATUSES } from '~/types/api'
import { statusStyle } from '~/utils/taskStatus'
import { pruneSelection, selectAll, toggleSelection } from '~/utils/selection'
import type { ExpandedActions } from '~/utils/taskRows'

/** Shared behaviour of task lists (Space Task List, All Tasks, My Day): selection by task name,
 *  on-demand Action expansion and quick toggles with optimistic updates.
 *  With `persistentSelection`, selected tasks stay selected when filters hide them (All Tasks planning);
 *  their last seen row is kept so the selection tray can still show and move them. */
export function useTaskListController(tasks: Ref<TaskListRow[] | null | undefined>, options: { persistentSelection?: boolean } = {}) {
  const taskMutations = useTaskMutations()
  const actionMutations = useActionMutations()
  const toast = useToast()

  // ---- selection (names only; virtual row reuse can never move a selection)
  const selected = ref<Set<string>>(new Set())
  const anchor = ref<string | null>(null)
  const visibleNames = computed(() => (tasks.value ?? []).map(t => t.name))
  const remembered = shallowRef(new Map<string, TaskListRow>())
  watch(visibleNames, (names) => {
    if (options.persistentSelection) return
    const pruned = pruneSelection(selected.value, names)
    if (pruned.size !== selected.value.size) selected.value = pruned
  })
  // Remember the latest row of every selected task, so hidden selections keep fresh data.
  watch([selected, () => tasks.value], () => {
    if (!options.persistentSelection) return
    const next = new Map<string, TaskListRow>()
    const visible = new Map((tasks.value ?? []).map(task => [task.name, task]))
    for (const name of selected.value) {
      const row = visible.get(name) ?? remembered.value.get(name)
      if (row) next.set(name, row)
    }
    remembered.value = next
  }, { immediate: true })
  const selectedTasks = computed(() => (options.persistentSelection
    ? [...remembered.value.values()]
    : (tasks.value ?? []).filter(t => selected.value.has(t.name))))
  const hiddenSelectedCount = computed(() => {
    const visible = new Set(visibleNames.value)
    return [...selected.value].filter(name => !visible.has(name)).length
  })

  function select(task: TaskListRow, range: boolean) {
    const result = toggleSelection(selected.value, visibleNames.value, task.name, anchor.value, range)
    selected.value = result.selected
    anchor.value = result.anchor
  }
  function selectAllVisible() {
    selected.value = options.persistentSelection
      ? new Set([...selected.value, ...visibleNames.value])
      : selectAll(visibleNames.value)
  }
  /** Adds rows to the selection (e.g. every Task of a Batch box). */
  function selectNames(names: string[]) {
    selected.value = new Set([...selected.value, ...names])
  }
  function deselect(names: string[]) {
    const next = new Set(selected.value)
    for (const name of names) next.delete(name)
    selected.value = next
  }
  function clearSelection() {
    selected.value = new Set()
    anchor.value = null
  }

  // ---- Action expansion (loaded on demand, then kept live through the actions cache)
  const expandedNames = ref<string[]>([])
  const expandStatus = ref<Record<string, 'loading' | 'error'>>({})
  const expanded = computed<ExpandedActions>(() => {
    const map: ExpandedActions = {}
    for (const name of expandedNames.value) {
      map[name] = expandStatus.value[name] ?? readCache<TaskAction[]>(`actions:${name}`) ?? 'loading'
    }
    return map
  })

  async function toggleExpand(task: TaskListRow) {
    if (expandedNames.value.includes(task.name) && !expandStatus.value[task.name]) {
      expandedNames.value = expandedNames.value.filter(n => n !== task.name)
      return
    }
    if (!expandedNames.value.includes(task.name)) expandedNames.value = [...expandedNames.value, task.name]
    expandStatus.value = { ...expandStatus.value, [task.name]: 'loading' }
    try {
      writeCache(`actions:${task.name}`, await fetchTaskActions(task.name))
      const { [task.name]: _done, ...rest } = expandStatus.value
      expandStatus.value = rest
    } catch {
      expandStatus.value = { ...expandStatus.value, [task.name]: 'error' }
    }
  }

  // ---- quick changes
  async function setStatus(task: TaskListRow, status: TaskStatus, canEdit: boolean) {
    if (!canEdit || task.status === status) return
    const previous = task.status
    try {
      await taskMutations.update.execute({ task, changes: { status } })
      toast.add({
        title: `Status: ${status}`,
        description: task.title,
        color: FINISHED_STATUSES.includes(status) ? 'success' : 'neutral',
        icon: statusStyle(status).icon,
        // Overdue is set by Masar only; undoing back to it restores Open instead.
        actions: [{ label: 'Undo', onClick: () => void taskMutations.update.execute({ task: { ...task, status }, changes: { status: previous === 'Overdue' ? 'Open' : previous } }).catch(() => undefined) }]
      })
    } catch { /* rolled back and reported by the mutation */ }
  }

  function toggleAttribute(task: TaskListRow, field: 'isImportant' | 'isMyDay', canEdit: boolean) {
    // My Day is personal (client revision 4): reading the Task is enough.
    if (field === 'isMyDay') {
      void taskMutations.setMyDay.execute({ task, value: !task.isMyDay }).catch(() => undefined)
      return
    }
    if (!canEdit) return
    void taskMutations.update.execute({ task, changes: { [field]: !task[field] } }).catch(() => undefined)
  }

  function setActionDone(action: TaskAction, done: boolean) {
    void actionMutations.setDone.execute({ action, done }).catch(() => undefined)
  }

  return {
    selected, selectedTasks, hiddenSelectedCount, select, selectAllVisible, selectNames, deselect, clearSelection,
    expanded, toggleExpand, setStatus, toggleAttribute, setActionDone
  }
}
