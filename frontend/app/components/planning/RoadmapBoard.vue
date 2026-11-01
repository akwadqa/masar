<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { VueDraggable } from 'vue-draggable-plus'
import type { Feature, RoadmapColumn } from '~/types/api'
import { ROADMAP_COLUMNS } from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'
import { stepOrder } from '~/utils/roadmap'

// Roadmap Kanban (ADR-038). Drag and drop moves Features between and within columns; every move is
// also available from the card menu and from the keyboard (Alt+←/→ column, Alt+↑/↓ position).
const props = defineProps<{ space: string, features: Feature[], canManage: boolean, activeFeature: string | null, reorderPaused?: boolean }>()
const emit = defineEmits<{ open: [feature: Feature], create: [roadmap: RoadmapColumn] }>()

const { move } = useFeatureMutations()
const toast = useToast()
const announcement = ref('')

// Each lane has its own tint (theme tokens --masar-lane-*), so columns read at a glance in every theme.
const columnMeta: Record<RoadmapColumn, { icon: string, hint: string, lane: string, accent: string }> = {
  Now: { icon: 'i-lucide-flame', hint: 'Being delivered', lane: 'bg-lane-now/8', accent: 'text-lane-now' },
  Next: { icon: 'i-lucide-arrow-right-circle', hint: 'Up next', lane: 'bg-lane-next/8', accent: 'text-lane-next' },
  Later: { icon: 'i-lucide-telescope', hint: 'Considered', lane: 'bg-lane-later/8', accent: 'text-lane-later' },
  Done: { icon: 'i-lucide-circle-check-big', hint: 'Delivered', lane: 'bg-lane-done/8', accent: 'text-lane-done' }
}

// Local column arrays for the drag library; re-synced from the server-confirmed list.
const columns = reactive<Record<RoadmapColumn, Feature[]>>({ Now: [], Next: [], Later: [], Done: [] })
function sync() {
  for (const column of ROADMAP_COLUMNS) columns[column] = props.features.filter(f => f.roadmap === column)
}
watch(() => props.features, sync, { immediate: true, deep: true })

const pendingDone = ref<{ feature: Feature, order: string[] } | null>(null)

async function commitMove(feature: Feature, roadmap: RoadmapColumn, order: string[], confirmed = false) {
  if (roadmap === 'Done' && feature.roadmap !== 'Done' && feature.progress.open > 0 && !confirmed) {
    pendingDone.value = { feature, order }
    return
  }
  try {
    await move.execute({ feature, roadmap, columnOrder: order })
    const position = order.indexOf(feature.name) + 1
    announcement.value = `${feature.title} moved to ${roadmap}, position ${position} of ${order.length}.`
  } catch (caught) {
    sync()
    if ((caught as MasarApiError).kind === 'conflict') {
      toast.add({ title: 'The roadmap changed', description: 'Someone else moved this Feature. The roadmap was refreshed.', color: 'warning', icon: 'i-lucide-git-compare' })
      await invalidateQueries(`features:${props.space}`)
    }
  }
}

function confirmDone() {
  const pending = pendingDone.value
  pendingDone.value = null
  if (pending) void commitMove(pending.feature, 'Done', pending.order, true)
}
function cancelDone() {
  pendingDone.value = null
  sync()
}

function onDragEnd(event: { item: HTMLElement, to: HTMLElement }) {
  const name = event.item.dataset.feature
  const roadmap = event.to.dataset.column as RoadmapColumn | undefined
  const feature = props.features.find(f => f.name === name)
  if (!feature || !roadmap) return
  void nextTick(() => {
    const order = columns[roadmap].map(f => f.name)
    const before = props.features.filter(f => f.roadmap === roadmap).map(f => f.name)
    if (feature.roadmap === roadmap && order.join() === before.join()) return
    void commitMove(feature, roadmap, order)
  })
}

/** Menu / keyboard move: to another column (appended at the end) or one step within the column. */
function moveTo(feature: Feature, roadmap: RoadmapColumn) {
  if (roadmap === feature.roadmap) return
  const order = [...columns[roadmap].map(f => f.name), feature.name]
  void commitMove(feature, roadmap, order)
}
function moveBy(feature: Feature, delta: -1 | 1) {
  const order = stepOrder(columns[feature.roadmap].map(f => f.name), feature.name, delta)
  if (order) void commitMove(feature, feature.roadmap, order)
}

function menuItems(feature: Feature): DropdownMenuItem[][] {
  const index = columns[feature.roadmap].findIndex(f => f.name === feature.name)
  return [
    ROADMAP_COLUMNS.filter(c => c !== feature.roadmap).map(c => ({
      label: `Move to ${c}`, icon: columnMeta[c].icon, onSelect: () => moveTo(feature, c)
    })),
    [
      { label: 'Move up', icon: 'i-lucide-arrow-up', kbds: ['alt', 'arrowup'], disabled: !!props.reorderPaused || index <= 0, onSelect: () => moveBy(feature, -1) },
      { label: 'Move down', icon: 'i-lucide-arrow-down', kbds: ['alt', 'arrowdown'], disabled: !!props.reorderPaused || index >= columns[feature.roadmap].length - 1, onSelect: () => moveBy(feature, 1) }
    ]
  ]
}

