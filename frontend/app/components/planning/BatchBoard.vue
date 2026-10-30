<script setup lang="ts">
import type { Batch, TaskListRow } from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'

type Controller = ReturnType<typeof useTaskListController>

// Batch planning board (client revisions 2 and 3), shared by All Tasks ("Group by Batch") and the
// Batches page: one full-width box per current Batch with its Task rows inside, then the Backlog.
// Rows move between boxes by drag and drop, or by selecting them and choosing "Add selected"
// (batches.move_tasks, all or nothing). A Planned Batch can be deleted; its Tasks return to the Backlog.
// Batches are called Sprints in the interface (client revision 4). While no Sprint is current, a
// "Plan your Sprint" area leads the board; tasks dropped on it join the Sprint created for them.
const props = defineProps<{
  tasks: TaskListRow[]
  controller: Controller
  activeTask: string | null
  /** A Batch filter: one Batch name, 'none' (Backlog only) or null (everything) */
  batchFilter?: string | null
  scrollKey: string
  emptyHint?: string
  /** All Tasks on phones: the Backlog rows are part of the page's one scroll instead of a box of their own */
  pageScroll?: boolean
}>()
const emit = defineEmits<{ open: [task: TaskListRow], filter: [batch: string | null], refresh: [] }>()

const toast = useToast()
const { data: visibleBatches } = useBatchList(() => ({}))
const { data: manageable } = useManageableBatches()
const { moveTasks, remove } = useBatchMutations()
const movingTo = ref<string | null>(null)
const deleting = ref<Batch | null>(null)
const creating = ref(false)
// Tasks dropped on the planning area join the Sprint created for them.
const pendingDrop = ref<string[] | null>(null)

const manageableNames = computed(() => new Set((manageable.value?.items ?? []).map(batch => batch.name)))
const boxes = computed(() => {
  const byBatch = new Map<string, TaskListRow[]>()
  for (const row of props.tasks) if (row.batch) byBatch.set(row.batch.name, [...(byBatch.get(row.batch.name) ?? []), row])
  const listed: Batch[] = (visibleBatches.value?.items ?? []).filter(batch => batch.status !== 'Finished')
  // A Task can name a Batch the list does not return (e.g. planned by someone else): give it a box too.
  const known = new Set(listed.map(batch => batch.name))
  for (const row of props.tasks) {
    if (row.batch && !known.has(row.batch.name)) {
      known.add(row.batch.name)
      listed.push({ name: row.batch.name, batchName: row.batch.title, status: row.batch.status } as Batch)
    }
  }
  const filter = props.batchFilter
  if (filter === 'none') return []
  const shown = filter && filter !== 'any' ? listed.filter(batch => batch.name === filter) : listed
  return shown.map(batch => ({ batch, tasks: byBatch.get(batch.name) ?? [] }))
})
const backlog = computed(() => props.tasks.filter(row => !row.batch))
const showBacklog = computed(() => !props.batchFilter || props.batchFilter === 'none')
const canCreate = computed(() => !!manageable.value?.permissions.canCreate)
const showPlanZone = computed(() => !boxes.value.length && (!props.batchFilter || props.batchFilter === 'any'))

function startPlanning(names?: string[]) {
  pendingDrop.value = names ?? null
  creating.value = true
}
async function onCreated(name: string, title: string) {
  const names = pendingDrop.value
  pendingDrop.value = null
  if (names?.length) await moveTo({ name, batchName: title } as Batch, names)
}

/** Rows to move: the selection, or the dragged names (only rows this view has shown). */
function rowsFor(names?: string[]) {
  if (!names) return props.controller.selectedTasks.value
  const known = new Map([...props.tasks, ...props.controller.selectedTasks.value].map(task => [task.name, task]))
  return names.flatMap(name => known.get(name) ?? [])
}

