<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { user } = useSession()
const { data: spaces } = useSpaceList()

// Workspace destinations (client revision 2): My Day is the home page.
const navigation = computed<NavigationMenuItem[]>(() => [
  { label: 'My Day', icon: 'i-lucide-sun', to: '/my-day', ui: { linkLeadingIcon: 'text-focus-accent' } },
  { label: 'All Tasks', icon: 'i-lucide-list-checks', to: '/tasks', exact: true },
  { label: 'Sprints', icon: 'i-lucide-calendar-range', to: '/sprints' },
  { label: 'Spaces', icon: 'i-lucide-layout-grid', to: '/spaces', exact: true }
])
// While the sidebar search has a term, its results replace the navigation below it.
const searching = ref(false)
useNotificationPolling()
</script>

<template>
  <!-- Installed on a phone the page reaches the home indicator (and the notch in landscape): the shell
       keeps its content inside the safe areas. It never scrolls itself (overflow-clip): pages
       scroll inside their panel, and a focused field cannot move the whole shell under the status bar.
       Its opaque page colour (bg-canvas, the colour already behind it) lets iOS paint the status-bar
       edge solid in the installed app: iOS blurs the top unless the fixed box there is full-width and
       opaque (2026-10-30; docs/qa/ios-pwa-status-bar-blur-investigation.md). -->
  <UDashboardGroup
    unit="rem"
    storage="local"
    storage-key="masar-dashboard"
    class="overflow-clip bg-canvas pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)]"
  >
    <!-- The phone drawer (`content`): the account footer reaches the bottom edge and keeps its controls above
         the home indicator; the inset replaces the footer's own bottom padding instead of adding a band below it. -->
    <UDashboardSidebar
      id="masar-sidebar"
      collapsible
      resizable
      :min-size="14"
      :default-size="17"
      :max-size="22"
      :ui="{ footer: 'border-t border-default', content: 'pt-[env(safe-area-inset-top)] [&>[data-slot=footer]]:pb-[max(0.75rem,env(safe-area-inset-bottom))]' }"
    >
      <template #header="{ collapsed }">
        <NuxtLink to="/my-day" class="rounded-pill px-1.5 focus-visible:outline-2 focus-visible:outline-primary" :class="collapsed ? 'mx-auto' : ''" aria-label="Masar home">
          <MasarLogo :collapsed="collapsed" />
        </NuxtLink>
        <NotificationBell v-if="!collapsed" placement="sidebar" class="ms-auto" />
      </template>

      <template #default="{ collapsed }">
        <SidebarSearch v-if="!collapsed" :spaces="spaces ?? []" class="mb-2" @active="(value) => searching = value" />
        <UNavigationMenu
          v-if="collapsed || !searching"
          :collapsed="collapsed"
          :items="navigation"
          orientation="vertical"
          tooltip
          :ui="{ link: collapsed ? 'justify-center py-2 text-sm' : 'py-2 text-sm', linkLeadingIcon: 'size-[1.125rem]' }"
        />
        <template v-if="collapsed || !searching">
          <SpacesNavigation :spaces="spaces ?? []" :collapsed="collapsed" />
          <ActiveTimer :collapsed="collapsed" />
        </template>
      </template>

      <template #footer="{ collapsed }">
        <div :class="collapsed ? 'flex w-full flex-col items-center gap-1' : 'contents'">
          <NotificationBell v-if="collapsed" placement="sidebar" />
          <UserMenu :collapsed="collapsed" />
        </div>
      </template>
    </UDashboardSidebar>

    <NoAccessState v-if="user && !user.isMasarUser" class="flex-1" />
    <slot v-else />
  </UDashboardGroup>
</template>
