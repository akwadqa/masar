<script setup lang="ts">
const route = useRoute()
const name = computed(() => String(route.params.task))
const { data: task } = useTask(name)
useHead(() => ({ title: task.value ? `${task.value.title} · Masar` : 'Task · Masar' }))
</script>

<template>
  <UDashboardPanel :id="`task-${name}`" :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <!-- Phones hide the navbar title: the Task's buttons fill the bar, and the full title is right below. -->
      <UDashboardNavbar :title="task?.title ?? 'Task'" :ui="{ title: 'max-sm:hidden' }">
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton
            v-if="task"
            :to="`/spaces/${task.space}/tasks?task=${task.name}`"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            class="min-w-0"
            :label="task.spaceTitle"
          />
        </template>
        <!-- The Task's own top bar is not drawn on this page (client feedback 2026-11-10): the viewers sit
             after the title, and TaskDetailHeader teleports its buttons into #task-page-actions. -->
        <template #trailing>
          <PresenceAvatars v-if="task" doctype="Masar Task" :name="task.name" />
        </template>
        <template #right>
          <div id="task-page-actions" class="flex items-center gap-1" />
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
