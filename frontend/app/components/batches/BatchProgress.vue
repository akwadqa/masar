<script setup lang="ts">
import type { BatchProgress } from '~/types/api'

// Completed / total of the tasks the viewer may see (ADR-048). Never a global count.
defineProps<{ progress: BatchProgress, compact?: boolean }>()
</script>

<template>
  <div v-if="progress.total" class="flex items-center gap-2" :class="compact ? 'text-xs' : 'text-sm'">
    <UProgress
      :model-value="progress.percent ?? 0"
      size="xs"
      :color="progress.open ? 'primary' : 'success'"
      class="flex-1"
      :aria-label="`${progress.completed} of ${progress.total} of your tasks completed`"
    />
    <span class="shrink-0 tabular-nums text-muted">{{ progress.completed }}/{{ progress.total }}</span>
  </div>
  <p v-else class="text-muted" :class="compact ? 'text-xs' : 'text-sm'">No tasks you can see</p>
</template>
