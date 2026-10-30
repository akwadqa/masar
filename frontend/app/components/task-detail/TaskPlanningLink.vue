<script setup lang="ts">
import type { TaskDetail } from '~/types/api'
import type { TaskEditor } from '~/composables/workspace/useTaskEditor'

// Feature or Release of a Task as an icon in the Task header (client revision 3): Features and
// Releases are not used on every Task, so there is no "No Feature" chip. The icon is highlighted
// when the Task has one; clicking it shows the current one and lets editors choose another or remove
// it. Only the Task's own Space is offered (ADR-034); archived Releases accept no new Tasks (ADR-036).
const props = defineProps<{ kind: 'feature' | 'release', task: TaskDetail, editor: TaskEditor }>()
const open = ref(false)
const query = ref('')
const editable = computed(() => props.editor.editable.value)
const { data: features } = useFeatures(() => (props.kind === 'feature' ? props.task.space : null))
const { data: releases } = useReleases(() => (props.kind === 'release' ? props.task.space : null))

const label = computed(() => (props.kind === 'feature' ? 'Feature' : 'Release'))
const icon = computed(() => (props.kind === 'feature' ? 'i-lucide-map' : 'i-lucide-package'))
const current = computed(() => props.task[props.kind])
const frozen = computed(() => props.kind === 'release' && props.task.release?.status === 'Archived')
const options = computed(() => {
  const term = query.value.trim().toLowerCase()
  const all = props.kind === 'feature'
    ? (features.value?.items ?? []).map(f => ({ name: f.name, title: f.title, meta: f.roadmap }))
    : (releases.value?.items ?? []).filter(r => r.status !== 'Archived').map(r => ({ name: r.name, title: r.releaseName, meta: r.status }))
  return term ? all.filter(o => o.title.toLowerCase().includes(term)) : all
})
watch(open, (value) => { if (!value) query.value = '' })

function choose(name: string | null) {
  open.value = false
  if (name !== (current.value?.name ?? null)) void props.editor.save({ [props.kind]: name })
}
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'end' }">
    <UButton
      :icon="icon"
      :color="current ? 'primary' : 'neutral'"
      :variant="current ? 'soft' : 'ghost'"
      square
      :title="current ? `${label}: ${current.title}` : `No ${label}`"
      :aria-label="current ? `${label}: ${current.title}` : `${label}: none. Choose a ${label}`"
      :data-testid="`task-${kind}`"
    />
    <template #content>
      <div class="flex w-80 flex-col gap-2 p-3">
        <div class="flex items-center gap-2 text-sm">
          <span class="text-muted">{{ label }}</span>
          <ULink v-if="current" :to="`/${kind === 'feature' ? 'features' : 'releases'}/${current.name}`" class="min-w-0 truncate font-medium text-primary">{{ current.title }}</ULink>
          <span v-else class="text-muted">None</span>
        </div>
        <p v-if="frozen" class="text-xs text-muted">This Release is archived. Restore it to change the task's Release.</p>
        <template v-else-if="editable">
          <USeparator />
          <UInput v-model="query" icon="i-lucide-search" :placeholder="`Find a ${label}`" :aria-label="`Find a ${label}`" autofocus />
          <ul class="flex max-h-64 flex-col gap-0.5 overflow-y-auto" :aria-label="`${label}s of this Space`">
            <li v-for="option in options" :key="option.name">
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-(--ui-radius) px-2 py-1.5 text-start text-sm hover:bg-elevated"
                :class="option.name === current?.name ? 'font-medium text-highlighted' : 'text-default'"
                :aria-pressed="option.name === current?.name"
                @click="choose(option.name)"
              >
                <UIcon :name="option.name === current?.name ? 'i-lucide-check' : icon" class="size-4 shrink-0" :class="option.name === current?.name ? 'text-primary' : 'text-dimmed'" />
                <span class="min-w-0 flex-1 truncate">{{ option.title }}</span>
                <span class="shrink-0 text-xs text-muted">{{ option.meta }}</span>
              </button>
            </li>
            <li v-if="!options.length" class="px-2 py-1.5 text-sm text-muted">No {{ label }}s match.</li>
          </ul>
          <UButton v-if="current" icon="i-lucide-x" color="neutral" variant="ghost" :label="`Remove from ${label}`" class="self-start" @click="choose(null)" />
        </template>
      </div>
    </template>
  </UPopover>
</template>
