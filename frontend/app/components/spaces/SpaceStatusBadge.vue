<script setup lang="ts">
import type { SpaceStatus } from '~/types/api'

const props = defineProps<{ status: SpaceStatus, size?: 'sm' | 'md' }>()

const tone: Record<SpaceStatus, { color: 'primary' | 'success' | 'neutral' | 'warning', icon: string }> = {
  'In Progress': { color: 'primary', icon: 'i-lucide-circle-dot' },
  'Completed': { color: 'success', icon: 'i-lucide-circle-check' },
  'Cancelled': { color: 'warning', icon: 'i-lucide-circle-slash' },
  'Closed': { color: 'neutral', icon: 'i-lucide-archive' }
}
const style = computed(() => tone[props.status])
</script>

<template>
  <UBadge :color="style.color" variant="subtle" :size="size ?? 'md'" :icon="style.icon" :label="status" />
</template>
