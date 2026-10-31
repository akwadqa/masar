<script setup lang="ts">
import type { SpaceDetail } from '~/types/api'
import { formatLongDate } from '~/utils/format'

defineProps<{ space: SpaceDetail }>()
</script>

<template>
  <div class="grid gap-6 p-4 sm:p-6 lg:grid-cols-3">
    <UAlert
      v-if="!space.permissions.isMember"
      class="lg:col-span-3"
      color="info"
      variant="subtle"
      icon="i-lucide-shield"
      title="Administrator view"
      description="You can manage this Space's details and members. Its tasks are visible only to members; add yourself in Settings if you need access."
    />

    <UCard class="lg:col-span-2" :ui="{ body: 'space-y-5' }">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-medium text-highlighted">Details</h2>
          <UButton
            v-if="space.permissions.canEditDetails"
            :to="`/spaces/${space.name}/settings`"
            icon="i-lucide-pencil"
            color="neutral"
            variant="outline"
            size="sm"
            label="Edit"
          />
        </div>
      </template>
      <dl class="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
        <div><dt class="text-muted">Category</dt><dd class="text-highlighted">{{ space.category || '—' }}</dd></div>
        <div><dt class="text-muted">Status</dt><dd><SpaceStatusBadge :status="space.status" size="sm" /></dd></div>
        <div><dt class="text-muted">Type</dt><dd class="text-highlighted">{{ space.spaceType }}</dd></div>
        <div><dt class="text-muted">Completion date</dt><dd class="text-highlighted">{{ formatLongDate(space.completionDate) || '—' }}</dd></div>
        <div>
          <dt class="text-muted">Gameplan</dt>
          <dd>
            <ULink v-if="space.gameplanUrl" :to="space.gameplanUrl" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-primary">
              Open project <UIcon name="i-lucide-external-link" class="size-3.5" />
            </ULink>
            <span v-else class="text-highlighted">—</span>
          </dd>
        </div>
      </dl>
      <div>
        <p class="mb-1 text-sm text-muted">Description</p>
        <!-- Markdown (cleaned on save like Task descriptions), shown read-only with the same editor. -->
        <UEditor
          v-if="space.details"
          :model-value="space.details"
          content-type="markdown"
          :editable="false"
          :ui="{ base: 'text-sm text-default *:my-1.5 [&_p]:leading-6 [&_h3]:text-base [&_h3]:font-semibold [&_pre]:rounded-md [&_pre]:bg-elevated [&_pre]:p-3 [&_blockquote]:border-s-2 [&_blockquote]:border-accented [&_blockquote]:ps-3 [&_blockquote]:text-muted' }"
          aria-label="Description"
        />
        <p v-else class="text-sm text-dimmed">No description yet.</p>
      </div>
    </UCard>

    <UCard :ui="{ body: 'space-y-4' }">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-medium text-highlighted">People</h2>
          <UButton
            v-if="space.permissions.canManageMembers"
            :to="`/spaces/${space.name}/settings#members`"
            color="neutral"
            variant="ghost"
            size="sm"
            label="Manage"
            trailing-icon="i-lucide-arrow-right"
          />
        </div>
      </template>
      <div class="flex items-center gap-3">
        <UserAvatar :user="space.owner" size="sm" />
        <div class="min-w-0 text-sm">
          <p class="truncate text-highlighted">{{ space.owner.fullName }}</p>
          <p class="flex items-center gap-1 text-muted"><UIcon name="i-lucide-crown" class="size-3.5 text-warning" /> Owner</p>
        </div>
      </div>
      <USeparator />
      <ul class="space-y-3" aria-label="Members">
        <li v-for="member in space.members" :key="member.name" class="flex items-center gap-3 text-sm">
          <UserAvatar :user="member" size="xs" />
          <span class="min-w-0 flex-1 truncate">{{ member.fullName }}</span>
          <UBadge color="neutral" variant="outline" size="sm" :label="member.role" />
        </li>
      </ul>
    </UCard>

    <SpaceFiles v-if="space.permissions.canViewFiles" :space="space" class="lg:col-span-3" />
  </div>
</template>
