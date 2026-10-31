<script setup lang="ts">
import type { UserRef } from '~/types/api'

// Assignee avatars in each person's colour; the Task owner comes first with a ring. One accessible description for the group.
// An owner who is not assigned (Tasks imported from ERPNext keep their creator) is shown first as well.
const props = defineProps<{ assignees: UserRef[], owner: string | null, ownerRef?: UserRef | null, max?: number }>()
const outsideOwner = computed(() => (props.ownerRef && props.ownerRef.name === props.owner && !props.assignees.some(person => person.name === props.owner) ? props.ownerRef : null))
const ordered = computed(() => [
  ...(outsideOwner.value ? [outsideOwner.value] : []),
  ...[...props.assignees].sort((a, b) => Number(b.name === props.owner) - Number(a.name === props.owner)),
])
const description = computed(() => ordered.value
  .map(person => (person.name === props.owner ? `${person.fullName} (owner)` : person.fullName))
  .join(', '))
</script>

<template>
  <span v-if="ordered.length" class="flex justify-end" role="img" :aria-label="assignees.length ? `Assigned to ${description}` : description" :title="description">
    <UAvatarGroup size="sm" :max="max ?? 3">
      <UserAvatar
        v-for="person in ordered"
        :key="person.name"
        :user="person"
        :class="person.name === owner ? 'ring-2 ring-primary' : ''"
      />
    </UAvatarGroup>
  </span>
  <span v-else class="flex justify-end text-xs text-muted">Unassigned</span>
</template>
