<script setup lang="ts">
import type { TaskStatus } from '~/types/api'
import { statusStyle } from '~/utils/taskStatus'

// One status label for lists, menus and Task details: icon, colour and the status name.
// `md` matches the height of the property chips in Task details.
const props = defineProps<{ status: TaskStatus, trailingIcon?: string, size?: 'sm' | 'md' }>()
const style = computed(() => statusStyle(props.status))
</script>

<template>
  <span
    class="inline-flex max-w-full items-center gap-1.5 rounded-pill font-medium whitespace-nowrap"
    :class="[style.tint, style.text, size === 'md' ? 'h-9 px-3 text-sm' : 'h-7 px-2.5 text-xs']"
  >
    <UIcon :name="style.icon" class="size-3.5 shrink-0" />
    <span class="truncate">{{ status }}</span>
    <UIcon v-if="trailingIcon" :name="trailingIcon" class="size-3.5 shrink-0 opacity-70" />
  </span>
</template>
