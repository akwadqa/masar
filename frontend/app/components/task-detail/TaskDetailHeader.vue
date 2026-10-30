<script setup lang="ts">
import type { TaskDetail } from '~/types/api'

// Top bar of Task details: the Space, people (slot), link copy, open as page, delete and close.
const props = defineProps<{ task: TaskDetail, mode: 'panel' | 'page' }>()
const emit = defineEmits<{ delete: [], close: [] }>()
const space = useSpaceLookup()(props.task.space)

const copyLink = useCopyLink()
</script>

<template>
  <header class="flex items-center gap-1.5 border-b border-default px-5 py-2.5">
    <!-- min-w-7 (QA-D09): never narrower than the Space icon (size-5) and its end padding, so the icon cannot slide under the Feature button. -->
    <NuxtLink :to="`/spaces/${task.space}/tasks`" class="flex min-w-7 items-center gap-2 rounded-pill py-1 pe-2 text-sm text-muted hover:text-highlighted">
      <SpaceIcon :space="space ?? { name: task.space }" size="sm" />
      <span class="min-w-0 max-w-48 truncate">{{ task.spaceTitle }}</span>
    </NuxtLink>
    <div class="ms-auto flex items-center gap-1">
      <slot name="people" />
      <UTooltip text="Copy link">
        <UButton icon="i-lucide-link" color="neutral" variant="ghost" square aria-label="Copy link" @click="copyLink(`/tasks/${task.name}`)" />
      </UTooltip>
      <UTooltip v-if="mode === 'panel'" text="Open as page">
        <UButton icon="i-lucide-maximize-2" color="neutral" variant="ghost" square aria-label="Open as page" :to="`/tasks/${task.name}`" />
      </UTooltip>
      <UTooltip v-if="task.permissions.canDelete" text="Delete task">
        <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" square aria-label="Delete task" @click="emit('delete')" />
      </UTooltip>
      <UButton v-if="mode === 'panel'" icon="i-lucide-x" color="neutral" variant="ghost" square aria-label="Close panel" @click="emit('close')" />
    </div>
  </header>
</template>
