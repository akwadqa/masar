<script setup lang="ts">
import type { SpaceDetail } from '~/types/api'

defineProps<{ space: SpaceDetail }>()
</script>

<template>
  <!-- Phones: natural height, so the page (panel body) is the one scroll; wider screens fill the panel. -->
  <div class="flex flex-col page-scroll:grow list-scroll:h-full list-scroll:min-h-0">
    <UAlert
      v-if="space.status !== 'In Progress'"
      :color="space.status === 'Closed' ? 'neutral' : 'warning'"
      variant="subtle"
      :icon="space.status === 'Closed' ? 'i-lucide-archive' : 'i-lucide-lock'"
      :title="space.status === 'Closed' ? 'This Space is closed. Its tasks are read-only.' : `This Space is ${space.status.toLowerCase()}.`"
      :description="space.status === 'Closed' ? 'A Manager can reopen the Space from its Settings.' : (space.permissions.canEditTasks ? 'As a Manager you can still wrap up tasks.' : 'Tasks are read-only for Members.')"
      class="rounded-none border-b border-default"
    />
    <TaskListView :space="space" class="page-scroll:grow list-scroll:min-h-0 list-scroll:flex-1" />
  </div>
</template>
