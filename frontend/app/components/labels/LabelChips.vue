<script setup lang="ts">
import type { LabelRef } from '~/types/api'

defineProps<{ labels: LabelRef[], max?: number, size?: 'sm' | 'md' }>()
</script>

<template>
  <span v-if="labels.length" class="flex min-w-0 items-center gap-1">
    <UBadge
      v-for="label in labels.slice(0, max ?? labels.length)"
      :key="label.name"
      :color="label.color"
      variant="soft"
      :size="size ?? 'sm'"
      :label="label.title"
      class="max-w-32 truncate"
    />
    <UBadge v-if="max && labels.length > max" color="neutral" variant="outline" :size="size ?? 'sm'" :label="`+${labels.length - max}`" />
  </span>
</template>
