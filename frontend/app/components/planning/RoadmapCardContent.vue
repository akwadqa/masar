<script setup lang="ts">
import type { Feature, RoadmapColumn, SpaceIconColor } from '~/types/api'
import { SPACE_ICON_COLORS } from '~/types/api'

// Body of a roadmap card: a colour cover, title, progress, task count and the people doing the work.
// Done never completes Tasks, so a Done card with open Tasks says so.
const props = defineProps<{ feature: Feature, column: RoadmapColumn }>()
const cover = computed<SpaceIconColor>(() => {
  let hash = 0
  for (const character of props.feature.name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return SPACE_ICON_COLORS[hash % SPACE_ICON_COLORS.length]!
})
const stillOpen = computed(() => props.column === 'Done' ? props.feature.progress.open : 0)
</script>

<template>
  <div class="flex flex-col gap-2">
    <span class="-mx-3 -mt-3 mb-0.5 h-1.5 rounded-t-[inherit]" :style="{ backgroundColor: `var(--masar-space-${cover})` }" aria-hidden="true" />
    <slot name="title" />
    <PlanningProgress :progress="feature.progress" compact />
    <div class="flex min-h-6 items-center gap-2 text-xs text-muted">
      <span v-if="feature.progress.total" class="inline-flex items-center gap-1">
        <UIcon name="i-lucide-list-checks" class="size-3.5" />
        {{ feature.progress.total }} {{ feature.progress.total === 1 ? 'task' : 'tasks' }}
      </span>
      <TaskPeople v-if="feature.people?.length" :assignees="feature.people" :owner="null" :max="4" class="ms-auto" />
    </div>
    <p v-if="stillOpen" class="flex items-center gap-1.5 rounded-(--ui-radius) bg-overdue-tint px-2 py-1 text-xs font-medium text-overdue">
      <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
      {{ stillOpen }} {{ stillOpen === 1 ? 'task is' : 'tasks are' }} still open
    </p>
  </div>
</template>
