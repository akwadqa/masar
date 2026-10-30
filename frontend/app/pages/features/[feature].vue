<script setup lang="ts">
const route = useRoute()
const name = computed(() => String(route.params.feature))
const { data: record } = useFeature(name)
const label = computed(() => (record.value ? record.value.title : 'Feature'))
useHead(() => ({ title: `${label.value} · Masar` }))
</script>

<template>
  <UDashboardPanel :id="`feature-${name}`" :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <UDashboardNavbar :title="label">
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton
            v-if="record"
            :to="`/spaces/${record.space}/roadmap?feature=${record.name}`"
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
        <FeatureDetail :name="name" mode="page" @deleted="navigateTo(record ? `/spaces/${record.space}/roadmap` : '/spaces')" />
      </div>
    </template>
  </UDashboardPanel>
</template>
