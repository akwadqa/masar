<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useMediaQuery, useNow } from '@vueuse/core'
import { COMPOSER_SLOT, PAGE_SCROLL_QUERY } from '~/utils/pageScroll'
import type { TaskAction, TaskFilterField, TaskListRow, TaskStatus } from '~/types/api'
import type { ColumnSort, TaskColumn } from '~/utils/taskSort'
import type { TaskDraft } from '~/utils/drafts'
import { buildTaskRows, nextFocusIndex, type ExpandedActions } from '~/utils/taskRows'
import { setTaskDrag, TASK_GRID, TASK_GRID_NO_DUE } from '~/utils/taskGrid'

const ROW_HEIGHT = 48
// Scroll positions per list (e.g. a Space view or an All Tasks filter) survive navigation to a task page.
const scrollMemory = new Map<string, number>()

const props = defineProps<{
  tasks: TaskListRow[]
  drafts: TaskDraft[]
  activeTask: string | null
  canCreate: boolean
  canEdit?: boolean
  selected: ReadonlySet<string>
  expanded: ExpandedActions
  scrollKey?: string
  /** Batch header → task rows → Action rows (ADR-046) */
  groupByBatch?: boolean
  /** Rows can be dragged onto planning targets (All Tasks); dragging a selected row carries the selection. */
  draggableRows?: boolean
  /** The due column (hidden on All Tasks) */
  showDue?: boolean
  /** Task pages (iPhone stabilization 2026-10-30): on phones (PAGE_SCROLL_QUERY) the list does not scroll
   *  by itself; it is part of the page, whose one scroll (the panel body) carries filters, rows and composer. */
  pageScroll?: boolean
  /** Column headers sort the list (client revision 6); the list itself is sorted by the page. */
  sortable?: boolean
  columnSort?: ColumnSort | null
  /** Cells that filter the list by their value when clicked (client revision 6). */
  filterable?: TaskFilterField[]
}>()
const input = defineModel<string>('input', { default: '' })
const emit = defineEmits<{
  open: [task: TaskListRow]
  status: [task: TaskListRow, status: TaskStatus]
  commit: []
  retry: [id: string]
  discard: [id: string]
  select: [task: TaskListRow, range: boolean]
  expand: [task: TaskListRow]
  attribute: [task: TaskListRow, field: 'isImportant' | 'isMyDay']
  actionDone: [action: TaskAction, done: boolean]
  sort: [column: TaskColumn]
  filter: [field: TaskFilterField, value: string]
}>()
// One clock for every row's Last modified time.
const now = useNow({ interval: 60_000 })

