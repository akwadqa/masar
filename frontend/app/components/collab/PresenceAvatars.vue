<script setup lang="ts">
// Who else has this Task, Batch or Space open right now (specs/realtime.md, F4; client decision
// 2026-11-09: presence on Tasks, Batches and Spaces). Frappe's socket server keeps the list; it empties by
// itself when a tab closes or loses its connection. Compact avatars with the usual green "online" dot, so
// they are not mistaken for member avatars; 28 px avatars, names on hover (client feedback 2026-11-09).
const props = defineProps<{ doctype: 'Masar Task' | 'Masar Batch' | 'Masar Space', name: string | null | undefined }>()
const { viewers } = useDocumentRoom(props.doctype, () => props.name)
const people = usePeople(viewers)
const label = computed(() => `Also viewing now: ${people.value.map(person => person.fullName).join(', ')}`)
</script>

<template>
  <UTooltip v-if="people.length" :text="label">
    <div class="flex shrink-0 items-center gap-1 pe-1" role="img" :aria-label="label" data-testid="presence">
      <UChip
        v-for="person in people.slice(0, 3)"
        :key="person.name"
        color="success"
        position="bottom-right"
        inset
        :ui="{ base: 'ring-2 ring-(--ui-bg) motion-safe:animate-pulse' }"
      >
        <UserAvatar :user="person" size="sm" class="ring-2 ring-(--ui-bg)" />
      </UChip>
      <span v-if="people.length > 3" class="text-xs text-muted">+{{ people.length - 3 }}</span>
    </div>
  </UTooltip>
</template>
