<script setup lang="ts">
// Shared empty / error / not-found presentation so every screen states its situation the same way.
defineProps<{
  icon: string
  title: string
  description?: string
  tone?: 'neutral' | 'error'
}>()
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center" role="status">
    <div
      class="grid size-12 place-items-center rounded-full"
      :class="tone === 'error' ? 'bg-error/10 text-error' : 'bg-elevated text-muted'"
    >
      <UIcon :name="icon" class="size-6" />
    </div>
    <div class="space-y-1">
      <p class="font-medium text-highlighted">{{ title }}</p>
      <p v-if="description" class="max-w-sm text-sm text-muted">{{ description }}</p>
    </div>
    <div v-if="$slots.default" class="mt-2 flex gap-2">
      <slot />
    </div>
  </div>
</template>
