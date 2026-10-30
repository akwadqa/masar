<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { BulkOperation, TaskListRow } from '~/types/api'
import { MANUAL_STATUSES, PRIORITIES } from '~/types/api'
import { statusStyle } from '~/utils/taskStatus'
import type { MasarApiError } from '~/utils/apiError'

// Contextual bulk actions for the selected tasks. The server applies a change to all selected
// tasks or to none (ADR-031); label and assignee changes need a single Space. Batches are planned
// on the planning board only (client revision 3).
const props = defineProps<{ tasks: TaskListRow[], total: number }>()
const emit = defineEmits<{ clear: [], selectAll: [] }>()

const { bulk } = useTaskMutations()
const toast = useToast()

const singleSpace = computed(() => {
  const spaces = new Set(props.tasks.map(t => t.space))
  return spaces.size === 1 ? [...spaces][0]! : null
})
const { data: labels } = useSpaceLabels(singleSpace)
const { data: members } = useSpaceMembers(singleSpace)
const { data: features } = useFeatures(singleSpace)
const { data: releases } = useReleases(singleSpace)

async function run(operation: BulkOperation, value: unknown, label: string) {
  try {
    const result = await bulk.execute({ tasks: props.tasks, operation, value })
    toast.add({
      title: label,
      description: `${result.changed.length} of ${props.tasks.length} tasks changed.`,
      color: 'success',
      icon: 'i-lucide-check'
    })
  } catch (caught) {
    if ((caught as MasarApiError).kind === 'conflict') {
      toast.add({ title: 'Some selected tasks were changed by someone else', description: 'The list was refreshed. Review and try again.', color: 'warning', icon: 'i-lucide-git-compare' })
      await invalidateQueries('tasks:')
    }
  }
}

const statusItems = computed<DropdownMenuItem[]>(() => MANUAL_STATUSES.map(status => ({
  label: status,
  icon: statusStyle(status).icon,
  ui: { itemLeadingIcon: statusStyle(status).text },
  onSelect: () => run('set_status', status, `Status set to ${status}`)
})))
const priorityItems = computed<DropdownMenuItem[]>(() => PRIORITIES.map(p => ({ label: p, onSelect: () => run('priority', p, `Priority set to ${p}`) })))
const labelItems = computed<DropdownMenuItem[][]>(() => [
  (labels.value ?? []).map(l => ({ label: `Add “${l.title}”`, chip: { color: l.color }, onSelect: () => run('add_label', l.name, `Label ${l.title} added`) })),
  (labels.value ?? []).map(l => ({ label: `Remove “${l.title}”`, onSelect: () => run('remove_label', l.name, `Label ${l.title} removed`) }))
])
const assignItems = computed<DropdownMenuItem[][]>(() => [
  (members.value ?? []).map(m => ({ label: `Assign ${m.fullName}`, avatar: { src: m.image ?? undefined, alt: m.fullName }, onSelect: () => run('add_assignee', m.name, `${m.fullName} assigned`) })),
  (members.value ?? []).map(m => ({ label: `Unassign ${m.fullName}`, onSelect: () => run('remove_assignee', m.name, `${m.fullName} unassigned`) }))
])
const featureItems = computed<DropdownMenuItem[][]>(() => [
  (features.value?.items ?? []).map(f => ({ label: f.title, suffix: f.roadmap, onSelect: () => run('set_feature', f.name, `Feature set to ${f.title}`) })),
  [{ label: 'Remove from Feature', icon: 'i-lucide-x', onSelect: () => run('set_feature', null, 'Removed from Feature') }]
])
// Archived Releases accept no tasks (ADR-036).
const releaseItems = computed<DropdownMenuItem[][]>(() => [
  (releases.value?.items ?? []).filter(r => r.status !== 'Archived').map(r => ({ label: r.releaseName, suffix: r.status, onSelect: () => run('set_release', r.name, `Release set to ${r.releaseName}`) })),
  [{ label: 'Remove from Release', icon: 'i-lucide-x', onSelect: () => run('set_release', null, 'Removed from Release') }]
])
</script>

<template>
  <div
    v-if="tasks.length"
    class="flex flex-wrap items-center gap-3 border-b border-default bg-primary/5 px-4 py-3 sm:px-5"
    role="toolbar"
    aria-label="Bulk actions for selected tasks"
  >
    <span class="text-sm font-medium text-highlighted" aria-live="polite">{{ tasks.length }} selected</span>
    <UButton v-if="tasks.length < total" size="xs" variant="link" color="neutral" :label="`Select all ${total}`" @click="emit('selectAll')" />
    <USeparator orientation="vertical" class="h-5" />
    <UDropdownMenu :items="statusItems">
      <UButton color="neutral" variant="outline" icon="i-lucide-circle-dot" label="Status" trailing-icon="i-lucide-chevron-down" :loading="bulk.pending.value" />
    </UDropdownMenu>
    <UDropdownMenu :items="priorityItems">
      <UButton color="neutral" variant="outline" icon="i-lucide-signal" label="Priority" trailing-icon="i-lucide-chevron-down" />
    </UDropdownMenu>
    <template v-if="singleSpace">
      <UDropdownMenu :items="labelItems" :content="{ align: 'start' }" :ui="{ content: 'max-h-80' }">
        <UButton color="neutral" variant="outline" icon="i-lucide-tag" label="Labels" trailing-icon="i-lucide-chevron-down" :disabled="!labels?.length" />
      </UDropdownMenu>
      <UDropdownMenu :items="featureItems" :content="{ align: 'start' }" :ui="{ content: 'max-h-80' }">
        <UButton color="neutral" variant="outline" icon="i-lucide-map" label="Feature" trailing-icon="i-lucide-chevron-down" />
      </UDropdownMenu>
      <UDropdownMenu :items="releaseItems" :content="{ align: 'start' }" :ui="{ content: 'max-h-80' }">
        <UButton color="neutral" variant="outline" icon="i-lucide-package" label="Release" trailing-icon="i-lucide-chevron-down" />
      </UDropdownMenu>
      <UDropdownMenu :items="assignItems" :content="{ align: 'start' }" :ui="{ content: 'max-h-80' }">
        <UButton color="neutral" variant="outline" icon="i-lucide-user-plus" label="Assign" trailing-icon="i-lucide-chevron-down" />
      </UDropdownMenu>
    </template>
    <UTooltip v-else text="Select tasks of a single Space to change labels, Features, Releases or assignees">
      <span class="text-sm text-muted">Labels, Features, Releases and assignees: one Space at a time</span>
    </UTooltip>
    <UButton class="ms-auto" color="neutral" variant="ghost" icon="i-lucide-x" label="Clear" @click="emit('clear')" />
  </div>
</template>
