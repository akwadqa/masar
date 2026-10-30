<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { TaskStatus } from '~/types/api'
import { MANUAL_STATUSES } from '~/types/api'
import { statusStyle } from '~/utils/taskStatus'

// Status control (client revision 2): people choose any status except Overdue, which Masar sets
// once the due date has passed. Read-only users see the same label without a menu.
const props = defineProps<{ status: TaskStatus, title: string, editable?: boolean, size?: 'sm' | 'md' }>()
const emit = defineEmits<{ change: [status: TaskStatus] }>()

const items = computed<DropdownMenuItem[]>(() => MANUAL_STATUSES.map(status => ({
  label: status,
  icon: statusStyle(status).icon,
  class: status === props.status ? 'font-semibold' : '',
  ui: { itemLeadingIcon: statusStyle(status).text },
  onSelect: () => emit('change', status)
})))
</script>

<template>
  <UDropdownMenu v-if="editable" :items="items" :content="{ align: 'start' }">
    <button
      type="button"
      class="max-w-full rounded-pill focus-visible:outline-2 focus-visible:outline-primary"
      :aria-label="`Status: ${status}. Change status of ${title}`"
      @click.stop
    >
      <TaskStatusPill :status="status" :size="size" trailing-icon="i-lucide-chevron-down" />
    </button>
  </UDropdownMenu>
  <span v-else :aria-label="`Status: ${status}`"><TaskStatusPill :status="status" :size="size" /></span>
</template>
