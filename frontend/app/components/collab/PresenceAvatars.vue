<script setup lang="ts">
// Who else has this Task, Batch or Space open right now (specs/realtime.md, F4; client decision
// 2026-11-09: presence on Tasks, Batches and Spaces). Frappe's socket server keeps the list; it empties by
// itself when a tab closes or loses its connection.
const props = defineProps<{ doctype: 'Masar Task' | 'Masar Batch' | 'Masar Space', name: string | null | undefined }>()
const { viewers } = useDocumentRoom(props.doctype, () => props.name)
const people = usePeople(viewers)
const label = computed(() => `Also viewing: ${people.value.map(person => person.fullName).join(', ')}`)
</script>

<template>
  <UTooltip v-if="people.length" :text="label">
    <div class="flex items-center -space-x-1.5 pe-1" role="img" :aria-label="label" data-testid="presence">
      <UserAvatar v-for="person in people.slice(0, 4)" :key="person.name" :user="person" size="2xs" class="ring-2 ring-(--ui-bg)" />
      <span v-if="people.length > 4" class="ps-2.5 text-xs text-muted">+{{ people.length - 4 }}</span>
    </div>
  </UTooltip>
</template>
