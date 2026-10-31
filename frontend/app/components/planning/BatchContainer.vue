<script setup lang="ts">
import type { Batch, TaskListRow, TaskStatus } from '~/types/api'
import { FINISHED_STATUSES } from '~/types/api'
import { formatLongDate } from '~/utils/format'
import { carriesTasks, readTaskDrop, setTaskDrag } from '~/utils/taskGrid'

// One Batch of All Tasks as a full-width box (client revision 2): its Task rows sit inside the box,
// and Task rows dropped on it join the Batch. Without a drag, select rows and use "Add selected".
// `batch: null` is the Backlog box: Tasks that are not in a current Batch.
const props = defineProps<{
  batch: Batch | null
  tasks: TaskListRow[]
  selected: ReadonlySet<string>
  activeTask: string | null
  /** The user may move Tasks into or out of this box */
  canDrop: boolean
  busy?: boolean
}>()
const emit = defineEmits<{
  open: [task: TaskListRow]
  status: [task: TaskListRow, status: TaskStatus]
  select: [task: TaskListRow, range: boolean]
  drop: [names: string[] | undefined]
  filter: []
  /** Header checkbox: select or clear every Task of this box */
  selectAll: [names: string[], selected: boolean]
  /** Planned Batches the user manages can be deleted (their Tasks return to the Backlog) */
  delete: []
}>()

const collapsed = ref(false)
const hovered = ref(false)
const title = computed(() => props.batch?.batchName ?? 'Backlog')
const counts = computed(() => {
  const finished = props.tasks.filter(task => FINISHED_STATUSES.includes(task.status)).length
  const working = props.tasks.filter(task => task.status === 'Working' || task.status === 'Pending Review').length
  return { open: props.tasks.length - finished - working, working, finished }
})
const names = computed(() => props.tasks.map(task => task.name))
const allSelected = computed(() => !!names.value.length && names.value.every(name => props.selected.has(name)))
const someSelected = computed(() => names.value.some(name => props.selected.has(name)))
const selectedOutside = computed(() => [...props.selected].filter(name => !props.tasks.some(task => task.name === name)).length)

function onDragOver(event: DragEvent) {
  if (!props.canDrop || !carriesTasks(event)) return
  event.preventDefault()
  hovered.value = true
}
function onDrop(event: DragEvent) {
  hovered.value = false
  const names = readTaskDrop(event)
  if (!names || !props.canDrop) return
  event.preventDefault()
  emit('drop', names)
}
</script>

<template>
  <section
    class="flex flex-col gap-2 rounded-card px-3 py-2.5 transition-colors"
    :class="hovered ? 'bg-primary/10 ring-2 ring-primary' : 'bg-elevated/70'"
    :aria-label="batch ? `Batch ${title}` : 'Backlog: tasks not in a Batch'"
    :data-batch-target="batch?.name ?? 'backlog'"
    @dragover="onDragOver"
    @dragleave.self="hovered = false"
    @drop="onDrop"
  >
    <header class="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
      <UCheckbox
        :model-value="allSelected ? true : (someSelected ? 'indeterminate' : false)"
        :disabled="!tasks.length"
        :aria-label="`Select all tasks in ${title}`"
        @update:model-value="(value) => emit('selectAll', names, value === true)"
      />
      <UButton
        :icon="collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
        color="neutral"
        variant="ghost"
        size="sm"
        square
        :aria-expanded="collapsed ? 'false' : 'true'"
        :aria-label="`${collapsed ? 'Expand' : 'Collapse'} ${title}`"
        @click="collapsed = !collapsed"
      />
      <button
        v-if="batch"
        type="button"
        class="truncate text-section text-highlighted hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        :aria-label="`Show only ${title}`"
        @click="emit('filter')"
      >
        {{ title }}
      </button>
      <span v-else class="text-section text-highlighted">{{ title }}</span>
      <BatchStatusBadge v-if="batch" :status="batch.status" size="sm" />
      <span v-if="batch?.startDate" class="text-sm text-muted">{{ formatLongDate(batch.startDate) }} – {{ formatLongDate(batch.endDate) }}</span>
      <span class="text-sm text-muted">({{ tasks.length }} {{ tasks.length === 1 ? 'task' : 'tasks' }})</span>
      <span class="ms-auto flex items-center gap-1.5" :aria-label="`${counts.open} open, ${counts.working} in progress, ${counts.finished} finished`">
        <span class="min-w-6 rounded-pill bg-accented px-1.5 text-center text-xs font-medium tabular-nums text-highlighted">{{ counts.open }}</span>
        <span class="min-w-6 rounded-pill bg-status-working/15 px-1.5 text-center text-xs font-medium tabular-nums text-status-working">{{ counts.working }}</span>
        <span class="min-w-6 rounded-pill bg-success-tint px-1.5 text-center text-xs font-medium tabular-nums text-success">{{ counts.finished }}</span>
      </span>
      <UButton
        v-if="canDrop && selectedOutside"
        size="sm"
        color="neutral"
        variant="outline"
        :loading="busy"
        icon="i-lucide-arrow-down-to-line"
        :label="`Add ${selectedOutside} selected`"
        :aria-label="`Add ${selectedOutside} selected ${selectedOutside === 1 ? 'task' : 'tasks'} to ${title}`"
        @click="emit('drop', undefined)"
      />
      <slot name="actions" />
      <UDropdownMenu
        v-if="batch && canDrop && batch.status === 'Planned'"
        :items="[{ label: 'Delete Batch', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => emit('delete') }]"
        :content="{ align: 'end' }"
      >
        <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" square :aria-label="`More actions for ${title}`" />
      </UDropdownMenu>
      <UButton v-if="batch" :to="`/batches/${batch.name}`" size="sm" color="neutral" variant="ghost" icon="i-lucide-arrow-up-right" :aria-label="`Open Batch ${title}`" />
    </header>
    <template v-if="!collapsed">
      <slot>
        <div v-if="tasks.length" class="@container max-h-[26rem] overflow-y-auto rounded-(--ui-radius) border border-default bg-default" role="list" :aria-label="`Tasks in ${title}`">
          <TaskRow
            v-for="(task, index) in tasks"
            :key="task.name"
            :task="task"
            :focused="false"
            :active="activeTask === task.name"
            :selected="selected.has(task.name)"
            :striped="index % 2 === 1"
            :show-due="false"
            draggable="true"
            @dragstart="(event: DragEvent) => setTaskDrag(event, task, selected)"
            @open="emit('open', task)"
            @status="(status) => emit('status', task, status)"
            @select="(range) => emit('select', task, range)"
          />
        </div>
        <p v-else class="rounded-(--ui-radius) border border-dashed border-accented px-4 py-2.5 text-center text-sm text-muted">
          {{ canDrop ? 'Nothing in this Batch yet. Plan it by dragging tasks into it, or select tasks and choose “Add selected”.' : 'No tasks in this Batch match the filters.' }}
        </p>
      </slot>
    </template>
  </section>
</template>
