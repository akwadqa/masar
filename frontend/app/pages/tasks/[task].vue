<script setup lang="ts">
const route = useRoute()
const name = computed(() => String(route.params.task))
const { data: task } = useTask(name)
useHead(() => ({ title: task.value ? `${task.value.title} · Masar` : 'Task · Masar' }))
</script>

<template>
  <UDashboardPanel :id="`task-${name}`" :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <UDashboardNavbar :title="task?.title ?? 'Task'">
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton
            v-if="task"
            :to="`/spaces/${task.space}/tasks?task=${task.name}`"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            :label="task.spaceTitle"
          />
        </template>
        <template #right>
          <NotificationBell placement="navbar" class="lg:hidden" />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <div class="masar-boxed mx-auto w-full max-w-3xl">
        <TaskDetail :name="name" mode="page" @deleted="navigateTo(task ? `/spaces/${task.space}/tasks` : '/spaces')" />
      </div>
    </template>
  </UDashboardPanel>
</template>
