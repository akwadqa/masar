<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { FilterOperator, Label, SpaceSummary, TaskFilterField, TaskListFilters, UserRef } from '~/types/api'
import { PRIORITIES, TASK_STATUSES } from '~/types/api'
import { statusStyle } from '~/utils/taskStatus'
import { avatarStyle } from '~/utils/userColor'
import { CHIP_OPERATORS, OPERATOR_LABELS, chipIsActive, chipQuery, chipValues, operatorOf, takesValues } from '~/utils/taskFilterChips'

// Filter chips (specs/dynamic-task-filters.md, client 2026-10-31): "+ Filter" picks a field, then its
// values; each chip reads "Field · operator · values · ×". Values of a chip are OR, chips are AND.
// A chosen field without values yet is kept locally (`pending`) and filters nothing until a value
// or an "empty" operator is chosen; everything else lives in the URL.
const props = defineProps<{
  filters: TaskListFilters
  /** Label chip, offered when the list has one Space */
  labels?: Label[]
  /** Space chip (All Tasks) */
  spaces?: SpaceSummary[]
  owners?: UserRef[]
  assignees?: UserRef[]
}>()
const emit = defineEmits<{ set: [patch: Record<string, string | null | undefined>] }>()

// Each field keeps one colour (themes.css, --masar-filter-*) in the menu and on its chip.
const FIELDS: Record<TaskFilterField, { label: string, icon: string, tone: string }> = {
  status: { label: 'Status', icon: 'i-lucide-circle-dot', tone: 'text-filter-status' },
  assignee: { label: 'Assignee', icon: 'i-lucide-users', tone: 'text-filter-assignee' },
  owner: { label: 'Owner', icon: 'i-lucide-crown', tone: 'text-filter-owner' },
  priority: { label: 'Priority', icon: 'i-lucide-flag', tone: 'text-filter-priority' },
  label: { label: 'Label', icon: 'i-lucide-tag', tone: 'text-filter-label' },
  space: { label: 'Space', icon: 'i-lucide-layout-grid', tone: 'text-filter-space' }
}

const personItems = (people: UserRef[] | undefined) => (people ?? []).map(person => ({
  label: person.fullName,
  value: person.name,
  avatar: { src: person.image ?? undefined, alt: person.fullName, class: person.image ? undefined : 'masar-avatar', style: person.image ? undefined : avatarStyle(person.name) }
}))
const valueItems = computed<Record<TaskFilterField, Array<{ label: string, value: string } & Record<string, unknown>>>>(() => ({
  status: TASK_STATUSES.map(status => ({ label: status, value: status, icon: statusStyle(status).icon, ui: { itemLeadingIcon: statusStyle(status).text } })),
  assignee: personItems(props.assignees),
  owner: personItems(props.owners),
  priority: PRIORITIES.map(priority => ({ label: priority, value: priority })),
  label: (props.labels ?? []).map(label => ({ label: label.title, value: label.name, chip: { color: label.color } })),
  space: (props.spaces ?? []).map(space => ({ label: space.title, value: space.name }))
}))

const available = computed(() => (Object.keys(FIELDS) as TaskFilterField[]).filter(field => ({
  status: true,
  assignee: !!props.assignees,
  owner: !!props.owners,
  priority: true,
  label: !!props.labels,
  space: !!props.spaces
})[field]))

const pending = ref<TaskFilterField[]>([])
const shown = computed(() => available.value.filter(field => chipIsActive(props.filters, field) || pending.value.includes(field)))
const valuesOpen = reactive<Partial<Record<TaskFilterField, boolean>>>({})

const addItems = computed<DropdownMenuItem[]>(() => available.value.map(field => ({
  label: FIELDS[field].label,
  icon: FIELDS[field].icon,
  ui: { itemLeadingIcon: FIELDS[field].tone },
  // A field that already has a chip opens that chip instead of adding a second one.
  onSelect: () => openChip(field)
})))

// Mobile freeze fix (client revision 6, R6): the values picker used to open on the next tick while the
// field or operator menu was still closing. A modal menu locks the page (pointer events, scroll, iOS
// touchmove) until its close animation ends, and on iOS that lock could stay, so nothing responded.
// The menus are non-modal now, and the picker opens only once the menu reports it closed, without the
// menu handing focus back to its button.
const openAfterMenu = ref<TaskFilterField | null>(null)
let keepFocus = false
function onMenuOpen(open: boolean) {
  const field = openAfterMenu.value
  if (open || !field) return
  openAfterMenu.value = null
  void nextTick(() => { valuesOpen[field] = true })
}
const menuContent = {
  align: 'start' as const,
  onCloseAutoFocus: (event: Event) => {
    if (keepFocus) event.preventDefault()
    keepFocus = false
  }
}
function openValuesAfterMenu(field: TaskFilterField) {
  openAfterMenu.value = field
  keepFocus = true
}

