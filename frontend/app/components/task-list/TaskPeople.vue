<script setup lang="ts">
import type { UserRef } from '~/types/api'

// Assignee avatars in each person's colour; the Task owner comes first with a ring. One accessible description for the group.
const props = defineProps<{ assignees: UserRef[], owner: string | null, max?: number }>()
const ordered = computed(() => [...props.assignees].sort((a, b) => Number(b.name === props.owner) - Number(a.name === props.owner)))
const description = computed(() => ordered.value
  .map(person => (person.name === props.owner ? `${person.fullName} (owner)` : person.fullName))
  .join(', '))
</script>

<template>
  <span v-if="assignees.length" class="flex justify-end" role="img" :aria-label="`Assigned to ${description}`" :title="description">
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
