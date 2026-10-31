<script setup lang="ts">
import type { Label, SpaceSummary, TaskListFilters, TaskStatus, UserRef } from '~/types/api'
import { PRIORITIES, TASK_STATUSES } from '~/types/api'
import type { FilterPanelKind } from '~/composables/workspace/useFilterPanel'
import { statusStyle } from '~/utils/taskStatus'
import { avatarStyle } from '~/utils/userColor'

// One filter bar for every Task List (client revision 2): search, status, owner, priority and label
// in one row of equally sized controls. Feature, Version and Batch filters open as side panels
// (F / V) where a list offers them. Every filter is applied server-side. Toggle icons carry soft
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
  sorts: Array<'manual' | 'recently_updated' | 'due_date'>
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

const sortLabels = { manual: 'Manual order', recently_updated: 'Recently updated', due_date: 'Due date' } as const
const sortParam = { manual: 'manual', recently_updated: 'recent', due_date: 'due' } as const
const sortItems = computed(() => props.sorts.map(sort => ({ label: sortLabels[sort], value: sortParam[sort] })))
const priorityItems = [{ label: 'Any priority', value: 'any' }, ...PRIORITIES.map(priority => ({ label: priority, value: priority }))]
const labelItems = computed(() => [{ label: 'Any label', value: 'any' }, ...(props.labels ?? []).map(label => ({ label: label.title, value: label.name, chip: { color: label.color } }))])
const statusItems = TASK_STATUSES.map(status => ({ label: status, value: status, icon: statusStyle(status).icon, ui: { itemLeadingIcon: statusStyle(status).text } }))
const personItems = (people: UserRef[] | undefined) => (people ?? []).map(person => ({
  label: person.fullName,
  value: person.name,
  avatar: { src: person.image ?? undefined, alt: person.fullName, class: person.image ? undefined : 'masar-avatar', style: person.image ? undefined : avatarStyle(person.name) }
}))
const ownerItems = computed(() => personItems(props.owners))
const assigneeItems = computed(() => personItems(props.assignees))
const spaceItems = computed(() => (props.spaces ?? []).map(space => ({ label: space.title, value: space.name })))
// What the Status, Owner, Assignee and Space buttons show; their accessible names include it (QA-D10).
// Task lists show every Task unless statuses are chosen (client request, Oct 2026).
const statusText = computed(() => (props.filters.statuses?.length ? props.filters.statuses.join(', ') : 'Status: any'))
const ownerText = computed(() => (props.filters.owners?.length ? ownerItems.value.filter(o => props.filters.owners!.includes(o.value)).map(o => o.label).join(', ') : 'Owner: anyone'))
const assigneeText = computed(() => (props.filters.assignees?.length ? assigneeItems.value.filter(o => props.filters.assignees!.includes(o.value)).map(o => o.label).join(', ') : 'Assignee: anyone'))
const spaceText = computed(() => (props.filters.spaces?.length ? spaceItems.value.filter(o => props.filters.spaces!.includes(o.value)).map(o => o.label).join(', ') : 'Space: all'))

function setList(param: string, values: string[]) {
  emit('set', { [param]: values.join(',') || null })
}
function setSpaces(values: string[]) {
  // Labels and Features belong to one Space; a different Space choice clears them.
  emit('set', { spaces: values.join(',') || null, label: null, feature: null, release: null })
}