// Collapsed Batch groups, by Batch name ('none' = tasks without a Batch). Kept per list.
const collapsedGroups = ref<Set<string>>(new Set())
function toggleGroup(id: string) {
  const next = new Set(collapsedGroups.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsedGroups.value = next
}
const rows = computed(() => buildTaskRows(
  props.tasks, props.drafts, props.expanded,
  props.groupByBatch ? { collapsed: collapsedGroups.value } : undefined
))
function startDrag(event: DragEvent, task: TaskListRow) {
  setTaskDrag(event, task, props.selected)
}
const scrollRef = ref<HTMLElement | null>(null)
const createInput = ref<{ inputRef?: HTMLInputElement } | null>(null)
const focusedIndex = ref(-1)

// In page scroll the rows stay virtualized against the page's scroll owner (the nearest scrolling
// ancestor); `scrollMargin` is where the rows start inside it, re-measured when the content above
// (filters, panels, notices) changes height.
const pageScrollMode = useMediaQuery(PAGE_SCROLL_QUERY)
const inPage = computed(() => !!props.pageScroll && pageScrollMode.value)
const pageScroller = shallowRef<HTMLElement | null>(null)
const scrollMargin = ref(0)
function scrollOwner() {
  return inPage.value ? pageScroller.value : scrollRef.value
}
function measureMargin() {
  const owner = pageScroller.value
  if (!inPage.value || !owner || !scrollRef.value) return
  scrollMargin.value = Math.round(scrollRef.value.getBoundingClientRect().top - owner.getBoundingClientRect().top + owner.scrollTop)
}
// A sticky element stays only within its parent: in page scroll the composer is shown in a slot that
// spans the whole page (provided by TaskListView), so it stays reachable wherever the page is scrolled.
const composerSlot = inject<Ref<HTMLElement | null>>(COMPOSER_SLOT, ref(null))
let resizeObserver: ResizeObserver | undefined
watch(inPage, (value) => {
  resizeObserver?.disconnect()
  if (!value) return
  void nextTick(() => {
    let owner = scrollRef.value?.parentElement ?? null
    while (owner && !/(auto|scroll)/.test(getComputedStyle(owner).overflowY)) owner = owner.parentElement
    pageScroller.value = owner
    measureMargin()
    resizeObserver = new ResizeObserver(measureMargin)
    if (owner?.firstElementChild) resizeObserver.observe(owner.firstElementChild)
  })
}, { immediate: true })
onBeforeUnmount(() => resizeObserver?.disconnect())

const virtualizer = useVirtualizer(computed(() => ({
  count: rows.value.length,
  getScrollElement: scrollOwner,
  estimateSize: () => ROW_HEIGHT,
  overscan: 12,
  scrollMargin: inPage.value ? scrollMargin.value : 0,
  // Rows scrolled to by keyboard stop above the composer at the bottom of the screen (4.5rem).
  scrollPaddingEnd: inPage.value && props.canCreate ? 72 : 0,
  getItemKey: (index: number) => rows.value[index]?.key ?? index
})))
const virtualRows = computed(() =>
  virtualizer.value.getVirtualItems().flatMap((item) => {
    const row = rows.value[item.index]
    return row ? [{ item, row }] : []
  })
)
const taskIndexes = computed(() => rows.value.flatMap((row, index) => (row.kind === 'task' ? [index] : [])))

onMounted(() => {
  const saved = props.scrollKey ? scrollMemory.get(props.scrollKey) : undefined
  if (saved) requestAnimationFrame(() => { const owner = scrollOwner(); if (owner) owner.scrollTop = saved })
})
onBeforeUnmount(() => {
  const owner = scrollOwner()
  if (props.scrollKey && owner) scrollMemory.set(props.scrollKey, owner.scrollTop)
})

async function focusRow(index: number) {
  focusedIndex.value = index
  virtualizer.value.scrollToIndex(index, { align: 'auto' })
  // A row far from the screen is rendered only after the scroll it causes: wait a few frames for it.
  for (let frame = 0; frame < 10; frame++) {
    await nextTick()
    const row = scrollRef.value?.querySelector<HTMLElement>(`[data-row-index="${index}"] [role="listitem"]`)
    if (row) {
      row.focus({ preventScroll: true })
      return
    }
    await new Promise(resolve => requestAnimationFrame(resolve))
  }
}

function focusCreate() {
  // A plain focus, exactly like tapping the field: iOS then moves the field above its keyboard (with
  // preventScroll the New task button left the field hidden behind the keyboard).
  createInput.value?.inputRef?.focus()
}

function moveFocus(delta: number) {
  const positions = taskIndexes.value
  const current = positions.indexOf(focusedIndex.value)
  const next = nextFocusIndex(current, delta, positions.length)
  if (next >= 0) void focusRow(positions[next]!)
}

// Keyboard map (docs/05 §3.4): j/k or arrows move, Enter opens, x selects (Shift+x extends the
// range), e expands Actions, s stars, d toggles My Day. Statuses are chosen from the status menu.
function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, [contenteditable="true"]')) return
  const row = rows.value[focusedIndex.value]
  const task = row?.kind === 'task' ? row.task : null
  const handlers: Record<string, () => void> = {
    ArrowDown: () => moveFocus(1),
    j: () => moveFocus(1),
    ArrowUp: () => moveFocus(-1),
    k: () => moveFocus(-1)
  }
  if (task) {
    Object.assign(handlers, {
      'Enter': () => emit('open', task),
      'x': () => emit('select', task, false),
      'X': () => emit('select', task, true),
      'e': () => emit('expand', task),
      's': () => emit('attribute', task, 'isImportant'),
      'd': () => emit('attribute', task, 'isMyDay')
    })
  }
  const handler = handlers[event.key]
  if (handler && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault()
    handler()
  }
}

// The composer sits below the list (client revision); new Tasks keep their server position at the
// top, so committing scrolls the list there to show the new row and its saving state. In page scroll
// the page stays where it is: moving it would carry the composer away from the person typing.
function commitFromComposer() {
  emit('commit')
  if (!inPage.value) virtualizer.value.scrollToIndex(0, { align: 'start' })
}

function onCreateKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault()
    commitFromComposer()
  } else if (event.key === 'Escape') {
    (event.target as HTMLInputElement).blur()
  } else if (event.key === 'ArrowUp' && taskIndexes.value.length) {
    event.preventDefault()
    void focusRow(taskIndexes.value[taskIndexes.value.length - 1]!)
  }
}

