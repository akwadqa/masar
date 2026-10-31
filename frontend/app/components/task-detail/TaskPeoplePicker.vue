<script setup lang="ts">
import type { SpaceMember, UserRef } from '~/types/api'

// People of a Task, visible at first glance under the title (owner decision of 2026-10-31): the owner
// and the assignees with their names. Editors open a searchable member list from the same row, where
// each person can be assigned or unassigned and an assignee can be made the Task owner. Read-only
// users see the row without the list.
const props = defineProps<{ assignees: UserRef[], owner: string | null, ownerRef?: UserRef | null, members: SpaceMember[], disabled?: boolean }>()
const emit = defineEmits<{ toggle: [user: string], owner: [user: string] }>()

const query = ref('')
const assigned = computed(() => new Set(props.assignees.map(person => person.name)))
const visible = computed(() => {
  const term = query.value.trim().toLowerCase()
  const people = term ? props.members.filter(member => member.fullName.toLowerCase().includes(term)) : props.members
  return [...people].sort((a, b) => Number(assigned.value.has(b.name)) - Number(assigned.value.has(a.name)))
})
// The owner may be outside the assignees (the creator stays the owner, I-TASK-2).
const ownerPerson = computed(() => props.assignees.find(person => person.name === props.owner) ?? (props.ownerRef?.name === props.owner ? props.ownerRef : undefined))
const editLabel = computed(() => `Edit people. Owner: ${ownerPerson.value?.fullName ?? 'none'}. Assignees: ${
  props.assignees.length ? props.assignees.map(person => person.fullName).join(', ') : 'none'}`)
</script>

<template>
  <div v-if="disabled" class="px-1.5 py-1 text-sm" data-testid="task-people">
    <TaskPeopleSummary :owner="ownerPerson" :assignees="assignees" />
  </div>
  <UPopover v-else :content="{ align: 'start' }">
    <button
      type="button"
      class="flex max-w-full items-center gap-2 rounded-(--ui-radius) px-1.5 py-1 text-start text-sm hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
      :aria-label="editLabel"
      data-testid="task-people"
    >
      <TaskPeopleSummary :owner="ownerPerson" :assignees="assignees" />
      <UIcon name="i-lucide-chevron-down" class="size-3.5 shrink-0 text-dimmed" aria-hidden="true" />
    </button>
    <template #content>
      <div class="flex w-80 flex-col gap-2 p-3">
        <UInput v-model="query" icon="i-lucide-search" placeholder="Search members" aria-label="Search members" autofocus />
        <ul class="max-h-72 overflow-y-auto" aria-label="Space members">
          <li v-for="member in visible" :key="member.name" class="flex items-center gap-1">
            <button
              type="button"
              role="checkbox"
              :aria-checked="assigned.has(member.name)"
              class="flex min-w-0 flex-1 items-center gap-2 rounded-(--ui-radius) px-2 py-1.5 text-start text-sm hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
              @click="emit('toggle', member.name)"
            >
              <UIcon :name="assigned.has(member.name) ? 'i-lucide-square-check' : 'i-lucide-square'" class="size-4 shrink-0" :class="assigned.has(member.name) ? 'text-primary' : 'text-dimmed'" />
              <UserAvatar :user="member" size="2xs" />
              <span class="truncate">{{ member.fullName }}</span>
            </button>
            <UTooltip v-if="assigned.has(member.name)" :text="member.name === owner ? 'Task owner' : 'Make Task owner'">
              <UButton
                icon="i-lucide-crown"
                size="xs"
                square
                variant="ghost"
                :color="member.name === owner ? 'primary' : 'neutral'"
                :aria-label="member.name === owner ? `${member.fullName} is the Task owner` : `Make ${member.fullName} the Task owner`"
                :aria-pressed="member.name === owner"
                @click="emit('owner', member.name)"
              />
            </UTooltip>
          </li>
        </ul>
        <p v-if="!visible.length" class="px-2 py-1.5 text-sm text-muted">No members match.</p>
      </div>
    </template>
  </UPopover>
</template>
