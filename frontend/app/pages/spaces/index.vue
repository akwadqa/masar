<script setup lang="ts">
import { SPACE_STATUSES, type SpaceStatus } from '~/types/api'
import type { SpaceScope } from '~/composables/useSpaces'

useHead({ title: 'Spaces · Masar' })
const route = useRoute()
const router = useRouter()
const { user } = useSession()

const scope = computed<SpaceScope>(() => (route.query.scope === 'all' && user.value?.canCreateSpaces ? 'all' : 'mine'))
const status = computed<SpaceStatus | 'all'>(() => {
  const value = route.query.status
  if (value === 'all') return 'all'
  return SPACE_STATUSES.find(s => s === value) ?? 'In Progress'
})
const search = ref(typeof route.query.q === 'string' ? route.query.q : '')
watch(search, value => setQuery({ q: value || undefined }))

function setQuery(patch: Record<string, string | undefined>) {
  void router.replace({ query: { ...route.query, ...patch } })
}

const { data: spaces, status: loadStatus, error, refresh } = useSpaceList(scope)
const createOpen = ref(false)

// Name (A–Z, the server's order) or newest first (client request 2026-10-31); kept in the URL.
const sort = computed<'name' | 'created'>(() => (route.query.sort === 'created' ? 'created' : 'name'))
const sortItems = [{ label: 'Name', value: 'name' }, { label: 'Creation date', value: 'created' }]

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  const matching = (spaces.value ?? []).filter(space =>
    (status.value === 'all' || space.status === status.value)
    && (!term || [space.title, space.category ?? '', space.owner.fullName].some(v => v.toLowerCase().includes(term))))
  return sort.value === 'created' ? [...matching].sort((a, b) => Date.parse(b.creation) - Date.parse(a.creation)) : matching
})
const counts = computed(() => {
  const all = spaces.value ?? []
  return Object.fromEntries(SPACE_STATUSES.map(s => [s, all.filter(x => x.status === s).length])) as Record<SpaceStatus, number>
})

const statusItems = computed(() => [
  ...SPACE_STATUSES.map(s => ({ label: `${s} (${counts.value[s]})`, value: s })),
  { label: `All statuses (${spaces.value?.length ?? 0})`, value: 'all' }
])
const scopeItems = [{ label: 'My Spaces', value: 'mine' }, { label: 'All Spaces', value: 'all' }]
const hasFilters = computed(() => status.value !== 'In Progress' || !!search.value)
</script>

<template>
  <UDashboardPanel id="spaces">
    <template #header>
      <UDashboardNavbar title="Spaces">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton v-if="user?.canCreateSpaces" icon="i-lucide-plus" label="Create Space" @click="createOpen = true" />
          <NotificationBell placement="navbar" class="lg:hidden" />
        </template>
      </UDashboardNavbar>
      <UDashboardToolbar>
        <div class="flex w-full flex-wrap items-center gap-2 py-1">
          <UTabs
            v-if="user?.canCreateSpaces"
            :model-value="scope"
            :items="scopeItems"
            :content="false"
            size="xs"
            class="w-auto"
            @update:model-value="(v: string | number) => setQuery({ scope: v === 'all' ? 'all' : undefined })"
          />
          <UInput v-model="search" icon="i-lucide-search" placeholder="Search spaces" size="sm" class="w-full sm:w-56" aria-label="Search spaces" />
          <USelect
            :model-value="status"
            :items="statusItems"
            size="sm"
            class="w-48"
            aria-label="Filter by status"
            @update:model-value="(v: string) => setQuery({ status: v === 'In Progress' ? undefined : v })"
          />
          <USelect
            :model-value="sort"
            :items="sortItems"
            size="sm"
            class="w-40"
            aria-label="Sort spaces"
            @update:model-value="(v: string) => setQuery({ sort: v === 'created' ? 'created' : undefined })"
          />
        </div>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div v-if="loadStatus === 'pending' && !spaces?.length" class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <USkeleton v-for="i in 6" :key="i" class="h-36" />
      </div>
      <StatePanel v-else-if="error" tone="error" icon="i-lucide-cloud-off" title="Spaces could not be loaded" :description="error.message">
        <UButton label="Try again" @click="refresh()" />
      </StatePanel>
      <StatePanel
        v-else-if="!spaces?.length"
        icon="i-lucide-folder-open"
        :title="scope === 'all' ? 'No Spaces exist yet' : 'You\'re not a member of any Space yet'"
        :description="user?.canCreateSpaces ? 'Create the first Space and choose its owner.' : 'A Space Manager or Masar administrator adds people to Spaces.'"
      >
        <UButton v-if="user?.canCreateSpaces" icon="i-lucide-plus" label="Create Space" @click="createOpen = true" />
      </StatePanel>
      <StatePanel v-else-if="!filtered.length" icon="i-lucide-search-x" title="No Spaces match these filters">
        <UButton v-if="hasFilters" color="neutral" variant="outline" label="Clear filters" @click="search = ''; setQuery({ status: undefined, q: undefined })" />
      </StatePanel>
      <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <NuxtLink
          v-for="space in filtered"
          :key="space.name"
          :to="space.role ? `/spaces/${space.name}/tasks` : `/spaces/${space.name}/summary`"
          class="group rounded-lg focus-visible:outline-2 focus-visible:outline-primary"
          :aria-label="`${space.title}, ${space.status}${space.role ? `, ${space.role}` : ''}`"
        >
          <UCard class="h-full transition group-hover:ring-accented" :ui="{ body: 'flex h-full flex-col gap-4' }">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate font-medium text-highlighted">{{ space.title }}</p>
                <p class="truncate text-sm text-muted">{{ space.category || 'No category' }}</p>
              </div>
              <SpaceStatusBadge :status="space.status" size="sm" />
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <UBadge color="neutral" variant="soft" size="sm" :label="space.spaceType" />
              <UBadge v-if="space.isOwner" color="warning" variant="subtle" size="sm" icon="i-lucide-crown" label="Owner" />
              <UBadge v-else-if="space.role" color="neutral" variant="outline" size="sm" :label="space.role" />
              <UBadge v-else color="neutral" variant="outline" size="sm" icon="i-lucide-shield" label="Admin view" />
            </div>
            <div class="mt-auto flex items-center justify-between gap-3 text-sm text-muted">
              <span class="flex min-w-0 items-center gap-2">
                <UserAvatar :user="space.owner" size="2xs" />
                <span class="truncate">{{ space.owner.fullName }}</span>
              </span>
              <span class="shrink-0">
                <template v-if="space.openTaskCount !== null">{{ space.openTaskCount }} open · </template>{{ space.memberCount }} {{ space.memberCount === 1 ? 'member' : 'members' }}
              </span>
            </div>
          </UCard>
        </NuxtLink>
      </div>
      <CreateSpaceModal v-model:open="createOpen" />
    </template>
  </UDashboardPanel>
</template>
