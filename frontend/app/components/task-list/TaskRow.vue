<script setup lang="ts">
import type { TaskListRow, TaskStatus } from '~/types/api'
import { formatDueDate } from '~/utils/format'
import { TASK_GRID, TASK_GRID_NO_DUE } from '~/utils/taskGrid'

const props = defineProps<{
  task: TaskListRow
  focused: boolean
  active: boolean
  canEdit?: boolean
  selected?: boolean
  expanded?: boolean
  /** Alternate rows get the theme's zebra surface. */
  striped?: boolean
  /** All Tasks hides the due column (client revision 2). */
  showDue?: boolean
}>()
const emit = defineEmits<{
  open: []
  status: [status: TaskStatus]
  focus: []
  select: [range: boolean]
  expand: []
  attribute: [field: 'isImportant' | 'isMyDay']
}>()

const space = useSpaceLookup()(props.task.space)
const spaceTitle = computed(() => props.task.spaceTitle || space?.title || '')
const overdue = computed(() => props.task.status === 'Overdue')
const editable = computed(() => props.canEdit !== false)
const revealOnHover = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100'
const rowSurface = computed(() => {
  if (props.active || props.selected) return 'bg-selected'
  return props.striped ? 'bg-zebra hover:bg-elevated/70' : 'bg-default hover:bg-elevated/70'
})
</script>

<template>
  <div
    class="group relative h-12 border-b border-default px-3 text-sm outline-none @2xl:px-5"
    :class="[showDue === false ? TASK_GRID_NO_DUE : TASK_GRID, rowSurface, focused ? 'ring-2 ring-inset ring-primary/60' : '']"
    role="listitem"
    :tabindex="focused ? 0 : -1"
    :aria-current="active ? 'true' : undefined"
    :aria-label="`${task.title}, ${task.status}`"
    :data-task="task.name"
    @click="emit('open')"
    @focus="emit('focus')"
  >
    <span v-if="active" class="absolute inset-y-1 start-0 w-0.5 rounded-full bg-primary" aria-hidden="true" />
    <UCheckbox
      :model-value="!!selected"
      :aria-label="`Select ${task.title}`"
      class="p-1"
      tabindex="-1"
      @click.stop="(event: MouseEvent) => { event.preventDefault(); emit('select', event.shiftKey) }"
    />
    <UButton
      :icon="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
      color="neutral"
      variant="ghost"
      size="xs"
      square
      tabindex="-1"
      :class="task.actionCount ? '' : 'invisible'"
      :aria-label="expanded ? `Hide actions of ${task.title}` : `Show actions of ${task.title}`"
      :aria-expanded="expanded ? 'true' : 'false'"
      @click.stop="emit('expand')"
    />
    <span class="flex min-w-0 items-center gap-2">
      <span class="truncate" :class="task.isCompleted ? 'text-muted' : 'font-medium text-highlighted'">{{ task.title }}</span>
      <!-- Client revision 5: a Task with files shows a paperclip, beside the planning icons. -->
      <span
        v-if="task.attachmentCount"
        class="flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted"
        :title="`${task.attachmentCount} ${task.attachmentCount === 1 ? 'attachment' : 'attachments'}`"
        data-testid="attachment-indicator"
      >
        <UIcon name="i-lucide-paperclip" class="size-3.5 text-dimmed" aria-hidden="true" />
        <span v-if="task.attachmentCount > 1" aria-hidden="true">{{ task.attachmentCount }}</span>
        <span class="sr-only">{{ task.attachmentCount }} {{ task.attachmentCount === 1 ? 'attachment' : 'attachments' }}</span>
      </span>
      <span v-if="task.actionCount" class="hidden shrink-0 text-xs tabular-nums text-muted @3xl:inline">
        {{ task.actionDoneCount }}/{{ task.actionCount }}<span class="sr-only"> actions done</span>
      </span>
      <LabelChips :labels="task.labels" :max="2" class="hidden shrink-0 @3xl:flex" />
      <span v-if="task.feature" class="hidden min-w-0 items-center gap-1 text-xs text-muted @6xl:flex" :aria-label="`Feature: ${task.feature.title}`">
        <UIcon name="i-lucide-map" class="size-3.5 shrink-0 text-dimmed" />
        <span class="truncate">{{ task.feature.title }}</span>
      </span>
      <span v-if="task.release" class="hidden min-w-0 shrink-0 items-center gap-1 text-xs text-muted @5xl:flex" :aria-label="`Release: ${task.release.title}`">
        <UIcon name="i-lucide-package" class="size-3.5 shrink-0" />
        <span class="max-w-28 truncate">{{ task.release.title }}</span>
      </span>
      <span class="ms-auto flex shrink-0 items-center">
        <UButton
          icon="i-lucide-star"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          tabindex="-1"
          :disabled="!editable"
          :class="task.isImportant ? 'text-focus-accent [&_svg]:fill-current' : revealOnHover"
          :aria-label="task.isImportant ? `Unmark ${task.title} as important` : `Mark ${task.title} as important`"
          :aria-pressed="task.isImportant"
          @click.stop="emit('attribute', 'isImportant')"
        />
        <UButton
          icon="i-lucide-sun"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          tabindex="-1"
          :disabled="task.isCompleted && !task.isMyDay"
          :class="task.isMyDay ? 'text-focus-accent' : revealOnHover"
          :aria-label="task.isMyDay ? `Remove ${task.title} from My Day` : `Add ${task.title} to My Day`"
          :aria-pressed="task.isMyDay"
          @click.stop="emit('attribute', 'isMyDay')"
        />
      </span>
    </span>

    <span class="hidden min-w-0 @lg:flex"><TaskStatusMenu :status="task.status" :title="task.title" :editable="editable" @change="(status) => emit('status', status)" /></span>
    <span class="hidden min-w-0 items-center gap-1.5 text-xs text-muted @4xl:flex">
      <SpaceIcon :space="space ?? { name: task.space }" size="xs" />
      <span class="truncate">{{ spaceTitle }}</span>
    </span>
    <span class="hidden @4xl:flex"><TaskPriority :priority="task.priority" /></span>
    <span v-if="showDue !== false" class="text-end text-xs tabular-nums" :class="overdue ? 'font-semibold text-overdue' : 'text-muted'">
      <template v-if="task.dueDate">
        <span v-if="overdue" class="sr-only">Overdue, due </span>{{ formatDueDate(task.dueDate) }}
      </template>
    </span>
    <span class="hidden @2xl:block"><TaskPeople :assignees="task.assignees" :owner="task.taskOwner" /></span>
  </div>
</template>
