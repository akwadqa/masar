<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { BatchDetail, BatchHistoryRow, BatchOutcome } from '~/types/api'

// Participation records of the viewer's Spaces; results are as frozen at finish (ADR-049).
const props = defineProps<{ batch: BatchDetail }>()
const { data: rows, status, error, refresh } = useBatchHistory(() => props.batch.name)
const finished = computed(() => props.batch.status === 'Finished')
const visibleRows = computed(() => (rows.value ?? []).filter(r => finished.value || r.outcome === 'Removed'))
const outcomeColor: Record<BatchOutcome, 'success' | 'info' | 'neutral' | 'warning'> = {
  'Open': 'info', 'Completed': 'success', 'Carried Over': 'info', 'Returned': 'neutral', 'Removed': 'warning'
}
const columns: TableColumn<BatchHistoryRow>[] = [
  { id: 'task', header: 'Task' },
  { id: 'space', header: 'Space' },
  { accessorKey: 'outcome', header: 'Outcome' },
  { id: 'scope', header: 'Scope' }
]
</script>

<template>
  <div class="min-h-0 flex-1 overflow-auto">
    <StatePanel v-if="error" tone="error" icon="i-lucide-cloud-off" title="History could not be loaded" :description="error.message">
      <UButton label="Try again" @click="refresh()" />
    </StatePanel>
    <StatePanel
      v-else-if="status !== 'pending' && !visibleRows.length"
      icon="i-lucide-history"
      :title="finished ? 'No tasks from your Spaces took part' : 'No task left this Batch yet'"
    />
    <UTable v-else :data="visibleRows" :columns="columns" :loading="status === 'pending'" class="min-w-[40rem]" :ui="{ td: 'py-2', th: 'py-2' }">
      <template #task-cell="{ row }">
        <ULink v-if="row.original.task" :to="`/tasks/${row.original.task.name}`" class="font-medium text-highlighted hover:underline">{{ row.original.task.title }}</ULink>
        <span v-else class="italic text-muted">Deleted task</span>
      </template>
      <template #space-cell="{ row }">
        <span class="text-muted">{{ row.original.task?.spaceTitle ?? '—' }}</span>
      </template>
      <template #outcome-cell="{ row }">
        <div class="flex flex-wrap items-center gap-1.5">
          <UBadge :color="outcomeColor[row.original.outcome]" variant="subtle" size="sm" :label="row.original.outcome" />
          <ULink v-if="row.original.carriedTo" :to="`/batches/${row.original.carriedTo.name}`" class="text-xs text-primary">→ {{ row.original.carriedTo.batchName }}</ULink>
          <span v-if="row.original.completedAtFinish === false && row.original.outcome !== 'Removed'" class="text-xs text-muted">open at finish</span>
        </div>
      </template>
      <template #scope-cell="{ row }">
        <span class="text-xs text-muted">
          {{ row.original.addedAfterStart ? 'Added after start' : (row.original.carriedFrom ? `From ${row.original.carriedFrom.batchName}` : 'Planned') }}
        </span>
      </template>
    </UTable>
  </div>
</template>
