<script setup lang="ts">
import type { PlanningProgress } from '~/types/api'

// Progress = completed linked Tasks / all linked Tasks (ADR-035). No Tasks is an empty state, not 0 %.
defineProps<{ progress: PlanningProgress, compact?: boolean }>()
</script>

<template>
  <div v-if="progress.total" class="flex items-center gap-2" :class="compact ? 'text-xs' : 'text-sm'">
    <UProgress
      :model-value="progress.percent ?? 0"
      size="xs"
      :color="progress.open ? 'primary' : 'success'"
      class="flex-1"
      :aria-label="`${progress.completed} of ${progress.total} tasks completed`"
    />
    <span class="shrink-0 tabular-nums text-muted">{{ progress.completed }}/{{ progress.total }}</span>
  </div>
  <p v-else class="text-muted" :class="compact ? 'text-xs' : 'text-sm'">No tasks yet</p>
</template>
