<script setup lang="ts">
import type { SpaceDetail } from '~/types/api'
import { formatLongDate } from '~/utils/format'

// Active Batches holding this Space's tasks; progress counts this Space's tasks only (ADR-048).
const props = defineProps<{ space: SpaceDetail }>()
const { data: batches, status, error, refresh } = useBatchList(() => ({ status: 'Active', space: props.space.name }))
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div v-if="status === 'pending' && !batches?.items.length" class="grid gap-3 p-4 sm:grid-cols-2 sm:p-6">
      <USkeleton v-for="i in 2" :key="i" class="h-32" />
    </div>
    <StatePanel v-else-if="error && !batches?.items.length" tone="error" icon="i-lucide-cloud-off" title="Batches could not be loaded" :description="error.message">
      <UButton label="Try again" @click="refresh()" />
    </StatePanel>
    <StatePanel
      v-else-if="!batches?.items.length"
      icon="i-lucide-calendar-range"
      title="No active Batches"
      description="When a Batch holding this Space's tasks is started, it appears here."
    >
      <UButton to="/batches" color="neutral" variant="outline" label="Open Batches" />
      <UButton :to="`/tasks?group=batch&spaces=${space.name}`" color="neutral" variant="ghost" label="Task List by Batch" />
    </StatePanel>
    <div v-else class="grid gap-3 p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
      <ULink
        v-for="batch in batches.items"
        :key="batch.name"
        :to="`/batches/${batch.name}`"
        class="block rounded-lg border border-default p-4 transition hover:border-accented focus-visible:ring-2 focus-visible:ring-primary"
        :aria-label="`${batch.batchName}, active, ${batch.progress.completed} of ${batch.progress.total} of this Space's tasks completed`"
      >
        <div class="flex items-start gap-2">
          <p class="min-w-0 flex-1 font-semibold text-highlighted">{{ batch.batchName }}</p>
          <BatchStatusBadge :status="batch.status" size="sm" />
        </div>
        <p class="mt-1 text-sm tabular-nums text-muted">{{ formatLongDate(batch.startDate) }} – {{ formatLongDate(batch.endDate) }}</p>
        <p class="mt-3 text-xs text-muted">This Space's tasks</p>
        <BatchProgress :progress="batch.progress" compact />
      </ULink>
    </div>
  </div>
</template>
