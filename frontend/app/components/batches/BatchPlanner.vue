<script setup lang="ts">
import type { BatchDetail, TaskListRow } from '~/types/api'
import { toggleSelection } from '~/utils/selection'

// Cross-Space planning (ADR-046): browse open tasks Space by Space (only Spaces you manage), pick
// tasks from several Spaces — the selection survives switching Space — and add them in one request.
const props = defineProps<{ batch: BatchDetail }>()
const { data: spaces } = useSpaceList('mine')
const managed = computed(() => (spaces.value ?? []).filter(s => s.role === 'Manager' && s.status !== 'Closed'))
const space = ref<string | undefined>()
watch(managed, (list) => { if (!space.value && list.length) space.value = list[0]!.name }, { immediate: true })

const q = ref('')
const feature = ref('any')
const release = ref('any')
const unbatchedOnly = ref(true)
const { data: features } = useFeatures(space)
const { data: releases } = useReleases(space)
watch(space, () => { feature.value = 'any'; release.value = 'any' })

const candidates = ref<TaskListRow[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
let request = 0
watch([space, q, feature, release, unbatchedOnly], () => {
  clearTimeout(timer)
  timer = setTimeout(load, 200)
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(timer))

async function load() {
  if (!space.value) return
  const id = ++request
  loading.value = true
  loadError.value = null
  try {
    const rows = await searchPlanningCandidates(space.value, {
      q: q.value.trim() || null,
      feature: feature.value === 'any' ? null : feature.value,
      release: release.value === 'any' ? null : release.value,
      batch: unbatchedOnly.value ? 'none' : null
    })
    if (id === request) candidates.value = rows.filter(t => t.batch?.name !== props.batch.name)
  } catch (caught) {
    if (id === request) loadError.value = (caught as Error).message
  } finally {
    if (id === request) loading.value = false
  }
}

// Selection by task name across Spaces; rows are remembered so they can be sent together.
const chosen = ref<Map<string, TaskListRow>>(new Map())
const anchor = ref<string | null>(null)
const chosenNames = computed(() => new Set(chosen.value.keys()))
function select(task: TaskListRow, range: boolean) {
  const visible = candidates.value.map(t => t.name)
  const result = toggleSelection(chosenNames.value, visible, task.name, anchor.value, range)
  const next = new Map<string, TaskListRow>()
  for (const name of result.selected) next.set(name, chosen.value.get(name) ?? candidates.value.find(t => t.name === name)!)
  chosen.value = next
  anchor.value = result.anchor
}
const chosenSpaces = computed(() => new Set([...chosen.value.values()].map(t => t.space)).size)

const { moveTasks } = useBatchMutations()
const toast = useToast()
async function add() {
  const tasks = [...chosen.value.values()]
  try {
    const result = await moveTasks.execute({ tasks, batch: props.batch.name })
    toast.add({ title: `${result.changed.length} task${result.changed.length === 1 ? '' : 's'} added to ${props.batch.batchName}`, color: 'success', icon: 'i-lucide-check' })
    chosen.value = new Map()
    await load()
  } catch (caught) {
    if ((caught as { kind?: string }).kind === 'conflict') {
      toast.add({ title: 'Some tasks changed Batch meanwhile', description: 'The list was refreshed. Review and try again.', color: 'warning', icon: 'i-lucide-git-compare' })
      chosen.value = new Map()
      await load()
    }
  }
}

const spaceItems = computed(() => managed.value.map(s => ({ label: s.title, value: s.name })))
const featureItems = computed(() => [{ label: 'Any Feature', value: 'any' }, { label: 'No Feature', value: 'none' }, ...(features.value?.items ?? []).map(f => ({ label: f.title, value: f.name }))])
const releaseItems = computed(() => [{ label: 'Any Release', value: 'any' }, { label: 'No Release', value: 'none' }, ...(releases.value?.items ?? []).map(r => ({ label: r.releaseName, value: r.name }))])
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex flex-col gap-2 border-b border-default px-3 py-2 sm:px-4">
      <div class="flex flex-wrap items-center gap-2">
        <USelect v-model="space" :items="spaceItems" size="sm" class="w-52" aria-label="Space" placeholder="Choose a Space" />
        <UInput v-model="q" icon="i-lucide-search" placeholder="Search open tasks" size="sm" class="w-full sm:w-56" aria-label="Search open tasks" />
        <USelect v-model="feature" :items="featureItems" size="sm" class="w-40" aria-label="Filter by Feature" />
        <USelect v-model="release" :items="releaseItems" size="sm" class="w-40" aria-label="Filter by Release" />
        <USwitch v-model="unbatchedOnly" label="Only tasks without a Batch" size="sm" />
      </div>
      <div class="flex flex-wrap items-center gap-2" aria-live="polite">
        <span class="text-sm" :class="chosen.size ? 'font-medium text-highlighted' : 'text-muted'">
          {{ chosen.size ? `${chosen.size} selected from ${chosenSpaces} Space${chosenSpaces === 1 ? '' : 's'}` : 'Select tasks, switch Space to add more, then add them together.' }}
        </span>
        <UButton v-if="chosen.size" size="xs" variant="link" color="neutral" label="Clear selection" @click="chosen = new Map()" />
        <UButton class="ms-auto" size="sm" icon="i-lucide-calendar-plus" :label="`Add ${chosen.size || ''} to Batch`.replace('  ', ' ')" :disabled="!chosen.size" :loading="moveTasks.pending.value" @click="add" />
      </div>
    </div>
    <div class="relative min-h-0 flex-1">
      <StatePanel v-if="!managed.length" icon="i-lucide-shield" title="You manage no open Space" description="Only Space Managers plan tasks into Batches." />
      <StatePanel v-else-if="loadError" tone="error" icon="i-lucide-cloud-off" title="Tasks could not be loaded" :description="loadError">
        <UButton label="Try again" @click="load()" />
      </StatePanel>
      <div v-else-if="loading && !candidates.length" class="space-y-px">
        <USkeleton v-for="i in 6" :key="i" class="h-11 rounded-none" />
      </div>
      <StatePanel v-else-if="!candidates.length" icon="i-lucide-search-x" title="No matching open tasks" description="Change the Space or the filters." />
      <TaskList
        v-else
        :tasks="candidates"
        :drafts="[]"
        :active-task="null"
        :can-create="false"
        :can-edit="false"
        :selected="chosenNames"
        :expanded="{}"
        @open="(task) => select(task, false)"
        @select="select"
      />
    </div>
  </div>
</template>
