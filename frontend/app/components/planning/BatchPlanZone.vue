<script setup lang="ts">
import { carriesTasks, readTaskDrop } from '~/utils/taskGrid'

// Shown on the planning board while no Batch is current (client revision 4): a dashed area that
// invites planning. Tasks dropped here open "Create Batch" and join the new Batch once it exists.
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
    aria-labelledby="batch-plan-heading"
    data-testid="batch-plan-zone"
    @dragover="onDragOver"
    @dragleave.self="hovered = false"
    @drop="onDrop"
  >
    <span class="flex size-11 items-center justify-center rounded-full bg-filter-batch/10">
      <UIcon name="i-lucide-calendar-plus" class="size-6 text-filter-batch" />
    </span>
    <h2 id="batch-plan-heading" class="text-section text-highlighted">Plan your Batch</h2>
    <p v-if="canCreate" class="max-w-xl text-sm text-muted">
      Drag tasks from the Backlog section into this area, or create a new Batch, to plan the work for this Batch.
      Select Start Batch when you're ready.
    </p>
    <p v-else class="max-w-xl text-sm text-muted">
      No Batch is planned yet. Space Managers create Batches and plan tasks into them.
    </p>
    <UButton v-if="canCreate" icon="i-lucide-plus" label="Create Batch" @click="emit('create')" />
  </section>
</template>