function onCreateBlur() {
  // Blur with text commits, so clicking elsewhere never loses what was typed (ADR-011).
  if (input.value.trim()) commitFromComposer()
}

defineShortcuts({ c: () => { if (props.canCreate) focusCreate() } })
defineExpose({ focusCreate })
</script>

<template>
  <div class="@container flex flex-col" :class="inPage ? '' : 'h-full min-h-0'">
    <div
      class="h-10 shrink-0 border-b border-default bg-surface px-3 text-meta text-muted @2xl:px-5"
      :class="showDue === false ? TASK_GRID_NO_DUE : TASK_GRID"
    >
      <span /><span />
      <TaskColumnHeader label="Task" column="title" :sort="columnSort" :sortable="sortable" @sort="emit('sort', $event)" />
      <TaskColumnHeader label="Status" column="status" :sort="columnSort" :sortable="sortable" class="hidden @lg:flex" @sort="emit('sort', $event)" />
      <TaskColumnHeader label="Space" column="space" :sort="columnSort" :sortable="sortable" class="hidden @4xl:flex" @sort="emit('sort', $event)" />
      <TaskColumnHeader label="Priority" column="priority" :sort="columnSort" :sortable="sortable" class="hidden @4xl:flex" @sort="emit('sort', $event)" />
      <TaskColumnHeader v-if="showDue !== false" label="Due" end />
      <TaskColumnHeader label="Last modified" column="modified" :sort="columnSort" :sortable="sortable" end class="hidden @2xl:flex" @sort="emit('sort', $event)" />
      <TaskColumnHeader label="People" end class="hidden @2xl:block" />
    </div>
    <div
      ref="scrollRef"
      :class="inPage ? '' : 'min-h-0 flex-1 overflow-y-auto overscroll-contain'"
      role="list"
      aria-label="Tasks"
      @keydown="onKeydown"
    >
      <div class="relative w-full" :style="{ height: `${virtualizer.getTotalSize()}px` }">
        <div
          v-for="{ item, row } in virtualRows"
          :key="String(item.key)"
          :data-row-index="item.index"
          class="absolute inset-x-0 top-0"
          :style="{ height: `${item.size}px`, transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }"
        >
          <TaskRow
            v-if="row.kind === 'task'"
            :task="row.task"
            :focused="focusedIndex === item.index"
            :active="activeTask === row.task.name"
            :can-edit="canEdit !== false"
            :selected="selected.has(row.task.name)"
            :expanded="expanded[row.task.name] !== undefined"
            :striped="item.index % 2 === 1"
            :show-due="showDue"
            :filterable="filterable"
            :now="now"
            :draggable="draggableRows ? 'true' : undefined"
            @dragstart="(event: DragEvent) => startDrag(event, row.task)"
            @focus="focusedIndex = item.index"
            @open="emit('open', row.task)"
            @status="(status) => emit('status', row.task, status)"
            @select="(range) => emit('select', row.task, range)"
            @expand="emit('expand', row.task)"
            @attribute="(field) => emit('attribute', row.task, field)"
            @filter="(field, value) => emit('filter', field, value)"
          />

          <div
            v-else-if="row.kind === 'group'"
            class="flex h-12 items-center gap-2 border-b border-default bg-elevated/60 px-2 text-sm sm:px-3"
            role="listitem"
            :aria-label="`${row.batch ? `Batch ${row.batch.title}` : 'Not in a Batch'}, ${row.count} ${row.count === 1 ? 'task' : 'tasks'}${row.collapsed ? ', collapsed' : ''}`"
            :data-group="row.batch?.name ?? 'none'"
          >
            <UButton
              :icon="row.collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
              color="neutral"
              variant="ghost"
              size="xs"
              square
              :aria-expanded="row.collapsed ? 'false' : 'true'"
              :aria-label="`${row.collapsed ? 'Expand' : 'Collapse'} ${row.batch ? row.batch.title : 'tasks without a Batch'}`"
              @click="toggleGroup(row.batch?.name ?? 'none')"
            />
            <UIcon :name="row.batch ? 'i-lucide-calendar-range' : 'i-lucide-inbox'" class="size-4 shrink-0 text-muted" />
            <ULink v-if="row.batch" :to="`/batches/${row.batch.name}`" class="min-w-0 truncate font-semibold text-highlighted hover:underline">
              {{ row.batch.title }}
            </ULink>
            <span v-else class="font-semibold text-highlighted">Not in a Batch</span>
            <BatchStatusBadge v-if="row.batch" :status="row.batch.status" size="sm" />
            <span class="ms-auto shrink-0 text-xs tabular-nums text-muted">{{ row.count }} {{ row.count === 1 ? 'task' : 'tasks' }}</span>
          </div>

          <div
            v-else-if="row.kind === 'action'"
            class="flex h-12 items-center gap-2 border-b border-default/60 bg-muted/30 ps-16 pe-3 text-sm"
            role="listitem"
            :aria-label="`Action of ${row.task.title}: ${row.action.title}`"
            :data-action="row.action.name"
          >
            <UCheckbox
              :model-value="row.action.promotedTask ? !!row.action.promotedTaskCompleted : row.action.isDone"
              :disabled="canEdit === false || !!row.action.promotedTask"
              :aria-label="`${row.action.isDone ? 'Reopen' : 'Complete'} action: ${row.action.title}`"
              @update:model-value="(value) => emit('actionDone', row.action, value === true)"
            />
            <span class="min-w-0 flex-1 truncate" :class="row.action.isDone || row.action.promotedTaskCompleted ? 'text-muted line-through' : 'text-default'">
              {{ row.action.title }}
            </span>
            <ULink v-if="row.action.promotedTask" :to="`/tasks/${row.action.promotedTask}`" class="flex shrink-0 items-center gap-1 text-xs text-primary">
              <UIcon name="i-lucide-arrow-up-right" class="size-3.5" /> Promoted
            </ULink>
          </div>

          <div
            v-else-if="row.kind === 'actions-status'"
            class="flex h-12 items-center gap-2 border-b border-default/60 bg-muted/30 ps-16 pe-3 text-xs text-muted"
            role="listitem"
          >
            <template v-if="row.status === 'loading'">
              <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" /> Loading actions…
            </template>
            <template v-else-if="row.status === 'error'">
              <UIcon name="i-lucide-circle-alert" class="size-4 text-error" /> Actions could not be loaded.
              <UButton size="xs" variant="link" label="Retry" @click="emit('expand', row.task)" />
            </template>
            <template v-else>No actions.</template>
          </div>

          <div
            v-else
            class="flex h-12 items-center gap-2 border-b border-default px-3 text-sm sm:px-4"
            role="listitem"
            :aria-busy="row.draft.status === 'saving'"
            data-testid="draft-row"
          >
            <UIcon
              :name="row.draft.status === 'saving' ? 'i-lucide-loader-circle' : 'i-lucide-circle-alert'"
              class="size-4 shrink-0"
              :class="row.draft.status === 'saving' ? 'animate-spin text-muted' : 'text-error'"
            />
            <span class="min-w-0 flex-1 truncate" :class="row.draft.status === 'saving' ? 'text-muted' : 'text-highlighted'">
              {{ row.draft.title }}
            </span>
            <template v-if="row.draft.status === 'failed'">
              <span class="hidden text-xs text-error sm:inline">Not saved</span>
              <UButton size="xs" color="neutral" variant="outline" label="Retry" @click="emit('retry', row.draft.id)" />
              <UButton size="xs" color="neutral" variant="ghost" label="Discard" @click="emit('discard', row.draft.id)" />
            </template>
          </div>
        </div>
      </div>
    </div>
    <!-- In page scroll the composer moves to the page's composer slot (TaskListView), which stays at the
         bottom of the screen anywhere on the page and rests below the last row at the end. -->
    <Teleport v-if="canCreate" :to="composerSlot ?? 'body'" :disabled="!inPage || !composerSlot">
    <div class="shrink-0 border-t border-default bg-canvas px-3 py-3 sm:px-5">
      <div class="group/composer flex h-11 items-center gap-2.5 rounded-pill border border-accented bg-default ps-4 pe-2 shadow-xs transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <UIcon name="i-lucide-plus" class="size-4 shrink-0 text-dimmed group-focus-within/composer:text-primary" />
        <UInput
          ref="createInput"
          v-model="input"
          variant="none"
          placeholder="Add a task…"
          class="flex-1"
          :ui="{ base: 'px-0' }"
          aria-label="New task title"
          maxlength="240"
          @keydown="onCreateKeydown"
          @blur="onCreateBlur"
        />
        <span class="hidden items-center gap-1 text-xs text-dimmed sm:flex">
          <UKbd value="enter" size="sm" /> to add
        </span>
      </div>
    </div>
    </Teleport>
  </div>
</template>