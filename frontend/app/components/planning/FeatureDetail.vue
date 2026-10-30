<script setup lang="ts">
import type { RoadmapColumn } from '~/types/api'
import { ROADMAP_COLUMNS } from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'
import { formatDateTime, htmlToText, textToHtml } from '~/utils/format'

const props = defineProps<{ name: string, mode: 'panel' | 'page' }>()
const emit = defineEmits<{ deleted: [], close: [] }>()

const { data: feature, status, error, refresh } = useFeature(() => props.name)
const { update, move, remove } = useFeatureMutations()
const toast = useToast()
const canManage = computed(() => !!feature.value?.permissions.canManage)

const title = ref('')
const description = ref('')
const editing = reactive({ title: false, description: false })
watch(feature, (value) => {
  if (!value) return
  if (!editing.title) title.value = value.title
  if (!editing.description) description.value = htmlToText(value.description)
}, { immediate: true })

async function save(changes: { title?: string, description?: string | null }) {
  if (!feature.value) return
  try {
    await update.execute({ feature: feature.value, changes })
  } catch (caught) {
    if ((caught as MasarApiError).kind === 'conflict') {
      toast.add({ title: 'Someone else changed this Feature', description: 'The latest version is shown.', color: 'warning', icon: 'i-lucide-git-compare' })
      await refresh()
    }
  }
}

function commitTitle() {
  editing.title = false
  const value = title.value.replace(/\s+/g, ' ').trim()
  if (!feature.value) return
  if (!value) {
    title.value = feature.value.title
    return
  }
  if (value !== feature.value.title) void save({ title: value })
}

function commitDescription() {
  editing.description = false
  if (feature.value && description.value.trim() !== htmlToText(feature.value.description)) {
    void save({ description: textToHtml(description.value) })
  }
}

const confirmDone = ref(false)
async function setRoadmap(roadmap: RoadmapColumn, confirmed = false) {
  const current = feature.value
  if (!current || roadmap === current.roadmap) return
  if (roadmap === 'Done' && current.progress.open > 0 && !confirmed) {
    confirmDone.value = true
    return
  }
  confirmDone.value = false
  try {
    await move.execute({ feature: current, roadmap, columnOrder: [current.name] })
  } catch {
    await refresh()
  }
}

const confirmDelete = ref(false)
async function deleteFeature(detach: boolean) {
  if (!feature.value) return
  try {
    const result = await remove.execute({ feature: feature.value, detach })
    confirmDelete.value = false
    toast.add({
      title: 'Feature deleted',
      description: result.tasksDetached ? `${result.tasksDetached} task(s) kept without a Feature.` : undefined,
      color: 'neutral',
      icon: 'i-lucide-trash-2'
    })
    emit('deleted')
  } catch {
    await refresh()
  }
}

const copyLink = useCopyLink()
</script>

<template>
  <div class="flex h-full flex-col">
    <div v-if="status === 'pending' && !feature" class="space-y-4 p-6">
      <USkeleton class="h-8 w-3/4" />
      <USkeleton class="h-24" />
    </div>
    <StatePanel
      v-else-if="error?.kind === 'not_found' || (!feature && status === 'success')"
      icon="i-lucide-file-x"
      title="Feature not found"
      description="This Feature does not exist or you do not have access to it."
    >
      <UButton v-if="mode === 'panel'" color="neutral" variant="outline" label="Close" @click="emit('close')" />
      <UButton v-else to="/spaces" label="Go to Spaces" />
    </StatePanel>
    <StatePanel v-else-if="error && !feature" tone="error" icon="i-lucide-cloud-off" title="This Feature could not be loaded" :description="error.message">
      <UButton label="Try again" @click="refresh()" />
    </StatePanel>

    <template v-else-if="feature">
      <header class="flex items-center gap-1 border-b border-default px-4 py-2">
        <UBadge color="neutral" variant="subtle" icon="i-lucide-map" :label="`Feature · ${feature.spaceTitle}`" class="max-w-56 truncate" />
        <div class="ms-auto flex items-center gap-1">
          <UTooltip text="Copy link">
            <UButton icon="i-lucide-link" color="neutral" variant="ghost" size="sm" square aria-label="Copy link" @click="copyLink(`/features/${name}`)" />
          </UTooltip>
          <UTooltip v-if="mode === 'panel'" text="Open as page">
            <UButton icon="i-lucide-maximize-2" color="neutral" variant="ghost" size="sm" square aria-label="Open as page" :to="`/features/${feature.name}`" />
          </UTooltip>
          <UTooltip v-if="canManage" text="Delete Feature">
            <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="sm" square aria-label="Delete Feature" @click="confirmDelete = true" />
          </UTooltip>
          <UButton v-if="mode === 'panel'" icon="i-lucide-x" color="neutral" variant="ghost" size="sm" square aria-label="Close panel" @click="emit('close')" />
        </div>
      </header>

      <div class="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        <UTextarea
          v-model="title"
          :rows="1"
          autoresize
          variant="none"
          :ui="{ base: 'px-1 text-lg font-semibold text-highlighted resize-none' }"
          class="w-full"
          aria-label="Feature title"
          :disabled="!canManage"
          maxlength="240"
          @focus="editing.title = true"
          @blur="commitTitle"
          @keydown.enter.prevent="($event.target as HTMLTextAreaElement).blur()"
          @keydown.esc="title = feature.title; ($event.target as HTMLTextAreaElement).blur()"
        />

        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-3 text-sm">
          <span class="text-muted">Roadmap</span>
          <USelect
            :model-value="feature.roadmap"
            :items="ROADMAP_COLUMNS"
            class="w-full"
            aria-label="Roadmap column"
            :disabled="!canManage"
            @update:model-value="(value: RoadmapColumn) => setRoadmap(value)"
          />
          <span class="text-muted">Progress</span>
          <PlanningProgress :progress="feature.progress" />
          <span class="text-muted">Created</span>
          <span class="text-default">{{ feature.createdBy?.fullName }} · {{ formatDateTime(feature.creation) }}</span>
        </div>
        <UAlert
          v-if="feature.roadmap === 'Done' && feature.progress.open"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="`Done with ${feature.progress.open} open task${feature.progress.open === 1 ? '' : 's'}`"
          description="The roadmap column and task completion are independent."
        />

        <UFormField label="Description">
          <UTextarea
            v-model="description"
            :rows="4"
            autoresize
            class="w-full"
            placeholder="What this Feature delivers and why."
            :disabled="!canManage"
            @focus="editing.description = true"
            @blur="commitDescription"
          />
        </UFormField>

        <LinkedTasks :space="feature.space" filter="feature" :value="feature.name" :can-link="feature.permissions.canLinkTasks" />
      </div>

      <UModal v-model:open="confirmDone" title="Move to Done with open tasks?" :description="`${feature.progress.open} task(s) are still open. Moving the Feature to Done does not complete them.`">
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton color="neutral" variant="ghost" label="Cancel" @click="confirmDone = false" />
            <UButton label="Move to Done" @click="setRoadmap('Done', true)" />
          </div>
        </template>
      </UModal>
      <PlanningDeleteModal v-model:open="confirmDelete" kind="Feature" :title="feature.title" :linked="feature.progress.total" :pending="remove.pending.value" @confirm="deleteFeature" />
    </template>
  </div>
</template>
