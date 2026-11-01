<script setup lang="ts">
import type { TaskListRow, TaskSort } from '~/types/api'

// All Tasks: every Task the user can see across their Spaces, as a list (client revision 3). "Group by
// Batch" turns it into the planning board: a box per current Batch with its Task rows and the Backlog,
// where rows move by drag and drop or "Add selected". Versions and Features belong to one Space, so
// they are not offered here (client revision 4); the filters fit one row. Labels belong to one Space too:
// the label filter appears once a single Space is chosen. The selection survives filter changes.
useHead({ title: 'All Tasks · Masar' })
const route = useRoute()
// Active Tasks by default (Open, Working, Pending Review, Changes Required, Overdue); choosing a Status
// shows any status (client revision 6, R7, 2026-11-01; reverses the Oct 2026 "all Tasks" default).
const SORTS: TaskSort[] = ['recently_updated', 'created']
const { filters, setQuery, activeCount, clearFilters } = useTaskFilters({ sort: 'recently_updated' }, SORTS)
const { data: tasks, status, error, refresh } = useMyWork(filters)
const { data: spaces } = useSpaceList('mine')
const mySpaces = computed(() => (spaces.value ?? []).filter(space => space.role))
const scope = computed(() => filters.value.spaces ?? [])
const singleSpace = computed(() => (scope.value.length === 1 ? scope.value[0]! : null))
const { data: labels } = useSpaceLabels(singleSpace)
const { data: owners } = useTaskOwners(() => ({ spaces: scope.value }))
const { data: assignees } = useTaskAssignees(() => ({ spaces: scope.value }))
const { data: manageable } = useManageableBatches()
const controller = useTaskListController(tasks, { persistentSelection: true })
// "sprint" is the value of links made while Batches were called Sprints (client revision 4, reverted
// 2026-10-31).
const grouped = computed(() => route.query.group === 'batch' || route.query.group === 'sprint')

const { activeTask, openTask: showTask, closeTask } = useTaskPanel()
const createBatchOpen = ref(false)

function openTask(task: TaskListRow) {
  showTask(task.name)
}
defineShortcuts({ escape: () => { if (controller.selected.value.size && !activeTask.value) controller.clearSelection() } })
</script>

<template>
  <UDashboardPanel id="all-tasks" :ui="{ body: 'p-0 sm:p-0 gap-0' }">
    <template #header>
      <UDashboardNavbar title="All Tasks">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <span v-if="tasks?.length" class="text-sm text-muted">{{ tasks.length }} {{ tasks.length === 1 ? 'task' : 'tasks' }}</span>
          <UButton v-if="manageable?.permissions.canCreate" icon="i-lucide-plus" label="New Batch" color="neutral" variant="outline" @click="createBatchOpen = true" />
          <NotificationBell placement="navbar" class="lg:hidden" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Phones (iPhone stabilization 2026-10-30, client decision): the page scrolls as one, filters and
           Task rows together; nothing hides or snaps on scroll. Wider screens keep the filters above a
           list that scrolls by itself. -->
      <div class="flex flex-col list-scroll:h-full list-scroll:min-h-0">
        <div class="shrink-0" data-testid="task-filters">
          <div>
            <TaskFilterBar
              :filters="filters"
              :labels="singleSpace ? (labels ?? []) : undefined"
              single-row
              :spaces="mySpaces"
              :owners="owners ?? []"
              :assignees="assignees ?? []"
              show-mine
              groupable
              :grouped="grouped"
              :sorts="SORTS"
              :active-count="activeCount"
              @set="setQuery"
              @clear="clearFilters"
            />
          </div>
        </div>
        <BulkBar :tasks="controller.selectedTasks.value" :total="tasks?.length ?? 0" @clear="controller.clearSelection()" @select-all="controller.selectAllVisible()" />
        <p v-if="controller.hiddenSelectedCount.value" class="border-b border-default bg-focus-tint px-5 py-2 text-sm text-highlighted" role="status">
          {{ controller.hiddenSelectedCount.value }} selected {{ controller.hiddenSelectedCount.value === 1 ? 'task is' : 'tasks are' }} hidden by the current filters and still selected.
        </p>

        <div class="flex flex-col gap-4 p-4 list-scroll:min-h-0 list-scroll:flex-1 list-scroll:overflow-y-auto sm:p-5">
          <div class="flex min-w-0 flex-col gap-4 list-scroll:min-h-0 list-scroll:flex-1">
            <div v-if="status === 'pending' && !tasks?.length" class="space-y-2">
              <USkeleton v-for="i in 6" :key="i" class="h-12" />
            </div>
            <StatePanel v-else-if="error && !tasks?.length" tone="error" icon="i-lucide-cloud-off" title="Tasks could not be loaded" :description="error.message">
              <UButton label="Try again" @click="refresh()" />
            </StatePanel>
            <BatchBoard
              v-else-if="grouped"
              :tasks="tasks ?? []"
              :controller="controller"
              :active-task="activeTask"
              :batch-filter="filters.batch"
              :scroll-key="`all-tasks:${JSON.stringify(filters)}`"
              page-scroll
              :empty-hint="activeCount ? 'No tasks outside a Batch match these filters.' : 'Every task is in a Batch.'"
              @open="openTask"
              @filter="(batch) => setQuery({ batch })"
              @refresh="refresh()"
            />
            <StatePanel v-else-if="!tasks?.length" icon="i-lucide-search-x" :title="activeCount ? 'No tasks match these filters' : 'No open tasks in your Spaces'">
              <UButton v-if="activeCount" color="neutral" variant="outline" label="Clear filters" @click="clearFilters()" />
            </StatePanel>
            <div v-else class="overflow-hidden rounded-card border border-default bg-default list-scroll:h-full list-scroll:min-h-[24rem]">
              <TaskList
                page-scroll
                :tasks="tasks ?? []"
                :drafts="[]"
                :active-task="activeTask"
                :can-create="false"
                :can-edit="true"
                :selected="controller.selected.value"
                :expanded="controller.expanded.value"
                :show-due="false"
                :scroll-key="`all-tasks:${JSON.stringify(filters)}`"
                @open="openTask"
                @status="(task, status) => controller.setStatus(task, status, true)"
                @select="controller.select"
                @expand="controller.toggleExpand"
                @attribute="(task, field) => controller.toggleAttribute(task, field, true)"
                @action-done="controller.setActionDone"
              />
            </div>
          </div>
        </div>
        <TaskPanel :task-name="activeTask" @close="closeTask" />
        <CreateBatchModal v-model:open="createBatchOpen" />
      </div>
    </template>
  </UDashboardPanel>
</template>
