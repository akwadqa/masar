<script setup lang="ts">
import type { SpaceDetail, TaskListRow } from '~/types/api'
import { useMediaQuery } from '@vueuse/core'
import type { FilterPanelKind } from '~/composables/workspace/useFilterPanel'
import { COMPOSER_SLOT } from '~/utils/pageScroll'

const props = defineProps<{ space: SpaceDetail }>()

const route = useRoute()
// Every Task by default, completed included (client request, Oct 2026); the Status filter narrows it.
const { filters, setQuery, activeCount, clearFilters } = useTaskFilters({ completed: 'all' })

const { data: tasks, status, error, refresh } = useTaskList(() => props.space.name, filters)
const { data: labels } = useSpaceLabels(() => props.space.name)
const { data: features } = useFeatures(() => props.space.name)
const { data: releases } = useReleases(() => props.space.name)
const { data: owners } = useTaskOwners(() => ({ space: props.space.name }))
const { data: assignees } = useTaskAssignees(() => ({ space: props.space.name }))
const { input, drafts, commit, retry, discard } = useInlineDrafts(() => props.space.name)
const controller = useTaskListController(tasks)

// Space lists offer Feature and Version boxes only (client revision 3); Batches are planned on All Tasks.
const panels: FilterPanelKind[] = ['feature', 'release']
const { openPanels, togglePanel, closePanel, panelItems, activeNames } = useTaskFilterPanels(panels, {
  features: () => features.value?.items,
  releases: () => releases.value?.items,
  batches: () => undefined
}, filters)

const canEdit = computed(() => props.space.permissions.canEditTasks)
const { activeTask, openTask: showTask, closeTask } = useTaskPanel()
const canCreate = computed(() => props.space.permissions.canCreateTasks)
// Inline drafts appear only where a new task would match the filters.
const showDrafts = computed(() => (canCreate.value && filtersAdmitNewTask(filters.value) ? drafts.value : []))

function openTask(task: TaskListRow) {
  showTask(task.name)
}

defineShortcuts({ escape: () => { if (controller.selected.value.size && !activeTask.value) controller.clearSelection() } })
const listRef = ref<{ focusCreate: () => void } | null>(null)
const composerSlot = ref<HTMLElement | null>(null)
provide(COMPOSER_SLOT, composerSlot)

// Phones (iPhone stabilization 2026-10-30, client decision): the page scrolls as one, so filters, open
// panels, Task rows and the composer move together; nothing hides or snaps on scroll. Wider screens
// keep the filters above a list that scrolls by itself.
// Features and Versions open independently (client request 2026-10-30). On phones the open panels sit
// below the filters, side by side when both are open; after opening or closing one, they are scrolled
// into view. Wider screens show them beside the list.
const phone = useMediaQuery('(max-width: 639px)')
const bothOpen = computed(() => openPanels.value.length > 1)
const besideList = computed(() => !phone.value && openPanels.value.length > 0)
const phonePanels = ref<HTMLElement | null>(null)
watch(() => openPanels.value.join(), () => {
  if (phone.value && openPanels.value.length) void nextTick(() => phonePanels.value?.scrollIntoView({ block: 'nearest' }))
})
</script>

