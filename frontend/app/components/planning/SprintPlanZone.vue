<script setup lang="ts">
import { carriesTasks, readTaskDrop } from '~/utils/taskGrid'

// Shown on the planning board while no Sprint is current (client revision 4): a dashed area that
// invites planning. Tasks dropped here open "Create Sprint" and join the new Sprint once it exists.
const props = defineProps<{ canCreate: boolean }>()
const emit = defineEmits<{ create: [names?: string[]] }>()

const hovered = ref(false)
function onDragOver(event: DragEvent) {
  if (!props.canCreate || !carriesTasks(event)) return
  event.preventDefault()
  hovered.value = true
}
function onDrop(event: DragEvent) {
  hovered.value = false
  const names = readTaskDrop(event)
  if (!names || !props.canCreate) return
  event.preventDefault()
  emit('create', names)
}
</script>

<template>
  <section
    class="flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-8 text-center transition-colors"
    :class="hovered ? 'border-primary bg-primary/10' : 'border-accented bg-elevated/40'"
    aria-labelledby="sprint-plan-heading"
    data-testid="sprint-plan-zone"
    @dragover="onDragOver"
    @dragleave.self="hovered = false"
    @drop="onDrop"
  >
    <span class="flex size-11 items-center justify-center rounded-full bg-filter-sprint/10">
      <UIcon name="i-lucide-calendar-plus" class="size-6 text-filter-sprint" />
    </span>
    <h2 id="sprint-plan-heading" class="text-section text-highlighted">Plan your Sprint</h2>
    <p v-if="canCreate" class="max-w-xl text-sm text-muted">
      Drag tasks from the Backlog section into this area, or create a new Sprint, to plan the work for this Sprint.
      Select Start Sprint when you're ready.
    </p>
    <p v-else class="max-w-xl text-sm text-muted">
      No Sprint is planned yet. Space Managers create Sprints and plan tasks into them.
    </p>
    <UButton v-if="canCreate" icon="i-lucide-plus" label="Create Sprint" @click="emit('create')" />
  </section>
</template>
