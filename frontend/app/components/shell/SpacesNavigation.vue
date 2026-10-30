<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import type { SpaceSummary } from '~/types/api'

// Sidebar Spaces section: Pinned, then Recent (not pinned), then "Browse all Spaces" (SpacePicker).
// Only Spaces the user currently belongs to are ever shown; every entry is a link plus a pin toggle.
const props = defineProps<{ spaces: SpaceSummary[], collapsed?: boolean }>()

const route = useRoute()
const { pinnedSpaces, togglePin } = usePreferences()
const { recentSpaces } = useRecentSpaces()
const expanded = useLocalStorage('masar:sidebar-spaces-open', true)

const byName = computed(() => new Map(props.spaces.filter(space => space.role).map(space => [space.name, space])))
const pinned = computed(() => pinnedSpaces.value.flatMap(name => byName.value.get(name) ?? []))
const recent = computed(() => recentSpaces.value
  .filter(name => !pinnedSpaces.value.includes(name))
  .flatMap(name => byName.value.get(name) ?? [])
  .slice(0, 4))
// Before anything is pinned or visited, show a few Spaces so the section is never empty.
const starter = computed(() => (pinned.value.length || recent.value.length ? [] : [...byName.value.values()].slice(0, 4)))
const groups = computed(() => [
  { key: 'pinned', label: 'Pinned', spaces: pinned.value },
  { key: 'recent', label: 'Recent', spaces: recent.value },
  { key: 'yours', label: 'Your Spaces', spaces: starter.value }
].filter(group => group.spaces.length))

const isActive = (space: SpaceSummary) => route.path.startsWith(`/spaces/${space.name}`)
const isPinned = (space: SpaceSummary) => pinnedSpaces.value.includes(space.name)
</script>

<template>
  <nav aria-label="Spaces" class="flex flex-col gap-0.5">
    <div v-if="!collapsed" class="flex items-center justify-between ps-2.5 pe-1 pt-4 pb-1">
      <button
        type="button"
        class="flex items-center gap-1 text-meta text-muted hover:text-highlighted"
        :aria-expanded="expanded"
        aria-controls="sidebar-spaces"
        @click="expanded = !expanded"
      >
        Spaces
        <UIcon :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" />
      </button>
      <UButton icon="i-lucide-layout-grid" color="neutral" variant="ghost" size="sm" square to="/spaces" aria-label="Spaces overview" />
    </div>
    <USeparator v-else class="my-2" />

    <div v-show="expanded || collapsed" id="sidebar-spaces" class="flex flex-col gap-0.5">
      <template v-for="group in groups" :key="group.key">
        <p v-if="!collapsed" class="ps-3 pt-2 pb-0.5 text-xs font-semibold text-muted">{{ group.label }}</p>
        <div v-for="space in group.spaces" :key="space.name" class="group relative flex items-center">
          <UTooltip :text="space.title" :disabled="!collapsed">
            <NuxtLink
              :to="`/spaces/${space.name}/tasks`"
              class="flex min-w-0 flex-1 items-center gap-2.5 rounded-pill py-2 text-sm transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
              :class="[isActive(space) ? 'bg-primary/8 font-semibold text-primary' : 'text-default', collapsed ? 'justify-center' : 'ps-3 pe-8']"
              :aria-current="isActive(space) ? 'page' : undefined"
              :aria-label="collapsed ? space.title : undefined"
            >
              <SpaceIcon :space="space" size="sm" />
              <span v-if="!collapsed" class="truncate">{{ space.title }}</span>
            </NuxtLink>
          </UTooltip>
          <UButton
            v-if="!collapsed"
            :icon="isPinned(space) ? 'i-lucide-pin-off' : 'i-lucide-pin'"
            color="neutral"
            variant="ghost"
            size="sm"
            square
            class="absolute end-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            :aria-label="isPinned(space) ? `Unpin ${space.title}` : `Pin ${space.title}`"
            @click="togglePin(space.name)"
          />
        </div>
      </template>
      <SpacePicker v-if="!collapsed" :spaces="spaces" />
    </div>
  </nav>
</template>
