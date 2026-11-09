<script setup lang="ts">
// Who else has this Task, Batch or Space open right now (specs/realtime.md, F4; client decision
// 2026-11-09: presence on Tasks, Batches and Spaces). Frappe's socket server keeps the list; it empties by
// itself when a tab closes or loses its connection. Shown as a pill with a live dot and "viewing", so it
// is not mistaken for the member avatars beside it (client feedback 2026-11-09: make it obvious).
const props = defineProps<{ doctype: 'Masar Task' | 'Masar Batch' | 'Masar Space', name: string | null | undefined }>()
const { viewers } = useDocumentRoom(props.doctype, () => props.name)
const people = usePeople(viewers)
const firstName = (fullName: string) => fullName.split(' ')[0]
const summary = computed(() => (people.value.length === 1 ? `${firstName(people.value[0]!.fullName)} is viewing` : `${people.value.length} viewing`))
const label = computed(() => `Also viewing now: ${people.value.map(person => person.fullName).join(', ')}`)
</script>

<template>
  <UTooltip v-if="people.length" :text="label">
    <div
      class="flex h-8 items-center gap-1.5 rounded-pill bg-success/10 ps-2 pe-1 ring-1 ring-success/30 sm:pe-2.5"
      role="img"
      :aria-label="label"
      data-testid="presence"
    >
      <span class="relative flex size-2" aria-hidden="true">
        <span class="absolute inline-flex size-full rounded-full bg-success opacity-60 motion-safe:animate-ping" />
        <span class="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      <span class="flex items-center -space-x-1.5">
        <UserAvatar v-for="person in people.slice(0, 3)" :key="person.name" :user="person" size="xs" class="ring-2 ring-(--ui-bg)" />
      </span>
      <span v-if="people.length > 3" class="text-xs font-medium text-success">+{{ people.length - 3 }}</span>
      <span class="hidden whitespace-nowrap text-xs font-medium text-success sm:inline">{{ summary }}</span>
    </div>
  </UTooltip>
</template>
