<script setup lang="ts">
import type { UserRef } from '~/types/api'

// The owner and the assignees of a Task, with names, for the first glance (TaskPeoplePicker).
const props = defineProps<{ owner: UserRef | undefined, assignees: UserRef[] }>()

const SHOWN_NAMES = 2
const assigneeNames = computed(() => {
  const names = props.assignees.slice(0, SHOWN_NAMES).map(person => person.fullName).join(', ')
  const more = props.assignees.length - SHOWN_NAMES
  return more > 0 ? `${names} +${more}` : names
})
</script>

<template>
  <span class="flex max-w-full flex-wrap items-center gap-x-5 gap-y-1.5" data-testid="task-people-summary">
    <span class="flex min-w-0 items-center gap-1.5">
      <UIcon name="i-lucide-crown" class="size-3.5 shrink-0 text-muted" aria-hidden="true" />
      <span class="text-muted">Owner</span>
      <template v-if="owner">
        <UserAvatar :user="owner" size="2xs" />
        <span class="truncate font-medium text-highlighted">{{ owner.fullName }}</span>
      </template>
      <span v-else class="text-dimmed">No owner</span>
    </span>
    <span class="flex min-w-0 items-center gap-1.5">
      <UIcon name="i-lucide-users" class="size-3.5 shrink-0 text-muted" aria-hidden="true" />
      <span class="text-muted">Assignees</span>
      <template v-if="assignees.length">
        <UAvatarGroup size="2xs" :max="3">
          <UserAvatar v-for="person in assignees" :key="person.name" :user="person" />
        </UAvatarGroup>
        <span class="truncate text-highlighted" :title="assignees.map(person => person.fullName).join(', ')">{{ assigneeNames }}</span>
      </template>
      <span v-else class="text-dimmed">No one yet</span>
    </span>
  </span>
</template>
