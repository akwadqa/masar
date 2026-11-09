<script setup lang="ts">
import { nextTaskAfter } from '~/utils/taskNeighbours'

// `order`: the Task names of the list behind the panel, as shown.
const props = defineProps<{ taskName: string | null, order?: readonly string[] }>()
const emit = defineEmits<{ close: [], open: [name: string] }>()

// After the Task is deleted or set to Completed, Closed or Cancelled, the panel opens the next Task of the
// list instead of closing (client request 2026-11-02). The neighbour is remembered while the Task is
// still listed: the list may already have dropped it (optimistic update, refetch) when the change lands.
const nextTask = ref<string | null>(null)
watch(() => [props.taskName, props.order] as const, ([name, order]) => {
  if (!name) nextTask.value = null
  else if (order?.includes(name)) nextTask.value = nextTaskAfter(order, name)
}, { immediate: true })

function moveOn(closeWithoutNext: boolean) {
  if (nextTask.value) emit('open', nextTask.value)
  else if (closeWithoutNext) emit('close')
}

const open = computed({
  get: () => !!props.taskName,
  set: (value: boolean) => {
    if (!value) emit('close')
  }
})

// Installed on an iPhone, a swipe from the left edge closes the panel (client revision 5).
const body = ref<HTMLElement | null>(null)
useEdgeSwipe(() => body.value?.closest<HTMLElement>('[role="dialog"]'), () => emit('close'), () => open.value)

// The panel stays open when:
// - a click lands on another Task row: it switches the panel to that Task, while closing would go back in
//   history (useTaskPanel) and undo the switch;
// - focus moves to an element that is no longer on the page. After a delete, the confirm dialog hands focus
//   back to the deleted Task's trash button while the panel already shows the next Task; that is not the
//   person leaving the panel.
function keepOpen(event: Event) {
  const target = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent?.target ?? event.target
  if (target instanceof Element && (!target.isConnected || target.closest('[data-task]'))) event.preventDefault()
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="right"
    :modal="false"
    :overlay="false"
    title="Task details"
    :close="false"
    :content="{ onInteractOutside: keepOpen }"
    :ui="{ content: 'w-full sm:max-w-3xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]', header: 'sr-only', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <div ref="body" class="contents">
        <TaskDetail v-if="taskName" :key="taskName" :name="taskName" mode="panel" @deleted="moveOn(true)" @finished="moveOn(false)" @close="emit('close')" />
      </div>
    </template>
  </USlideover>
</template>
