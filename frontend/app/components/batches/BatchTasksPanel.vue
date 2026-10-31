<script setup lang="ts">
import type { BatchDetail, TaskListRow } from '~/types/api'

// Current tasks of a Planned/Active Batch that the viewer may see, with the shared list, selection,
// bulk bar (complete, priority, move to another Batch, remove) and task panel.
const props = defineProps<{ batch: BatchDetail }>()
const q = ref('')
const filters = computed(() => ({ q: q.value.trim() || null }))
const { data: tasks, status, error, refresh } = useBatchTasks(() => props.batch.name, filters)
const controller = useTaskListController(tasks)
const { activeTask, openTask: showTask, closeTask } = useTaskPanel()
defineShortcuts({ escape: () => { if (controller.selected.value.size && !activeTask.value) controller.clearSelection() } })
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex flex-wrap items-center gap-2 border-b border-default px-3 py-2 sm:px-4">
      <UInput v-model="q" icon="i-lucide-search" placeholder="Search this Batch" size="sm" class="w-full sm:w-56" aria-label="Search this Batch" />
      <span class="text-xs text-muted">Showing tasks from your Spaces.</span>
    </div>
    <BulkBar :tasks="controller.selectedTasks.value" :total="tasks?.length ?? 0" @clear="controller.clearSelection()" @select-all="controller.selectAllVisible()" />
    <div class="relative min-h-0 flex-1">
      <div v-if="status === 'pending' && !tasks?.length" class="space-y-px">
        <USkeleton v-for="i in 6" :key="i" class="h-11 rounded-none" />
      </div>
      <StatePanel v-else-if="error && !tasks?.length" tone="error" icon="i-lucide-cloud-off" title="Tasks could not be loaded" :description="error.message">
        <UButton label="Try again" @click="refresh()" />
      </StatePanel>
      <StatePanel
        v-else-if="!tasks?.length"
        icon="i-lucide-list-plus"
        :title="q ? 'No tasks match' : 'No tasks you can see'"
        :description="batch.canManage && !q ? 'Use “Add tasks” to plan work from the Spaces you manage.' : undefined"
      />
      <TaskList
        v-else
        :tasks="tasks ?? []"
        :drafts="[]"
        :active-task="activeTask"
        :can-create="false"
        :can-edit="true"
        :selected="controller.selected.value"
        :expanded="controller.expanded.value"
        :scroll-key="`batch:${batch.name}`"
        @open="(task: TaskListRow) => showTask(task.name)"
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
