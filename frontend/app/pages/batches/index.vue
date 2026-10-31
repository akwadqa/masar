<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Batch, TaskListFilters, TaskListRow } from '~/types/api'
import { formatLongDate } from '~/utils/format'

// Batches (client revision 3): every current Batch as a box with its Task rows, as in All Tasks
// grouped by Batch. Rows move between Batches by drag and drop or "Add selected". Finished Batches
// stay below as history.
useHead({ title: 'Batches · Masar' })
const filters = computed<TaskListFilters>(() => ({ completed: 'all', assignedToMe: false, ownedByMe: false, batch: 'any', sort: 'manual' }))
const { data: tasks, status, error, refresh } = useMyWork(filters)
const { data: batches } = useBatchList(() => ({}))
const { data: finished } = useBatchList(() => ({ status: 'Finished' }))
const controller = useTaskListController(tasks, { persistentSelection: true })
const canCreate = computed(() => !!batches.value?.permissions.canCreate)
const current = computed(() => (batches.value?.items ?? []).filter(batch => batch.status !== 'Finished'))
const { activeTask, openTask: showTask, closeTask } = useTaskPanel()
const creating = ref(false)

function openTask(task: TaskListRow) {
  showTask(task.name)
}
const columns: TableColumn<Batch>[] = [
  { accessorKey: 'batchName', header: 'Batch' },
  { id: 'dates', header: 'Dates' },
  { id: 'progress', header: 'Your tasks' },
  { id: 'owner', header: 'Owner' }
]
</script>

<template>
  <UDashboardPanel id="batches" :ui="{ body: 'p-0 sm:p-0 gap-0' }">
    <template #header>
      <UDashboardNavbar title="Batches">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton v-if="canCreate" icon="i-lucide-plus" label="New Batch" @click="creating = true" />
          <NotificationBell placement="navbar" class="lg:hidden" />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <BulkBar :tasks="controller.selectedTasks.value" :total="tasks?.length ?? 0" @clear="controller.clearSelection()" @select-all="controller.selectAllVisible()" />
        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-5">
          <StatePanel v-if="error && !tasks?.length" tone="error" icon="i-lucide-cloud-off" title="Batches could not be loaded" :description="error.message">
            <UButton label="Try again" @click="refresh()" />
          </StatePanel>
          <div v-else-if="status === 'pending' && !tasks?.length" class="space-y-3">
            <USkeleton v-for="i in 3" :key="i" class="h-28" />
          </div>
          <StatePanel
            v-else-if="!current.length"
            icon="i-lucide-calendar-range"
            title="No current Batches"
            :description="canCreate ? 'Plan a one- or two-week Batch, then drag tasks into it from All Tasks.' : 'Batches that include tasks from your Spaces appear here.'"
          >
            <UButton v-if="canCreate" icon="i-lucide-plus" label="New Batch" @click="creating = true" />
          </StatePanel>
          <BatchBoard
            v-else
            :tasks="tasks ?? []"
            :controller="controller"
            :active-task="activeTask"
            batch-filter="any"
            scroll-key="batches"
            @open="openTask"
            @refresh="refresh()"
          />

          <section v-if="finished?.items.length" class="space-y-3" aria-labelledby="finished-heading">
            <h2 id="finished-heading" class="text-section text-highlighted">Finished Batches</h2>
            <div class="overflow-x-auto rounded-card border border-default">
              <UTable :data="finished.items" :columns="columns" class="min-w-[40rem]" :ui="{ td: 'py-2.5', th: 'py-2.5' }">
                <template #batchName-cell="{ row }">
                  <ULink :to="`/batches/${row.original.name}`" class="font-medium text-highlighted hover:underline">{{ row.original.batchName }}</ULink>
                </template>
                <template #dates-cell="{ row }">
                  <span class="tabular-nums text-muted">{{ formatLongDate(row.original.startDate) }} – {{ formatLongDate(row.original.endDate) }}</span>
                </template>
                <template #progress-cell="{ row }">
                  <BatchProgress :progress="row.original.progress" compact class="w-40" />
                </template>
                <template #owner-cell="{ row }">
                  <span class="text-muted">{{ row.original.isOwner ? 'You' : row.original.owner.fullName }}</span>
                </template>
              </UTable>
            </div>
          </section>
        </div>
        <TaskPanel :task-name="activeTask" @close="closeTask" />
      </div>
      <CreateBatchModal v-model:open="creating" @created="(name) => navigateTo(`/batches/${name}`)" />
    </template>
  </UDashboardPanel>
</template>
