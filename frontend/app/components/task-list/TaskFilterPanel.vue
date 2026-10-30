<script setup lang="ts">
import type { FilterPanelItem, FilterPanelKind } from '~/composables/workspace/useFilterPanel'

// Boxed filter column (client revision 2): Versions, Features or Batches as a rounded box beside the
// list, with a "without" entry, progress for each item, search, close and an optional create link.
// Its size comes from where it is placed (TaskListView); `compact` is two panels side by side on a phone.
const props = defineProps<{
  kind: FilterPanelKind
  items: FilterPanelItem[]
  selected: string | null
  canCreate?: boolean
  compact?: boolean
}>()
const emit = defineEmits<{ select: [value: string | null], close: [], create: [] }>()

const TITLES: Record<FilterPanelKind, { title: string, create: string }> = {
  feature: { title: 'Features', create: 'Create Feature' },
  release: { title: 'Versions', create: 'Create Version' },
  batch: { title: 'Sprints', create: 'Create Sprint' }
}
const query = ref('')
const visible = computed(() => {
  const term = query.value.trim().toLowerCase()
  return term ? props.items.filter(item => item.label.toLowerCase().includes(term)) : props.items
})
const title = computed(() => TITLES[props.kind])
const searchable = computed(() => props.items.length > 8)
</script>

<template>
  <aside
    class="flex flex-col gap-1 rounded-card bg-elevated/70"
    :class="compact ? 'min-w-0 p-2' : 'p-3'"
    :aria-label="`${title.title} filter`"
    @keydown.esc="emit('close')"
  >
    <div class="flex items-center justify-between px-1 pb-1">
      <h2 class="text-section text-highlighted">{{ title.title }}</h2>
      <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="sm" square :aria-label="`Close ${title.title} panel`" @click="emit('close')" />
    </div>
    <UInput v-if="searchable" v-model="query" icon="i-lucide-search" :placeholder="`Find ${title.title.toLowerCase()}`" :aria-label="`Find ${title.title.toLowerCase()}`" class="mb-1" />
    <div class="flex min-h-0 flex-col gap-1 overflow-y-auto" role="listbox" :aria-label="title.title">
      <button
        v-for="item in visible"
        :key="item.value"
        type="button"
        role="option"
        :aria-selected="selected === item.value"
        class="flex flex-col gap-2 rounded-(--ui-radius) py-2.5 text-start text-sm transition-colors hover:bg-default"
        :class="[compact ? 'px-2' : 'px-3', selected === item.value ? 'bg-default font-medium text-highlighted ring ring-inset ring-primary' : 'text-default']"
        :title="item.label"
        @click="emit('select', selected === item.value ? null : item.value)"
      >
        <span class="flex w-full items-center gap-2">
          <UIcon :name="item.icon ?? 'i-lucide-chevron-right'" class="size-4 shrink-0 text-dimmed" />
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ item.label }}</span>
            <span v-if="item.meta" class="block truncate text-xs font-normal text-muted">{{ item.meta }}</span>
          </span>
          <span v-if="item.count !== undefined" class="text-xs tabular-nums text-muted">{{ item.count }}</span>
        </span>
        <span v-if="item.percent !== undefined" class="h-1.5 w-full overflow-hidden rounded-full bg-accented" aria-hidden="true">
          <span class="block h-full rounded-full bg-success" :style="{ width: `${item.percent ?? 0}%` }" />
        </span>
      </button>
      <p v-if="!visible.length" class="px-3 py-2 text-sm text-muted">No matches.</p>
    </div>
    <UButton v-if="canCreate" icon="i-lucide-plus" :label="title.create" color="neutral" variant="ghost" class="mt-1 self-start" @click="emit('create')" />
  </aside>
</template>
