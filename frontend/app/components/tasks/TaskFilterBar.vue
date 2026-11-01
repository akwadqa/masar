<script setup lang="ts">
import type { Label, SpaceSummary, TaskListFilters, TaskSort, UserRef } from '~/types/api'
import type { FilterPanelKind } from '~/composables/workspace/useFilterPanel'
import { toggleMine, type MinePart } from '~/utils/mineFilter'

// One filter bar for every Task List: search, the filter chips (Status, Assignee, Owner, Priority,
// Label, Space; specs/dynamic-task-filters.md) and sort. Feature, Version and Batch filters open as
// side panels (F / V) where a list offers them. Every filter is applied server-side. Toggle icons carry soft
// colours so the bar does not read as greyscale (client revision 4); with `singleRow` (All Tasks) the
// filters and toggles share one row, and the toggles show only their icon on narrower screens.
const props = defineProps<{
  filters: TaskListFilters
  labels?: Label[]
  /** Space filter (All Tasks): several of the user's Spaces */
  spaces?: SpaceSummary[]
  /** People who own Tasks in this list's Spaces */
  owners?: UserRef[]
  /** People assigned to Tasks in this list's Spaces */
  assignees?: UserRef[]
  /** Which side panels this list offers; Feature and Version need a single Space. */
  panels?: FilterPanelKind[]
  /** Side panels that are open (each one independently) */
  openPanels?: FilterPanelKind[]
  singleRow?: boolean
  /** Display names of the active Feature / Release / Batch filters, for their chips. */
  activeNames?: Partial<Record<FilterPanelKind, string>>
  /** Shows the "Group by Batch" toggle (Space Task List) and its state */
  groupable?: boolean
  grouped?: boolean
  showMine?: boolean
  sorts: TaskSort[]
  activeCount: number
}>()
const emit = defineEmits<{
  set: [patch: Record<string, string | null | undefined>]
  clear: []
  togglePanel: [kind: FilterPanelKind]
}>()

const search = ref(props.filters.q ?? '')
let timer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => emit('set', { q: value.trim() || null }), 250)
})
watch(() => props.filters.q, (value) => { if ((value ?? '') !== search.value.trim()) search.value = value ?? '' })
onBeforeUnmount(() => clearTimeout(timer))

const searchInput = ref<{ inputRef?: HTMLInputElement } | null>(null)
defineShortcuts({ '/': () => searchInput.value?.inputRef?.focus() })

const sortLabels: Record<TaskSort, string> = { manual: 'Manual order', recently_updated: 'Recently updated', due_date: 'Due date', created: 'Creation date' }
const sortParam: Record<TaskSort, string> = { manual: 'manual', recently_updated: 'recent', due_date: 'due', created: 'created' }
const sortItems = computed(() => props.sorts.map(sort => ({ label: sortLabels[sort], value: sortParam[sort] })))
const chips = ref<{ reset: () => void } | null>(null)

function clearAll() {
  search.value = ''
  chips.value?.reset()
  emit('clear')
}

const PANELS: Record<FilterPanelKind, { label: string, icon: string, tone: string, key?: string, param: string }> = {
  feature: { label: 'Features', icon: 'i-lucide-map', tone: 'text-filter-feature', key: 'F', param: 'feature' },
  release: { label: 'Versions', icon: 'i-lucide-package', tone: 'text-filter-release', key: 'V', param: 'release' },
  batch: { label: 'Batches', icon: 'i-lucide-calendar-range', tone: 'text-filter-batch', param: 'batch' }
}
const activePanelChips = computed(() => (Object.keys(PANELS) as FilterPanelKind[]).flatMap((kind) => {
  const value = props.filters[kind]
  return value ? [{ ...PANELS[kind], kind, label: props.activeNames?.[kind] ?? value }] : []
}))
// Phones (QA-D01): controls sit two to a row wherever both show their whole label, and grow to fill
// the row; a control that does not fit beside another takes the full width, as before.
const control = computed(() => (props.singleRow ? 'w-full sm:w-auto sm:max-w-48' : 'max-sm:max-w-full max-sm:grow sm:w-44'))
// One row: toggle labels appear once the bar is wide enough for them (container query).
const toggleLabel = computed(() => (props.singleRow ? 'hidden @[87.5rem]:inline' : ''))
// Assigned to me and Owned by me are independent toggles over the one `mine` URL value.
function onMine(part: MinePart) {
  emit('set', { mine: toggleMine(props.filters, part) })
}
</script>

