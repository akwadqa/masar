<script setup lang="ts">
import type { ReleaseStatus } from '~/types/api'

defineProps<{ status: ReleaseStatus, size?: 'sm' | 'md' }>()
const styles: Record<ReleaseStatus, { color: 'info' | 'success' | 'neutral', icon: string }> = {
  Planned: { color: 'info', icon: 'i-lucide-calendar-clock' },
  Released: { color: 'success', icon: 'i-lucide-rocket' },
  Archived: { color: 'neutral', icon: 'i-lucide-archive' }
}
</script>

<template>
  <UBadge :color="styles[status].color" variant="subtle" :icon="styles[status].icon" :label="status" :size="size ?? 'md'" />
</template>
