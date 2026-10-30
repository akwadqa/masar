<script setup lang="ts">
import type { TaskListFilters, TaskListRow } from '~/types/api'

// My Day: the Tasks the user picked for today, across every Space they belong to. It is personal
// (client revision 4): Tasks join and leave it from the sun toggle on a Task row, and leave it on their
// own once finished.
useHead({ title: 'My Day · Masar' })
const { filters, setQuery } = useTaskFilters({ sort: 'recently_updated', completed: 'open' })
const myDayFilters = computed<TaskListFilters>(() => ({ ...filters.value, myDay: true, assignedToMe: false, ownedByMe: false }))
const { data: tasks, status, error, refresh } = useMyWork(myDayFilters)
const controller = useTaskListController(tasks)
const { activeTask, openTask: showTask, closeTask } = useTaskPanel()
const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Qatar' }).format(new Date())

function openTask(task: TaskListRow) {
  showTask(task.name)
}
</script>

<template>
  <UDashboardPanel id="my-day" :ui="{ body: 'p-0 sm:p-0 gap-0' }">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #title>
          <span class="flex items-center gap-2">
            <UIcon name="i-lucide-sun" class="size-5 text-focus-accent" />
            <span class="text-page-title">My Day</span>
          </span>
        </template>
        <template #right>
          <span class="hidden text-sm text-muted sm:inline">{{ today }}</span>
          <NotificationBell placement="navbar" class="lg:hidden" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <div class="relative min-h-0 flex-1">
          <div v-if="status === 'pending' && !tasks?.length" class="space-y-px">
            <USkeleton v-for="i in 6" :key="i" class="h-12 rounded-none" />
          </div>
          <StatePanel v-else-if="error && !tasks?.length" tone="error" icon="i-lucide-cloud-off" title="My Day could not be loaded" :description="error.message">
            <UButton label="Try again" @click="refresh()" />
          </StatePanel>
          <StatePanel
            v-else-if="!tasks?.length"
            icon="i-lucide-sun"
            title="Nothing planned for today yet"
            description="Use the sun button on any task to add it to My Day."
          >
            <UButton to="/tasks" color="neutral" variant="outline" label="Open All Tasks" />
          </StatePanel>
          <TaskList
            v-else
            :tasks="tasks ?? []"
            :drafts="[]"
            :active-task="activeTask"
            :can-create="false"
            :can-edit="true"
            :selected="controller.selected.value"
            :expanded="controller.expanded.value"
            :scroll-key="`my-day:${JSON.stringify(filters)}`"
            @open="openTask"
            @status="(task, status) => controller.setStatus(task, status, true)"
            @select="controller.select"
            @expand="controller.toggleExpand"
            @attribute="(task, field) => controller.toggleAttribute(task, field, true)"
            @action-done="controller.setActionDone"
          />
        </div>
        <TaskPanel :task-name="activeTask" @close="closeTask" />
      </div>
    </template>
  </UDashboardPanel>
</template>