<template>
  <!-- Phones: at least the screen's height, so a short list also keeps the composer at the bottom. -->
  <div class="flex flex-col page-scroll:grow list-scroll:h-full list-scroll:min-h-0">
    <div class="list-scroll:shrink-0" data-testid="task-filters">
      <div>
        <TaskFilterBar
          :filters="filters"
          :labels="labels ?? []"
          :owners="owners ?? []"
          :assignees="assignees ?? []"
          :panels="panels"
          :open-panels="openPanels"
          :active-names="activeNames"
          show-mine
          :sorts="['manual', 'recently_updated']"
          :active-count="activeCount"
          @set="setQuery"
          @clear="clearFilters"
          @toggle-panel="togglePanel"
        >
          <template #actions>
            <!-- Phones: the Plus icon alone in a 44 px square (client request 2026-10-30), named for assistive
                 technology; no tooltip, which would stay visible after a tap on iPhone. -->
            <UButton
              v-if="canCreate"
              class="ms-auto max-sm:size-11 max-sm:justify-center max-sm:p-0"
              icon="i-lucide-plus"
              label="New task"
              :aria-label="phone ? 'New task' : undefined"
              :ui="{ label: 'max-sm:hidden' }"
              @click="listRef?.focusCreate()"
            >
              <template #trailing>
                <UKbd value="c" variant="soft" class="hidden sm:inline-flex" />
              </template>
            </UButton>
          </template>
        </TaskFilterBar>
        <div
          v-if="phone && openPanels.length"
          ref="phonePanels"
          class="grid gap-2 border-b border-default p-4"
          :class="bothOpen ? 'grid-cols-2' : 'grid-cols-1'"
          data-testid="filter-panels"
        >
          <TaskFilterPanel
            v-for="kind in openPanels"
            :key="kind"
            :kind="kind"
            :items="panelItems[kind]"
            :selected="filters[kind] ?? null"
            :compact="bothOpen"
            class="max-h-[min(15rem,36dvh)]"
            @select="(value) => setQuery({ [kind]: value })"
            @close="closePanel(kind)"
          />
        </div>
      </div>
    </div>

    <BulkBar
      :tasks="controller.selectedTasks.value"
      :total="tasks?.length ?? 0"
      @clear="controller.clearSelection()"
      @select-all="controller.selectAllVisible()"
    />

    <!-- One open panel stands beside the list; two stand beside it where the list keeps at least ~29rem
         ([Features][Versions][Tasks]), otherwise side by side above it with a capped height. -->
    <div class="@container flex flex-col page-scroll:grow list-scroll:min-h-0 list-scroll:flex-1">
    <div
      class="flex flex-col page-scroll:grow list-scroll:min-h-0 list-scroll:flex-1"
      :class="besideList ? ['gap-4 p-4 sm:p-5', bothOpen ? '@min-[62rem]:flex-row' : 'sm:flex-row'] : 'sm:flex-row'"
    >
    <div
      v-if="besideList"
      class="shrink-0 gap-4"
      :class="bothOpen ? 'grid h-[min(16rem,40%)] grid-cols-2 grid-rows-[minmax(0,1fr)] @min-[62rem]:flex @min-[62rem]:h-auto' : 'flex'"
      data-testid="filter-panels"
    >
      <TaskFilterPanel
        v-for="kind in openPanels"
        :key="kind"
        :kind="kind"
        :items="panelItems[kind]"
        :selected="filters[kind] ?? null"
        class="min-w-0"
        :class="bothOpen ? 'min-h-0 @min-[62rem]:max-h-full @min-[62rem]:w-64' : 'max-h-full w-64'"
        @select="(value) => setQuery({ [kind]: value })"
        @close="closePanel(kind)"
      />
    </div>
    <!-- On phones an empty list still keeps room for its message above the composer. -->
    <div class="relative page-scroll:min-h-52 page-scroll:grow list-scroll:min-h-0 list-scroll:flex-1" :class="besideList ? 'overflow-hidden rounded-card border border-default' : ''">
      <div v-if="status === 'pending' && !tasks?.length" class="space-y-px p-0">
        <USkeleton v-for="i in 8" :key="i" class="h-12 rounded-none" />
      </div>
      <StatePanel
        v-else-if="error && !tasks?.length"
        tone="error"
        icon="i-lucide-cloud-off"
        title="Tasks could not be loaded"
        :description="error.message"
      >
        <UButton label="Try again" @click="refresh()" />
      </StatePanel>
      <template v-else>
        <TaskList
          ref="listRef"
          page-scroll
          v-model:input="input"
          :tasks="tasks ?? []"
          :drafts="showDrafts"
          :active-task="activeTask"
          :can-create="canCreate"
          :can-edit="canEdit"
          :selected="controller.selected.value"
          :expanded="controller.expanded.value"
          :scroll-key="`space:${space.name}:${JSON.stringify(filters)}`"
          @open="openTask"
          @status="(task, status) => controller.setStatus(task, status, canEdit)"
          @select="controller.select"
          @expand="controller.toggleExpand"
          @attribute="(task, field) => controller.toggleAttribute(task, field, canEdit)"
          @action-done="controller.setActionDone"
          @commit="commit"
          @retry="retry"
          @discard="discard"
        />
        <div
          v-if="!tasks?.length && !showDrafts.length"
          class="pointer-events-none absolute inset-x-0 top-16 flex justify-center px-6 text-center"
        >
          <div class="space-y-1">
            <p class="font-medium text-highlighted">
              {{ activeCount || filters.assignedToMe || filters.ownedByMe ? 'No tasks match these filters' : 'No tasks yet' }}
            </p>
            <p class="text-sm text-muted">
              {{ canCreate ? 'Type a title in the row below and press Enter.' : 'Tasks in this Space are read-only.' }}
            </p>
          </div>
        </div>
      </template>
    </div>
    </div>
    </div>

    <!-- The composer in page scroll (TaskList): sticky at the bottom of the screen, after the list at the end. -->
    <div ref="composerSlot" class="page-scroll:sticky page-scroll:bottom-0 page-scroll:z-10" />

    <TaskPanel :task-name="activeTask" @close="closeTask" />
  </div>
</template>