function openChip(field: TaskFilterField) {
  if (!pending.value.includes(field)) pending.value.push(field)
  if (takesValues(operatorOf(props.filters, field))) openValuesAfterMenu(field)
}

function setChip(field: TaskFilterField, operator: FilterOperator, values: string[]) {
  // Labels and Features belong to one Space; a different Space choice clears them.
  const scoped = field === 'space' ? { label: null, label_op: null, feature: null, release: null } : {}
  emit('set', { ...chipQuery(field, operator, values), ...scoped })
}

function setOperator(field: TaskFilterField, operator: FilterOperator) {
  setChip(field, operator, takesValues(operator) ? chipValues(props.filters, field) : [])
  if (takesValues(operator) && !chipValues(props.filters, field).length) openValuesAfterMenu(field)
}

function removeChip(field: TaskFilterField) {
  pending.value = pending.value.filter(f => f !== field)
  setChip(field, 'is', [])
}

const operatorItems = (field: TaskFilterField): DropdownMenuItem[] => CHIP_OPERATORS[field].map(operator => ({
  label: OPERATOR_LABELS[operator],
  type: 'checkbox' as const,
  checked: operatorOf(props.filters, field) === operator,
  onSelect: () => setOperator(field, operator)
}))

function valueText(field: TaskFilterField) {
  const chosen = chipValues(props.filters, field)
  if (!chosen.length) return 'Choose…'
  return valueItems.value[field].filter(item => chosen.includes(item.value)).map(item => item.label).join(', ') || chosen.join(', ')
}

/** Called by the filter bar's "Clear filters". */
defineExpose({ reset: () => { pending.value = [] } })
</script>

<template>
  <div
    v-for="field in shown"
    :key="field"
    role="group"
    :aria-label="`${FIELDS[field].label} filter`"
    class="inline-flex h-8 max-w-full items-center rounded-pill border border-default bg-default text-sm"
  >
    <span class="flex shrink-0 items-center gap-1.5 ps-3 pe-1 font-medium text-highlighted">
      <UIcon :name="FIELDS[field].icon" class="size-4" :class="FIELDS[field].tone" />
      {{ FIELDS[field].label }}
    </span>
    <UDropdownMenu v-if="CHIP_OPERATORS[field].length > 1" :items="operatorItems(field)" :modal="false" :content="menuContent" @update:open="onMenuOpen">
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        class="shrink-0 text-muted"
        trailing-icon="i-lucide-chevron-down"
        :label="OPERATOR_LABELS[operatorOf(filters, field)]"
        :aria-label="`${FIELDS[field].label} operator: ${OPERATOR_LABELS[operatorOf(filters, field)]}`"
      />
    </UDropdownMenu>
    <span v-else class="shrink-0 px-1 text-muted">is</span>
    <USelectMenu
      v-if="takesValues(operatorOf(filters, field))"
      v-model:open="valuesOpen[field]"
      :model-value="chipValues(filters, field)"
      :items="valueItems[field]"
      value-key="value"
      multiple
      variant="none"
      size="sm"
      class="min-w-0"
      :search-input="valueItems[field].length > 8 ? { placeholder: `Find ${FIELDS[field].label.toLowerCase()}` } : false"
      :aria-label="`${FIELDS[field].label} values: ${valueText(field)}`"
      @update:model-value="(values: string[]) => setChip(field, operatorOf(filters, field), values)"
    >
      <template #default>
        <span class="max-w-48 truncate" :class="chipValues(filters, field).length ? 'text-highlighted' : 'text-dimmed'">{{ valueText(field) }}</span>
      </template>
    </USelectMenu>
    <UButton
      icon="i-lucide-x"
      size="sm"
      color="neutral"
      variant="link"
      class="me-1 shrink-0 p-1"
      :aria-label="`Remove ${FIELDS[field].label} filter`"
      @click="removeChip(field)"
    />
  </div>
  <UDropdownMenu :items="addItems" :modal="false" :content="menuContent" @update:open="onMenuOpen">
    <UButton color="neutral" variant="outline" icon="i-lucide-list-filter" label="Filter" aria-label="Add filter" :ui="{ leadingIcon: 'text-filter-add' }" />
  </UDropdownMenu>
</template>
