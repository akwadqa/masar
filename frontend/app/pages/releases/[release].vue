<script setup lang="ts">
const route = useRoute()
const name = computed(() => String(route.params.release))
const { data: record } = useRelease(name)
const label = computed(() => (record.value ? record.value.releaseName : 'Release'))
useHead(() => ({ title: `${label.value} · Masar` }))
</script>

<template>
  <UDashboardPanel :id="`release-${name}`" :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <UDashboardNavbar :title="label">
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton
            v-if="record"
            :to="`/spaces/${record.space}/releases?release=${record.name}`"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            :label="record.spaceTitle"
          />
        </template>
        <template #right>
          <NotificationBell placement="navbar" class="lg:hidden" />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <div class="masar-boxed mx-auto w-full max-w-3xl">
        <ReleaseDetail :name="name" mode="page" @deleted="navigateTo(record ? `/spaces/${record.space}/releases` : '/spaces')" />
      </div>
    </template>
  </UDashboardPanel>
</template>
