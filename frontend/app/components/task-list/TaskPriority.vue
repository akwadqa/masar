<script setup lang="ts">
import type { Priority } from '~/types/api'

// Priority glyph and word; colour adds emphasis but the word always carries the meaning.
const props = defineProps<{ priority: Priority, compact?: boolean }>()
const styles: Record<Priority, { icon: string, class: string }> = {
  Highest: { icon: 'i-lucide-chevrons-up', class: 'text-error' },
  High: { icon: 'i-lucide-chevron-up', class: 'text-warning' },
  Medium: { icon: 'i-lucide-equal', class: 'text-muted' },
  Low: { icon: 'i-lucide-chevron-down', class: 'text-info' },
  Lowest: { icon: 'i-lucide-chevrons-down', class: 'text-muted' }
}
const style = computed(() => styles[props.priority])
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-1 text-xs font-semibold" :class="style.class">
    <UIcon :name="style.icon" class="size-4 shrink-0" />
    <span :class="compact ? 'sr-only' : 'truncate'">{{ priority }}</span>
  </span>
</template>