async function moveTo(batch: Batch | null, names?: string[]) {
  const rows = rowsFor(names).filter(row => (row.batch?.name ?? null) !== (batch?.name ?? null))
  if (!rows.length) return
  movingTo.value = batch?.name ?? 'backlog'
  try {
    const result = await moveTasks.execute({ tasks: rows, batch: batch?.name ?? null })
    toast.add({
      title: batch ? `Added to ${batch.batchName}` : 'Moved to the Backlog',
      description: `${result.changed.length} of ${rows.length} tasks moved.`,
      color: 'success',
      icon: 'i-lucide-check'
    })
    props.controller.deselect(rows.map(row => row.name))
  } catch (caught) {
    const kind = (caught as MasarApiError).kind
    toast.add({
      title: kind === 'conflict' ? 'Some tasks changed since you selected them' : 'Tasks could not be moved',
      description: kind === 'conflict' ? 'Nothing was moved. The list was refreshed; review and try again.' : (caught as Error).message,
      color: 'warning',
      icon: 'i-lucide-git-compare'
    })
    emit('refresh')
  } finally {
    movingTo.value = null
  }
}

async function confirmDelete() {
  const batch = deleting.value
  if (!batch) return
  try {
    await remove.execute({ batch: batch.name })
    toast.add({ title: `${batch.batchName} deleted`, description: 'Its tasks are back in the Backlog.', color: 'neutral', icon: 'i-lucide-trash-2' })
    await invalidateQueries('tasks:')
  } finally {
    deleting.value = null
  }
}
function toggleBox(names: string[], on: boolean) {
  if (on) props.controller.selectNames(names)
  else props.controller.deselect(names)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <SprintPlanZone v-if="showPlanZone" :can-create="canCreate" @create="startPlanning" />
    <BatchContainer
      v-for="box in boxes"
      :key="box.batch.name"
      :batch="box.batch"
      :tasks="box.tasks"
      :selected="controller.selected.value"
      :active-task="activeTask"
      :can-drop="manageableNames.has(box.batch.name)"
      :busy="movingTo === box.batch.name"
      @open="(task) => emit('open', task)"
      @status="(task, status) => controller.setStatus(task, status, true)"
      @select="controller.select"
      @drop="(names) => moveTo(box.batch, names)"
      @filter="emit('filter', batchFilter === box.batch.name ? null : box.batch.name)"
      @select-all="toggleBox"
      @delete="deleting = box.batch"
    />
    <BatchContainer
      v-if="showBacklog"
      :batch="null"
      :tasks="backlog"
      :selected="controller.selected.value"
      :active-task="activeTask"
      :can-drop="true"
      :busy="movingTo === 'backlog'"
      @drop="(names) => moveTo(null, names)"
      @select-all="toggleBox"
    >
      <template #actions>
        <UButton v-if="canCreate && !showPlanZone" icon="i-lucide-plus" label="Create Sprint" color="neutral" variant="outline" size="sm" @click="startPlanning()" />
      </template>
      <div v-if="backlog.length" class="overflow-hidden rounded-(--ui-radius) border border-default bg-default" :class="pageScroll ? 'list-scroll:h-[60vh] list-scroll:min-h-80' : 'h-[60vh] min-h-80'">
        <TaskList
          :page-scroll="pageScroll"
          :tasks="backlog"
          :drafts="[]"
          :active-task="activeTask"
          :can-create="false"
          :can-edit="true"
          :selected="controller.selected.value"
          :expanded="controller.expanded.value"
          :show-due="false"
          draggable-rows
          :scroll-key="scrollKey"
          @open="(task) => emit('open', task)"
          @status="(task, status) => controller.setStatus(task, status, true)"
          @select="controller.select"
          @expand="controller.toggleExpand"
          @attribute="(task, field) => controller.toggleAttribute(task, field, true)"
          @action-done="controller.setActionDone"
        />
      </div>
      <p v-else class="rounded-(--ui-radius) border border-dashed border-accented px-4 py-3 text-center text-sm text-muted">
        {{ emptyHint ?? 'Every task is in a Sprint.' }}
      </p>
    </BatchContainer>

    <CreateBatchModal v-model:open="creating" @created="onCreated" />
    <UModal
      :open="!!deleting"
      :title="`Delete ${deleting?.batchName ?? 'this Sprint'}?`"
      description="The Sprint is removed. Its tasks are not deleted: they return to the Backlog. This cannot be undone."
      @update:open="(value) => { if (!value) deleting = null }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="deleting = null" />
          <UButton color="error" label="Delete Sprint" :loading="remove.pending.value" @click="confirmDelete" />
        </div>
      </template>
    </UModal>
  </div>
</template>