<template>
  <!-- One row that wraps on narrow screens (client request 2026-10-31: the chips left room for it). -->
  <div class="@container flex flex-wrap items-center border-b border-default px-4 py-3.5 sm:px-5" :class="singleRow ? 'gap-1.5' : 'gap-2'">
    <div class="contents">
      <UInput
        ref="searchInput"
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search tasks"
        :class="singleRow ? 'w-full sm:w-auto sm:min-w-40 sm:max-w-64 sm:flex-1' : 'max-sm:max-w-full max-sm:grow sm:w-64'"
        aria-label="Search tasks"
      >
        <template #trailing>
          <span class="hidden px-1 text-sm text-dimmed sm:inline" aria-hidden="true">/</span>
        </template>
      </UInput>
      <TaskFilterChips
        ref="chips"
        :filters="filters"
        :labels="labels"
        :spaces="spaces"
        :owners="owners"
        :assignees="assignees"
        @set="(patch) => emit('set', patch)"
      />
      <USelect v-if="sorts.length > 1" :model-value="sortParam[filters.sort]" :items="sortItems" :class="control" aria-label="Sort tasks" @update:model-value="(value) => emit('set', { sort: String(value) })" />
    </div>
    <div class="contents">
      <UTooltip v-if="showMine" :text="singleRow ? 'Assigned to me' : undefined" :disabled="!singleRow">
        <UButton
          color="neutral"
          icon="i-lucide-user-check"
          :variant="filters.assignedToMe ? 'soft' : 'outline'"
          :ui="{ leadingIcon: 'text-filter-mine' }"
          :aria-pressed="filters.assignedToMe"
          aria-label="Assigned to me"
          @click="onMine('assigned')"
        >
          <span :class="toggleLabel">Assigned to me</span>
        </UButton>
      </UTooltip>
      <!-- Managers track the tasks they own (client request 2026-11-02). The two toggles combine:
           both on = tasks I own AND am assigned to (client decision 2026-11-02). -->
      <UTooltip v-if="showMine" :text="singleRow ? 'Owned by me' : undefined" :disabled="!singleRow">
        <UButton
          color="neutral"
          icon="i-lucide-crown"
          :variant="filters.ownedByMe ? 'soft' : 'outline'"
          :ui="{ leadingIcon: 'text-filter-owner' }"
          :aria-pressed="filters.ownedByMe"
          aria-label="Owned by me"
          @click="onMine('owned')"
        >
          <span :class="toggleLabel">Owned by me</span>
        </UButton>
      </UTooltip>
      <UTooltip :text="singleRow ? 'Important' : undefined" :disabled="!singleRow">
        <UButton
          color="neutral"
          icon="i-lucide-star"
          variant="outline"
          :class="filters.important ? 'bg-focus-tint text-focus-accent hover:bg-focus-tint' : ''"
          :ui="{ leadingIcon: 'text-filter-important' }"
          :aria-pressed="!!filters.important"
          aria-label="Important"
          @click="emit('set', { important: filters.important ? null : '1' })"
        >
          <span :class="toggleLabel">Important</span>
        </UButton>
      </UTooltip>
      <UButton
        v-for="kind in panels ?? []"
        :key="kind"
        :icon="PANELS[kind].icon"
        :color="openPanels?.includes(kind) || filters[kind] ? 'primary' : 'neutral'"
        :variant="openPanels?.includes(kind) ? 'soft' : 'outline'"
        :ui="{ leadingIcon: PANELS[kind].tone }"
        :aria-pressed="!!openPanels?.includes(kind)"
        :aria-label="`${PANELS[kind].label} panel`"
        @click="emit('togglePanel', kind)"
      >
        {{ PANELS[kind].label }}
        <UKbd v-if="PANELS[kind].key" :value="PANELS[kind].key" variant="soft" class="hidden sm:inline-flex" />
      </UButton>
      <slot name="tools" />
      <UTooltip v-if="groupable" :text="singleRow ? 'Group by Batch' : undefined" :disabled="!singleRow">
        <UButton
          color="neutral"
          icon="i-lucide-rows-3"
          :variant="grouped ? 'soft' : 'outline'"
          :ui="{ leadingIcon: 'text-filter-batch' }"
          :aria-pressed="grouped"
          aria-label="Group by Batch"
          @click="emit('set', { group: grouped ? null : 'batch' })"
        >
          <span :class="toggleLabel">Group by Batch</span>
        </UButton>
      </UTooltip>
      <span
        v-for="chip in activePanelChips"
        :key="chip.kind"
        class="inline-flex h-8 items-center gap-1.5 rounded-pill bg-primary/10 ps-3 pe-1 text-sm font-medium text-primary"
      >
        <UIcon :name="chip.icon" class="size-4" />
        <span class="max-w-52 truncate">{{ chip.label }}</span>
        <UButton icon="i-lucide-x" size="sm" color="primary" variant="link" class="p-1" :aria-label="`Remove ${chip.label} filter`" @click="emit('set', { [chip.param]: null })" />
      </span>
      <UButton v-if="activeCount" variant="link" color="neutral" :label="`Clear ${activeCount} filter${activeCount === 1 ? '' : 's'}`" @click="clearAll" />
      <slot name="actions" />
    </div>
  </div>
</template>
