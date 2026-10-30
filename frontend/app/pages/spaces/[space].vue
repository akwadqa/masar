<script setup lang="ts">
const route = useRoute()
const spaceName = computed(() => String(route.params.space))
const { data: space, status, error } = useSpaceDetail(spaceName)

const { recordVisit } = useRecentSpaces()
watch(spaceName, name => {
  try { localStorage.setItem('masar:last-space', name) } catch { /* storage unavailable */ }
  recordVisit(name)
}, { immediate: true })

const tabs = computed(() => {
  const base = `/spaces/${spaceName.value}`
  const items = []
  if (space.value?.permissions.isMember) {
    items.push(
      { label: 'Active Sprints', icon: 'i-lucide-calendar-range', to: `${base}/sprints` },
      { label: 'Task List', icon: 'i-lucide-list-checks', to: `${base}/tasks` },
      { label: 'Roadmap', icon: 'i-lucide-map', to: `${base}/roadmap` },
      { label: 'Releases', icon: 'i-lucide-package', to: `${base}/releases` }
    )
  }
  items.push({ label: 'Summary', icon: 'i-lucide-info', to: `${base}/summary` })
  if (space.value?.permissions.canManageMembers) items.push({ label: 'Settings', icon: 'i-lucide-settings', to: `${base}/settings` })
  return items
})

// Administrators who are not members manage the Space but do not see its tasks (Q-08 default).
watch([space, () => route.path], ([value, path]) => {
  if (value && !value.permissions.isMember && /\/(tasks|sprints|roadmap|releases)$/.test(path)) {
    void navigateTo(`/spaces/${value.name}/summary`, { replace: true })
  }
}, { immediate: true })

// On narrow screens the tab bar scrolls; keep the current tab in view.
const tabBar = ref<HTMLElement | null>(null)
watch([() => route.path, () => !!space.value], () => nextTick(() => {
  tabBar.value?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}), { immediate: true })

useHead(() => ({ title: space.value ? `${space.value.title} · Masar` : 'Masar' }))
</script>

<template>
  <UDashboardPanel :id="`space-${spaceName}`" :ui="{ body: 'p-0 sm:p-0 gap-0' }">
    <template #header>
      <UDashboardNavbar :title="space?.title ?? ''">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <template v-if="space">
            <SpaceMemberStack v-if="space.members.length" :space="space" />
            <SpaceStatusBadge :status="space.status" size="sm" class="hidden sm:inline-flex" />
            <UBadge v-if="space.owner.name === useSession().user.value?.user" color="warning" variant="subtle" icon="i-lucide-crown" label="Owner" />
            <UBadge v-else-if="space.myRole" color="neutral" variant="outline" :label="space.myRole" />
            <UBadge v-else color="neutral" variant="outline" icon="i-lucide-shield" label="Admin view" />
          </template>
          <NotificationBell placement="navbar" class="lg:hidden" />
        </template>
      </UDashboardNavbar>
      <UDashboardToolbar v-if="space">
        <!-- Six tabs: scroll sideways on narrow phones instead of truncating labels. -->
        <div ref="tabBar" class="-mx-1 min-w-0 flex-1 overflow-x-auto">
          <UNavigationMenu
            :items="tabs"
            highlight
            class="w-max"
            :ui="{ root: '[&>div]:min-w-max', list: 'min-w-max', item: 'min-w-max shrink-0', linkLabel: 'overflow-visible whitespace-nowrap' }"
          />
        </div>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div v-if="status === 'pending' && !space" class="space-y-2 p-4 sm:p-6">
        <USkeleton v-for="i in 6" :key="i" class="h-9" />
      </div>
      <StatePanel
        v-else-if="error?.kind === 'not_found' || (!space && status === 'success')"
        icon="i-lucide-folder-x"
        title="Space not found"
        description="This Space does not exist or you no longer have access to it."
      >
        <UButton to="/spaces" label="Go to Spaces" />
      </StatePanel>
      <StatePanel v-else-if="error && !space" tone="error" icon="i-lucide-cloud-off" title="This Space could not be loaded" :description="error.message" />
      <NuxtPage v-else-if="space" :space="space" />
    </template>
  </UDashboardPanel>
</template>
