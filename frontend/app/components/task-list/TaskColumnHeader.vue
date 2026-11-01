<script setup lang="ts">
import type { ColumnSort, TaskColumn } from '~/utils/taskSort'

// One Task List column title. Sortable lists make it a button (client revision 6, 2026-11-01): the
// arrow shows the current direction, a click asks the list for the next sort of this column.
const props = defineProps<{
  label: string
  column?: TaskColumn
  sort?: ColumnSort | null
  sortable?: boolean
  end?: boolean
}>()
const emit = defineEmits<{ sort: [column: TaskColumn] }>()

const active = computed(() => !!props.column && props.sort?.column === props.column)
const direction = computed(() => (active.value ? props.sort!.direction : null))
const icon = computed(() => (direction.value === 'asc' ? 'i-lucide-arrow-up' : direction.value === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up-down'))
const state = computed(() => (direction.value ? `, sorted ${direction.value === 'asc' ? 'ascending' : 'descending'}` : ''))
</script>

<template>
  <button
    v-if="sortable && column"
    type="button"
    class="group/sort flex min-w-0 items-center gap-1 rounded-sm text-start outline-none hover:text-highlighted focus-visible:ring-2 focus-visible:ring-primary"
    :class="[end ? 'justify-end' : '', active ? 'text-highlighted' : '']"
    :aria-label="`Sort by ${label}${state}`"
    @click="emit('sort', column)"
  >
    <span class="truncate">{{ label }}</span>
    <UIcon :name="icon" class="size-3.5 shrink-0" :class="active ? '' : 'opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60'" aria-hidden="true" />
  </button>
  <span v-else class="truncate" :class="end ? 'text-end' : ''" aria-hidden="true">{{ label }}</span>
</template>
