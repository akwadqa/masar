<script setup lang="ts">
import type { SpaceDetail } from '~/types/api'

// The people of a Space in its top bar (client revision 5, as in Jira): overlapping avatars, the owner
// first. Opens the full list with roles; Space Managers can go on to manage members.
const props = defineProps<{ space: SpaceDetail }>()
const people = computed(() => [...props.space.members].sort((a, b) => Number(b.name === props.space.owner.name) - Number(a.name === props.space.owner.name)))
const label = computed(() => `${people.value.length} ${people.value.length === 1 ? 'member' : 'members'}`)
</script>

<template>
  <UPopover :content="{ align: 'end', sideOffset: 8 }">
    <button
      type="button"
      class="flex items-center rounded-pill p-0.5 transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
      :aria-label="`${label}: ${people.map(p => p.fullName).join(', ')}`"
      data-testid="space-members"
    >
      <UAvatarGroup size="sm" :max="4" class="max-sm:hidden" :ui="{ base: 'ring-2 ring-(--ui-bg)' }">
        <UserAvatar v-for="person in people" :key="person.name" :user="person" />
      </UAvatarGroup>
      <UAvatarGroup size="sm" :max="2" class="sm:hidden" :ui="{ base: 'ring-2 ring-(--ui-bg)' }">
        <UserAvatar v-for="person in people" :key="person.name" :user="person" />
      </UAvatarGroup>
    </button>

    <template #content>
      <section class="w-72" aria-label="Space members">
        <header class="flex items-center justify-between border-b border-default px-4 py-3">
          <h2 class="text-section text-highlighted">Members</h2>
          <span class="text-xs text-muted">{{ label }}</span>
        </header>
        <ul class="max-h-80 overflow-y-auto py-1">
          <li v-for="person in people" :key="person.name" class="flex items-center gap-3 px-4 py-2">
            <UserAvatar :user="person" size="sm" />
            <span class="min-w-0 flex-1 truncate text-sm text-highlighted">{{ person.fullName }}</span>
            <UBadge v-if="person.name === space.owner.name" color="warning" variant="subtle" size="sm" icon="i-lucide-crown" label="Owner" />
            <UBadge v-else-if="person.role === 'Manager'" color="neutral" variant="outline" size="sm" label="Manager" />
          </li>
        </ul>
        <footer v-if="space.permissions.canManageMembers" class="border-t border-default p-2">
          <UButton :to="`/spaces/${space.name}/settings`" block color="neutral" variant="ghost" size="sm" icon="i-lucide-user-plus" label="Manage members" />
        </footer>
      </section>
    </template>
  </UPopover>
</template>
