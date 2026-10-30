<script setup lang="ts">
import { parseDate, type CalendarDate } from '@internationalized/date'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { TaskDetail } from '~/types/api'
import { PRIORITIES } from '~/types/api'
import { formatDueDate } from '~/utils/format'
import type { TaskEditor } from '~/composables/workspace/useTaskEditor'

// Task properties as compact chips, status first (client revision 2): each opens a small menu or
// popover. Feature and Release are icons in the Task header; Batches are planned only by dragging
// on the planning board, so a Batch is shown here as a read-only link (client revision 3).
const props = defineProps<{ task: TaskDetail, editor: TaskEditor }>()
const editable = computed(() => props.editor.editable.value)

const CHIP = 'rounded-pill'
const chipUi = { base: `${CHIP} min-h-9`, trailingIcon: 'hidden' }

const priorityItems = computed<DropdownMenuItem[]>(() => PRIORITIES.map(priority => ({
  label: priority,
  checked: props.task.priority === priority,
  type: 'checkbox' as const,
  onSelect: () => props.editor.save({ priority })
})))

const dueOpen = ref(false)
const dueDate = computed<CalendarDate | undefined>({
  get: () => (props.task.dueDate ? parseDate(props.task.dueDate) : undefined),
  set: (value) => {
    dueOpen.value = false
    void props.editor.save({ dueDate: value ? value.toString() : null })
  }
})
const overdue = computed(() => props.task.status === 'Overdue')

</script>

<template>
  <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Task properties">
    <TaskStatusMenu :status="task.status" :title="task.title" :editable="editable" size="md" @change="(status) => editor.save({ status })" />
    <UDropdownMenu :items="priorityItems" :disabled="!editable">
      <UButton color="neutral" variant="soft" size="md" :class="CHIP" :disabled="!editable" :aria-label="`Priority: ${task.priority}`">
        <TaskPriority :priority="task.priority" />
      </UButton>
    </UDropdownMenu>

    <UPopover v-model:open="dueOpen" :disabled="!editable">
      <UButton
        color="neutral"
        variant="soft"
        size="md"
        icon="i-lucide-calendar"
        :class="[CHIP, overdue ? 'text-overdue' : '']"
        :disabled="!editable"
        :label="task.dueDate ? `${overdue ? 'Overdue · ' : 'Due '}${formatDueDate(task.dueDate)}` : 'Due date'"
        :aria-label="task.dueDate ? `Due date: ${formatDueDate(task.dueDate)}${overdue ? ', overdue' : ''}` : 'Set due date'"
      />
      <template #content>
        <div class="p-2">
          <UCalendar v-model="dueDate" />
          <UButton v-if="task.dueDate" block color="neutral" variant="ghost" size="md" label="Clear due date" @click="dueDate = undefined" />
        </div>
      </template>
    </UPopover>

    <!-- max-w-full (QA-D11): a long Sprint name ends in an ellipsis instead of running past a phone screen. -->
    <UButton
      v-if="task.batch"
      :to="`/sprints/${task.batch.name}`"
      color="neutral"
      variant="soft"
      size="md"
      icon="i-lucide-calendar-range"
      trailing-icon="i-lucide-arrow-up-right"
      :class="[CHIP, 'max-w-full']"
      :label="task.batch.title"
      :aria-label="`Sprint: ${task.batch.title}. Open the Sprint`"
      data-testid="task-batch"
    />

    <LabelPicker
      :space="task.space"
      :selected="task.labels"
      :disabled="!editable"
      variant="soft"
      size="md"
      icon="i-lucide-tag"
      :ui="chipUi"
      class="!w-auto max-w-full"
      @add="(label) => editor.mutations.addLabel.execute({ task, label }).catch(() => editor.refresh())"
      @remove="(label) => editor.mutations.removeLabel.execute({ task, label }).catch(() => editor.refresh())"
    />
  </div>
</template>
