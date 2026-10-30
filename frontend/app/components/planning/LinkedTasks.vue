<script setup lang="ts">
import type { Page, TaskListFilters, TaskListRow } from '~/types/api'

// Tasks linked to a Feature or Release (server-side filter on the Space Task List). Members who can
// edit tasks may link existing open tasks of the same Space that have no Feature / Release yet.
const props = defineProps<{ space: string, filter: 'feature' | 'release', value: string, canLink: boolean }>()
const filters = computed<TaskListFilters>(() => ({
  completed: 'all', assignedToMe: false, ownedByMe: false, sort: 'manual', [props.filter]: props.value
}))
const { data: tasks, status } = useTaskList(() => props.space, filters)
const query = computed(() => `${props.filter}=${encodeURIComponent(props.value)}&show=all`)

const api = useMasarApi()
const { update } = useTaskMutations()
const toast = useToast()
const searchTerm = ref('')
const candidates = ref<TaskListRow[]>([])
const searching = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
watch(searchTerm, (term) => {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    searching.value = true
    try {
      const page = await api.get<Page<TaskListRow>>('masar.api.tasks.list', {
        space: props.space, completed: 'open', [props.filter]: 'none', q: term.trim() || undefined, sort: 'recently_updated', limit: 20
      })
      candidates.value = page.items
    } catch {
      candidates.value = []
    } finally {
      searching.value = false
    }
  }, 200)
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))
const candidateItems = computed(() => candidates.value.map(t => ({ label: t.title, value: t.name })))

async function link(name: string | undefined) {
  const task = candidates.value.find(t => t.name === name)
  if (!task) return
  try {
    await update.execute({ task, changes: { [props.filter]: props.value } })
    candidates.value = candidates.value.filter(t => t.name !== name)
    toast.add({ title: 'Task added', description: task.title, color: 'success', icon: 'i-lucide-check' })
  } catch { /* the mutation already reported the error */ }
}
</script>

<template>
  <section class="space-y-2" aria-labelledby="linked-tasks">
    <div class="flex items-center gap-2">
      <h3 id="linked-tasks" class="text-sm font-semibold text-highlighted">Tasks</h3>
      <UBadge color="neutral" variant="subtle" size="sm" :label="String(tasks?.length ?? 0)" />
      <UButton class="ms-auto" size="xs" variant="link" color="neutral" :to="`/spaces/${space}/tasks?${query}`" label="Open in Task List" trailing-icon="i-lucide-arrow-right" />
    </div>
    <USelectMenu
      v-if="canLink"
      v-model:search-term="searchTerm"
      :items="candidateItems"
      value-key="value"
      :model-value="undefined"
      ignore-filter
      :loading="searching"
      icon="i-lucide-plus"
      placeholder="Add an existing task…"
      :search-input="{ placeholder: 'Search open tasks of this Space' }"
      class="w-full"
      aria-label="Add an existing task"
      data-testid="link-task"
      @update:model-value="(value: string) => link(value)"
    >
      <template #empty>
        {{ searching ? 'Searching…' : 'No open tasks without a ' + (filter === 'feature' ? 'Feature' : 'Release') }}
      </template>
    </USelectMenu>
    <div v-if="status === 'pending' && !tasks?.length" class="space-y-1">
      <USkeleton v-for="i in 3" :key="i" class="h-8" />
    </div>
    <p v-else-if="!tasks?.length" class="rounded-md border border-dashed border-default p-4 text-center text-sm text-muted">
      No tasks yet. Choose this {{ filter === 'feature' ? 'Feature' : 'Release' }} on a task, or select tasks in the Task List and use bulk actions.
    </p>
    <ul v-else class="divide-y divide-default rounded-md border border-default">
      <li v-for="task in tasks" :key="task.name">
        <ULink :to="`/tasks/${task.name}`" class="flex items-center gap-2 px-3 py-2 text-sm hover:bg-elevated/50">
          <UIcon :name="task.isCompleted ? 'i-lucide-circle-check-big' : 'i-lucide-circle'" class="size-4 shrink-0" :class="task.isCompleted ? 'text-primary' : 'text-dimmed'" />
          <span class="sr-only">{{ task.isCompleted ? 'Completed:' : 'Open:' }}</span>
          <span class="min-w-0 flex-1 truncate" :class="task.isCompleted ? 'text-muted line-through' : 'text-highlighted'">{{ task.title }}</span>
          <UAvatarGroup v-if="task.assignees.length" size="2xs" :max="2">
            <UserAvatar v-for="person in task.assignees" :key="person.name" :user="person" />
          </UAvatarGroup>
        </ULink>
      </li>
    </ul>
  </section>
</template>