function onCardKeydown(event: KeyboardEvent, feature: Feature) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('open', feature)
    return
  }
  if (!props.canManage || !event.altKey) return
  const columnIndex = ROADMAP_COLUMNS.indexOf(feature.roadmap)
  const handlers: Record<string, () => void> = {
    ArrowUp: () => { if (!props.reorderPaused) moveBy(feature, -1) },
    ArrowDown: () => { if (!props.reorderPaused) moveBy(feature, 1) },
    ArrowLeft: () => { if (columnIndex > 0) moveTo(feature, ROADMAP_COLUMNS[columnIndex - 1]!) },
    ArrowRight: () => { if (columnIndex < ROADMAP_COLUMNS.length - 1) moveTo(feature, ROADMAP_COLUMNS[columnIndex + 1]!) }
  }
  const handler = handlers[event.key]
  if (handler) {
    event.preventDefault()
    handler()
    // Keep keyboard focus on the moved card once it re-renders in its new place.
    void nextTick(() => setTimeout(() => document.querySelector<HTMLElement>(`[data-feature="${feature.name}"]`)?.focus(), 50))
  }
}
</script>

<template>
  <div class="flex flex-col">
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
    <p v-if="canManage" class="hidden px-4 pt-3 text-xs text-muted sm:block">
      Drag cards between columns, or focus a card and use <UKbd value="alt" size="sm" /> + arrow keys. The card menu offers the same moves.
    </p>
    <div class="flex flex-1 snap-x snap-mandatory gap-3 overflow-x-auto p-3 sm:p-4" role="region" aria-label="Roadmap">
      <section
        v-for="column in ROADMAP_COLUMNS"
        :key="column"
        class="flex w-[17.5rem] shrink-0 snap-start flex-col rounded-card border border-default sm:w-auto sm:min-w-[15rem] sm:flex-1"
        :class="columnMeta[column].lane"
        :aria-labelledby="`roadmap-${column}`"
        :data-testid="`roadmap-column-${column}`"
      >
        <header class="flex items-center gap-2 px-3 py-2.5">
          <UIcon :name="columnMeta[column].icon" class="size-4" :class="columnMeta[column].accent" />
          <h2 :id="`roadmap-${column}`" class="text-sm font-semibold text-highlighted">{{ column }}</h2>
          <UBadge color="neutral" variant="subtle" size="sm" :label="String(columns[column].length)" :aria-label="`${columns[column].length} Features`" />
          <span class="hidden text-xs text-muted lg:inline">{{ columnMeta[column].hint }}</span>
          <UButton
            v-if="canManage"
            class="ms-auto"
            icon="i-lucide-plus"
            size="xs"
            color="neutral"
            variant="ghost"
            square
            :aria-label="`New Feature in ${column}`"
            @click="emit('create', column)"
          />
        </header>
        <VueDraggable
          v-model="columns[column]"
          group="roadmap"
          :data-column="column"
          :disabled="!canManage || reorderPaused || move.pending.value"
          :animation="150"
          :delay="200"
          :delay-on-touch-only="true"
          ghost-class="opacity-40"
          role="list"
          :aria-label="`${column} Features`"
          class="flex min-h-24 flex-1 flex-col gap-2 p-2"
          @end="onDragEnd"
        >
          <article
            v-for="feature in columns[column]"
            :key="feature.name"
            :data-feature="feature.name"
            role="listitem"
            tabindex="0"
            class="group shrink-0 cursor-pointer overflow-hidden rounded-card border bg-default p-3 text-sm shadow-xs outline-none transition hover:-translate-y-px hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary motion-reduce:hover:translate-y-0"
            :class="[activeFeature === feature.name ? 'border-primary' : 'border-default', canManage ? 'active:cursor-grabbing' : '']"
            :aria-label="`${feature.title}, ${column}, ${feature.progress.total ? `${feature.progress.completed} of ${feature.progress.total} tasks completed` : 'no tasks'}`"
            @click="emit('open', feature)"
            @keydown="onCardKeydown($event, feature)"
          >
            <RoadmapCardContent :feature="feature" :column="column">
            <template #title>
            <div class="flex items-start gap-2">
              <p class="min-w-0 flex-1 font-semibold break-words text-highlighted">{{ feature.title }}</p>
              <UDropdownMenu v-if="canManage" :items="menuItems(feature)" :content="{ align: 'end' }">
                <UButton
                  icon="i-lucide-ellipsis"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  square
                  class="-me-1 -mt-1"
                  :aria-label="`Move ${feature.title}`"
                  @click.stop
                  @keydown.stop
                />
              </UDropdownMenu>
            </div>
            </template>
            </RoadmapCardContent>
          </article>
        </VueDraggable>
        <p v-if="!columns[column].length" class="px-3 pb-3 text-center text-xs text-muted">
          {{ canManage ? 'Drop a Feature here or add one.' : 'No Features.' }}
        </p>
      </section>
    </div>

    <UModal
      :open="!!pendingDone"
      title="Move to Done with open tasks?"
      :description="pendingDone ? `${pendingDone.feature.title} still has ${pendingDone.feature.progress.open} open task${pendingDone.feature.progress.open === 1 ? '' : 's'}. Moving it to Done does not complete them.` : ''"
      @update:open="(value: boolean) => { if (!value) cancelDone() }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="cancelDone" />
          <UButton color="primary" label="Move to Done" @click="confirmDone" />
        </div>
      </template>
    </UModal>
  </div>
</template>
