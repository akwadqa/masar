<script setup lang="ts">
import type { SpaceMember, UserRef } from '~/types/api'

// People of a Task (client revision 2): an icon in the Task header opens who owns and who is assigned
// to the Task, then a searchable member list where each person can be assigned or unassigned and an
// assignee can be made the Task owner. Read-only users see the people without the list.
const props = defineProps<{ assignees: UserRef[], owner: string | null, members: SpaceMember[], disabled?: boolean }>()
const emit = defineEmits<{ toggle: [user: string], owner: [user: string] }>()

const query = ref('')
const assigned = computed(() => new Set(props.assignees.map(person => person.name)))
const visible = computed(() => {
  const term = query.value.trim().toLowerCase()
  const people = term ? props.members.filter(member => member.fullName.toLowerCase().includes(term)) : props.members
  return [...people].sort((a, b) => Number(assigned.value.has(b.name)) - Number(assigned.value.has(a.name)))
})
const ownerPerson = computed(() => props.assignees.find(person => person.name === props.owner))
const ownerName = computed(() => ownerPerson.value?.fullName)
</script>

<template>
  <UPopover :content="{ align: 'end' }">
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-users"
      class="gap-1.5"
      :label="assignees.length ? String(assignees.length) : undefined"
      :aria-label="assignees.length ? `${assignees.length} ${assignees.length === 1 ? 'person' : 'people'}: ${assignees.map(person => person.fullName).join(', ')}${ownerName ? `; owner ${ownerName}` : ''}` : 'Assign people'"
      :title="assignees.length ? `${assignees.length} assigned${ownerName ? ` · owner ${ownerName}` : ''}` : 'No one assigned'"
      data-testid="task-people"
    />
    <template #content>
      <div class="flex w-80 flex-col gap-2 p-3">
        <dl class="space-y-1.5 text-sm" data-testid="task-people-summary">
          <div class="flex items-center gap-2">
            <dt class="w-20 shrink-0 text-muted">Owner</dt>
            <dd class="flex min-w-0 items-center gap-2 text-highlighted">
              <template v-if="ownerPerson"><UserAvatar :user="ownerPerson" size="2xs" /><span class="truncate">{{ ownerPerson.fullName }}</span></template>
              <span v-else class="text-muted">No owner</span>
            </dd>
          </div>
          <div class="flex items-start gap-2">
            <dt class="w-20 shrink-0 text-muted">Assigned</dt>
            <dd class="min-w-0 text-highlighted">{{ assignees.length ? assignees.map(person => person.fullName).join(', ') : 'No one yet' }}</dd>
          </div>
        </dl>
        <template v-if="!disabled">
        <USeparator />
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
        </template>
      </div>
    </template>
  </UPopover>
</template>