const PANELS: Record<FilterPanelKind, { label: string, icon: string, tone: string, key?: string, param: string }> = {
  feature: { label: 'Features', icon: 'i-lucide-map', tone: 'text-filter-feature', key: 'F', param: 'feature' },
  release: { label: 'Versions', icon: 'i-lucide-package', tone: 'text-filter-release', key: 'V', param: 'release' },
  batch: { label: 'Sprints', icon: 'i-lucide-calendar-range', tone: 'text-filter-sprint', param: 'batch' }
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
</script>

<template>
  <div class="@container border-b border-default px-4 py-3.5 sm:px-5" :class="singleRow ? 'flex flex-wrap items-center gap-1.5' : 'flex flex-col gap-3'">
    <div :class="singleRow ? 'contents' : 'flex flex-wrap items-center gap-3'">
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
      <USelectMenu
        :model-value="filters.statuses ?? []"
        :items="statusItems"
        value-key="value"
        multiple
        placeholder="Status"
        icon="i-lucide-circle-dot"
        :search-input="false"
        :class="control"
        :aria-label="`Filter by status: ${statusText}`"
        @update:model-value="(values: TaskStatus[]) => setList('status', values)"
      >
        <template #default="{ modelValue }">
          <span class="truncate" :class="(modelValue as string[] | undefined)?.length ? 'text-highlighted' : 'text-dimmed'">
            {{ (modelValue as string[] | undefined)?.length ? (modelValue as string[]).join(', ') : 'Status: any' }}
          </span>
        </template>
      </USelectMenu>
      <USelectMenu
        v-if="owners"
        :model-value="filters.owners ?? []"
        :items="ownerItems"
        value-key="value"
        multiple
        placeholder="Owner"
        icon="i-lucide-crown"
        :search-input="{ placeholder: 'Find a person' }"
        :class="control"
        :aria-label="`Filter by owner: ${ownerText}`"
        @update:model-value="(values: string[]) => setList('owner', values)"
      >
        <template #default="{ modelValue }">
          <span class="truncate" :class="(modelValue as string[] | undefined)?.length ? 'text-highlighted' : 'text-dimmed'">
            {{ (modelValue as string[] | undefined)?.length ? ownerItems.filter(o => (modelValue as string[]).includes(o.value)).map(o => o.label).join(', ') : 'Owner: anyone' }}
          </span>
        </template>
      </USelectMenu>
      <USelectMenu
        v-if="assignees"
        :model-value="filters.assignees ?? []"
        :items="assigneeItems"
        value-key="value"
        multiple
        placeholder="Assignee"
        icon="i-lucide-users"
        :search-input="{ placeholder: 'Find a person' }"
        :class="control"
        :aria-label="`Filter by assignee: ${assigneeText}`"
        @update:model-value="(values: string[]) => setList('assignee', values)"
      >
        <template #default>
          <span class="truncate" :class="filters.assignees?.length ? 'text-highlighted' : 'text-dimmed'">{{ assigneeText }}</span>
        </template>
      </USelectMenu>
      <USelectMenu
        v-if="spaces"
        :model-value="filters.spaces ?? []"
        :items="spaceItems"
        value-key="value"
        multiple
        icon="i-lucide-layout-grid"
        :search-input="{ placeholder: 'Find a Space' }"
        :class="control"
        :aria-label="`Filter by Space: ${spaceText}`"
        @update:model-value="setSpaces"
      >
        <template #default="{ modelValue }">
          <span class="truncate" :class="(modelValue as string[] | undefined)?.length ? 'text-highlighted' : 'text-dimmed'">
            {{ (modelValue as string[] | undefined)?.length ? spaceItems.filter(o => (modelValue as string[]).includes(o.value)).map(o => o.label).join(', ') : 'Space: all' }}
          </span>
        </template>
      </USelectMenu>
      <USelect :model-value="filters.priority ?? 'any'" :items="priorityItems" :class="control" aria-label="Filter by priority" @update:model-value="(value) => emit('set', { priority: value === 'any' ? null : String(value) })" />
      <USelect v-if="labels" :model-value="filters.label ?? 'any'" :items="labelItems" :class="control" aria-label="Filter by label" :disabled="!labels.length" @update:model-value="(value) => emit('set', { label: value === 'any' ? null : String(value) })" />
      <USelect v-if="sorts.length > 1" :model-value="sortParam[filters.sort]" :items="sortItems" :class="control" aria-label="Sort tasks" @update:model-value="(value) => emit('set', { sort: String(value) })" />
    </div>
    <div :class="singleRow ? 'contents' : 'flex flex-wrap items-center gap-3'">
      <UTooltip v-if="showMine" :text="singleRow ? 'Assigned to me' : undefined" :disabled="!singleRow">
        <UButton
          color="neutral"
          icon="i-lucide-user-check"
          :variant="filters.assignedToMe ? 'soft' : 'outline'"
          :ui="{ leadingIcon: 'text-filter-mine' }"
          :aria-pressed="filters.assignedToMe"
          aria-label="Assigned to me"
          @click="emit('set', { mine: filters.assignedToMe ? null : 'assigned' })"
        >
          <span :class="toggleLabel">Assigned to me</span>
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
      <UTooltip v-if="groupable" :text="singleRow ? 'Group by Sprint' : undefined" :disabled="!singleRow">
        <UButton
          color="neutral"
          icon="i-lucide-rows-3"
          :variant="grouped ? 'soft' : 'outline'"
          :ui="{ leadingIcon: 'text-filter-sprint' }"
          :aria-pressed="grouped"
          aria-label="Group by Sprint"
          @click="emit('set', { group: grouped ? null : 'sprint' })"
        >
          <span :class="toggleLabel">Group by Sprint</span>
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
      <UButton v-if="activeCount" variant="link" color="neutral" :label="`Clear ${activeCount} filter${activeCount === 1 ? '' : 's'}`" @click="search = ''; emit('clear')" />
      <slot name="actions" />
    </div>
  </div>
</template>
