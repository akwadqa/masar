<script setup lang="ts">
import type { BatchDetail } from '~/types/api'
import { formatDateTime, formatLongDate } from '~/utils/format'

// Batch header (client revision 3): three labelled facts in one even row (dates, owner, progress),
// each with an icon, a quiet label and a clear value, and one line of history below.
const props = defineProps<{ batch: BatchDetail }>()
const percent = computed(() => props.batch.progress.percent ?? 0)
const finished = computed(() => props.batch.status === 'Finished')
const history = computed(() => {
  const b = props.batch
  const parts: string[] = []
  if (b.startedAt) parts.push(`Started ${formatDateTime(b.startedAt)}${b.startedBy ? ` by ${b.startedBy.fullName}` : ''}`)
  if (b.finishedAt) parts.push(`Finished ${formatDateTime(b.finishedAt)}${b.finishedBy ? ` by ${b.finishedBy.fullName}` : ''}`)
  if (b.progress.addedAfterStart) parts.push(`${b.progress.addedAfterStart} added after start`)
  if (b.progress.removed) parts.push(`${b.progress.removed} removed during the Batch`)
  return parts
})
</script>

<template>
  <div class="space-y-3">
    <dl class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.4fr)]">
      <div class="relative rounded-card bg-elevated/60 py-3 ps-12 pe-4">
        <dt class="text-xs text-muted">
          <UIcon name="i-lucide-calendar-range" class="absolute start-4 top-3.5 size-5 text-muted" />Dates
        </dt>
        <dd class="text-base font-medium tabular-nums text-highlighted">{{ formatLongDate(batch.startDate) }} – {{ formatLongDate(batch.endDate) }}</dd>
        <dd class="text-xs text-muted">{{ batch.durationDays }} days</dd>
      </div>
      <div class="relative rounded-card bg-elevated/60 py-3 ps-14 pe-4">
        <dt class="text-xs text-muted">
          <UserAvatar :user="batch.owner" size="sm" class="absolute start-4 top-3.5" />Owner
        </dt>
        <dd class="truncate text-base font-medium text-highlighted">{{ batch.isOwner ? 'You' : batch.owner.fullName }}</dd>
      </div>
      <div class="relative rounded-card bg-elevated/60 py-3 ps-12 pe-4">
        <dt class="text-xs text-muted">
          <UIcon name="i-lucide-chart-no-axes-column-increasing" class="absolute start-4 top-3.5 size-5 text-muted" />{{ finished ? 'Result for your Spaces' : 'Your tasks' }}
        </dt>
        <dd v-if="batch.progress.total" class="space-y-1.5">
          <p class="text-base font-medium text-highlighted">
            <span class="tabular-nums">{{ batch.progress.completed }}</span> of <span class="tabular-nums">{{ batch.progress.total }}</span> done
            <span class="ms-1 text-sm font-normal tabular-nums text-muted">{{ percent }}%</span>
          </p>
          <UProgress
            :model-value="percent"
            size="sm"
            :color="batch.progress.open ? 'primary' : 'success'"
            :aria-label="`${batch.progress.completed} of ${batch.progress.total} of your tasks completed`"
          />
        </dd>
        <dd v-else class="text-sm text-muted">No tasks you can see</dd>
      </div>
    </dl>
    <p v-if="history.length || batch.finishDestination" class="flex flex-wrap gap-x-2 text-xs text-muted">
      <template v-for="(part, index) in history" :key="part">
        <span v-if="index" aria-hidden="true">·</span>
        <span>{{ part }}</span>
      </template>
      <template v-if="batch.finishDestination">
        <span v-if="history.length" aria-hidden="true">·</span>
        <span>Unfinished work moved to <ULink :to="`/batches/${batch.finishDestination.name}`" class="text-primary underline underline-offset-2">{{ batch.finishDestination.batchName }}</ULink></span>
      </template>
    </p>
  </div>
</template>
