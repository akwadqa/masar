<script setup lang="ts">
import type { SpaceSummary, TaskSearchResult } from '~/types/api'
import { statusStyle } from '~/utils/taskStatus'

// Sidebar search (client revision 2): results appear right below the field while typing, without a
// dialog. Spaces are matched instantly in the browser; Tasks are searched on the server (only the
// user's Spaces) from two characters. Arrow keys move through results, Enter opens, Escape clears.
const props = defineProps<{ spaces: SpaceSummary[] }>()
const emit = defineEmits<{ active: [value: boolean] }>()

const term = ref('')
const tasks = ref<TaskSearchResult[]>([])
const searching = ref(false)
const highlighted = ref(0)
const input = ref<{ inputRef?: HTMLInputElement } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
let requestId = 0

const trimmed = computed(() => term.value.trim())
const spaceResults = computed(() => {
  const needle = trimmed.value.toLowerCase()
  return needle ? props.spaces.filter(space => space.role && space.title.toLowerCase().includes(needle)).slice(0, 5) : []
})
const results = computed(() => [
  ...spaceResults.value.map(space => ({ key: `space-${space.name}`, to: `/spaces/${space.name}/tasks`, space, task: null })),
  ...tasks.value.map(task => ({ key: `task-${task.name}`, to: `/tasks/${task.name}`, space: null, task }))
])
watch(trimmed, (value) => {
  emit('active', !!value)
  highlighted.value = 0
  clearTimeout(timer)
  if (value.length < 2) {
    tasks.value = []
    searching.value = false
    return
  }
  searching.value = true
  timer = setTimeout(async () => {
    const id = ++requestId
    try {
      const found = await searchTasks(value)
      if (id === requestId) tasks.value = found.slice(0, 8)
    } catch {
      if (id === requestId) tasks.value = []
    } finally {
      if (id === requestId) searching.value = false
    }
  }, 150)
})
onBeforeUnmount(() => clearTimeout(timer))

function go(to: string) {
  term.value = ''
  void navigateTo(to)
}
function onKeydown(event: KeyboardEvent) {
  const count = results.value.length
  if (event.key === 'ArrowDown' && count) {
    event.preventDefault()
    highlighted.value = (highlighted.value + 1) % count
  } else if (event.key === 'ArrowUp' && count) {
    event.preventDefault()
    highlighted.value = (highlighted.value - 1 + count) % count
  } else if (event.key === 'Enter' && count) {
    event.preventDefault()
    go(results.value[highlighted.value]!.to)
  } else if (event.key === 'Escape') {
    term.value = ''
  }
}

// ⌘K / Ctrl+K focuses the search everywhere, also in fields and while the Task panel is open
// (capture phase: the open slide-over stops keydown propagation).
function onShortcut(event: KeyboardEvent) {
  if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
    event.preventDefault()
    input.value?.inputRef?.focus()
    input.value?.inputRef?.select()
  }
}
onMounted(() => document.addEventListener('keydown', onShortcut, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onShortcut, true))
defineExpose({ focus: () => input.value?.inputRef?.focus() })
</script>

<template>
  <div class="flex flex-col gap-1">
    <UInput
      ref="input"
      v-model="term"
      icon="i-lucide-search"
      placeholder="Search…"
      class="w-full"
      aria-label="Find tasks and Spaces"
      role="combobox"
      :aria-expanded="!!trimmed"
      aria-controls="sidebar-search-results"
      :aria-activedescendant="trimmed && results.length ? `sidebar-result-${highlighted}` : undefined"
      @keydown="onKeydown"
    >
      <template #trailing>
        <UButton v-if="term" icon="i-lucide-x" color="neutral" variant="link" size="sm" class="p-0.5" aria-label="Clear search" @click="term = ''" />
        <span v-else class="flex gap-0.5"><UKbd value="meta" variant="soft" /><UKbd value="k" variant="soft" /></span>
      </template>
    </UInput>
    <div v-if="trimmed" id="sidebar-search-results" role="listbox" aria-label="Search results" class="flex flex-col gap-0.5 py-1">
      <p v-if="spaceResults.length" class="px-3 pt-1 text-xs font-medium text-muted">Spaces</p>
      <template v-for="(result, index) in results" :key="result.key">
        <p v-if="result.task && index === spaceResults.length" class="px-3 pt-2 text-xs font-medium text-muted">Tasks</p>
        <NuxtLink
          :id="`sidebar-result-${index}`"
          :to="result.to"
          role="option"
          :aria-selected="highlighted === index"
          class="flex items-center gap-2.5 rounded-pill px-3 py-2 text-sm"
          :class="highlighted === index ? 'bg-elevated text-highlighted' : 'text-default hover:bg-elevated'"
          @click="term = ''"
          @mouseenter="highlighted = index"
        >
          <SpaceIcon v-if="result.space" :space="result.space" size="sm" />
          <UIcon v-else-if="result.task" :name="statusStyle(result.task.status).icon" class="size-4 shrink-0" :class="statusStyle(result.task.status).text" />
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ result.space?.title ?? result.task?.title }}</span>
            <span v-if="result.task" class="block truncate text-xs text-muted">{{ result.task.spaceTitle }} · {{ result.task.status }}</span>
          </span>
        </NuxtLink>
      </template>
      <p v-if="searching" class="flex items-center gap-2 px-3 py-2 text-sm text-muted">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" /> Searching tasks…
      </p>
      <p v-else-if="!results.length" class="px-3 py-2 text-sm text-muted">
        {{ trimmed.length < 2 ? 'Keep typing to search tasks.' : 'Nothing found.' }}
      </p>
    </div>
  </div>
</template>
