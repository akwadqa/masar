<script setup lang="ts">
const props = defineProps<{ taskName: string | null }>()
const emit = defineEmits<{ close: [] }>()

const open = computed({
  get: () => !!props.taskName,
  set: (value: boolean) => {
    if (!value) emit('close')
  }
})

// Installed on an iPhone, a swipe from the left edge closes the panel (client revision 5).
const body = ref<HTMLElement | null>(null)
useEdgeSwipe(() => body.value?.closest<HTMLElement>('[role="dialog"]'), () => emit('close'), () => open.value)

// A click on another Task row switches the panel to that Task instead of closing it first: closing goes
// back in history (useTaskPanel), which would undo the switch.
function keepOpenForRows(event: Event) {
  const target = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent?.target ?? event.target
  if (target instanceof Element && target.closest('[data-task]')) event.preventDefault()
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
    :content="{ onInteractOutside: keepOpenForRows }"
    :ui="{ content: 'w-full sm:max-w-3xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]', header: 'sr-only', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <div ref="body" class="contents">
        <TaskDetail v-if="taskName" :key="taskName" :name="taskName" mode="panel" @deleted="emit('close')" @close="emit('close')" />
      </div>
    </template>
  </USlideover>
</template>
