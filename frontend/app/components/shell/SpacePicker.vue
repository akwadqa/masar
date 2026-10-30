<script setup lang="ts">
import type { SpaceSummary } from '~/types/api'

// "Browse all Spaces" (client revision 3, after the client's reference): a compact panel beside the
// sidebar with a title, a search field, every Space the user belongs to with its icon, and a link to
// the full Spaces overview. Arrow keys move through the list; Enter opens; Escape closes.
const props = defineProps<{ spaces: SpaceSummary[] }>()
const open = ref(false)
const query = ref('')
const highlighted = ref(0)

const mine = computed(() => props.spaces.filter(space => space.role).sort((a, b) => a.title.localeCompare(b.title)))
const visible = computed(() => {
  const term = query.value.trim().toLowerCase()
  return term ? mine.value.filter(space => space.title.toLowerCase().includes(term)) : mine.value
})
watch(query, () => { highlighted.value = 0 })
watch(open, (value) => { if (!value) query.value = '' })

function go(path: string) {
  open.value = false
  void navigateTo(path)
}
function onKeydown(event: KeyboardEvent) {
  const count = visible.value.length
  if (event.key === 'ArrowDown' && count) {
    event.preventDefault()
    highlighted.value = (highlighted.value + 1) % count
  } else if (event.key === 'ArrowUp' && count) {
    event.preventDefault()
    highlighted.value = (highlighted.value - 1 + count) % count
  } else if (event.key === 'Enter' && count) {
    event.preventDefault()
    go(`/spaces/${visible.value[highlighted.value]!.name}/tasks`)
  }
}
</script>

<template>
  <UPopover v-model:open="open" :content="{ side: 'right', align: 'start', sideOffset: 10 }" :ui="{ content: 'w-80' }">
    <button
      type="button"
      class="mt-1 flex w-full items-center gap-2.5 rounded-pill py-2 ps-3 pe-2 text-sm font-medium text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
      :aria-expanded="open"
    >
      <UIcon name="i-lucide-layout-grid" class="size-4" />
      Browse all Spaces
      <span class="font-normal text-muted">{{ mine.length }}</span>
      <UIcon name="i-lucide-chevron-right" class="ms-auto size-4 text-dimmed" />
    </button>
    <template #content>
      <div class="flex flex-col gap-2 p-3" role="dialog" aria-label="Spaces">
        <div class="flex items-center justify-between ps-1">
          <h2 class="text-section text-highlighted">Spaces</h2>
          <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" square aria-label="Close Spaces" @click="open = false" />
        </div>
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Search all Spaces"
          autofocus
          class="w-full"
          aria-label="Search all Spaces"
          @keydown="onKeydown"
        />
        <ul class="flex max-h-80 flex-col gap-0.5 overflow-y-auto" aria-label="All Spaces">
          <li v-for="(space, index) in visible" :key="space.name">
            <NuxtLink
              :to="`/spaces/${space.name}/tasks`"
              class="flex items-center gap-2.5 rounded-(--ui-radius) px-2 py-1.5 text-sm text-default"
              :class="highlighted === index ? 'bg-elevated text-highlighted' : 'hover:bg-elevated'"
              @mouseenter="highlighted = index"
              @click="open = false"
            >
              <SpaceIcon :space="space" size="sm" />
              <span class="truncate">{{ space.title }}</span>
            </NuxtLink>
          </li>
          <li v-if="!visible.length" class="px-2 py-1.5 text-sm text-muted">No Spaces match.</li>
        </ul>
        <USeparator />
        <button type="button" class="flex items-center gap-2.5 rounded-(--ui-radius) px-2 py-1.5 text-start text-sm text-default hover:bg-elevated" @click="go('/spaces')">
          <UIcon name="i-lucide-list" class="size-4 text-muted" />
          View all Spaces
        </button>
      </div>
    </template>
  </UPopover>
</template>
