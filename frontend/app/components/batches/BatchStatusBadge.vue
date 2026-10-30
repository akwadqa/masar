<script setup lang="ts">
import type { BatchStatus } from '~/types/api'

defineProps<{ status: BatchStatus, size?: 'sm' | 'md' }>()
const styles: Record<BatchStatus, { color: 'info' | 'success' | 'neutral', icon: string }> = {
  Planned: { color: 'info', icon: 'i-lucide-calendar-clock' },
  Active: { color: 'success', icon: 'i-lucide-play' },
  Finished: { color: 'neutral', icon: 'i-lucide-flag' }
}
</script>

<template>
  <UBadge :color="styles[status].color" variant="subtle" :icon="styles[status].icon" :label="status" :size="size ?? 'md'" />
</template>
