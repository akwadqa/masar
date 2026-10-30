<script setup lang="ts">
import { parseDate, type CalendarDate } from '@internationalized/date'
import type { ReleaseStatus } from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'
import { formatDateTime, htmlToText, textToHtml } from '~/utils/format'

const props = defineProps<{ name: string, mode: 'panel' | 'page' }>()
const emit = defineEmits<{ deleted: [], close: [] }>()

const { data: release, status, error, refresh } = useRelease(() => props.name)
const { update, setStatus, remove } = useReleaseMutations()
const toast = useToast()
// Archived Releases are read-only until restored (ADR-036).
const canEdit = computed(() => !!release.value?.permissions.canManage && release.value.status !== 'Archived')

const releaseName = ref('')
const notes = ref('')
const editing = reactive({ releaseName: false, notes: false })
const nameError = ref<string | null>(null)
watch(release, (value) => {
  if (!value) return
  if (!editing.releaseName) releaseName.value = value.releaseName
  if (!editing.notes) notes.value = htmlToText(value.notes)
}, { immediate: true })

async function save(changes: { releaseName?: string, releaseDate?: string | null, notes?: string | null }) {
  if (!release.value) return
  nameError.value = null
  try {
    await update.execute({ release: release.value, changes })
  } catch (caught) {
    const apiError = caught as MasarApiError
    // A duplicate name is also a 409, but it is a validation message, not a concurrent edit.
    const duplicate = apiError.type === 'DuplicateEntryError'
    if ('releaseName' in changes && (duplicate || apiError.kind !== 'conflict')) {
      nameError.value = apiError.message
      releaseName.value = release.value.releaseName
    } else if (apiError.kind === 'conflict') {
      toast.add({ title: 'Someone else changed this Release', description: 'The latest version is shown.', color: 'warning', icon: 'i-lucide-git-compare' })
    }
    await refresh()
  }
}

function commitName() {
  editing.releaseName = false
  const value = releaseName.value.replace(/\s+/g, ' ').trim()
  if (!release.value) return
  if (!value) {
    releaseName.value = release.value.releaseName
    return
  }
  if (value !== release.value.releaseName) void save({ releaseName: value })
}

function commitNotes() {
  editing.notes = false
  if (release.value && notes.value.trim() !== htmlToText(release.value.notes)) void save({ notes: textToHtml(notes.value) })
}

const releaseDate = computed<CalendarDate | null>({
  get: () => (release.value?.releaseDate ? parseDate(release.value.releaseDate) : null),
  set: value => void save({ releaseDate: value ? value.toString() : null })
})

const statusLabels: Record<ReleaseStatus, string> = { Planned: 'Move back to Planned', Released: 'Mark as released', Archived: 'Archive' }
const pendingStatus = ref<ReleaseStatus | null>(null)

async function changeStatus(next: ReleaseStatus, confirmed = false) {
  const current = release.value
  if (!current) return
  // Releasing with open tasks is allowed, but the Manager is told first (not again when restoring).
  if (!confirmed && (next === 'Archived' || (next === 'Released' && current.status === 'Planned' && current.progress.open > 0))) {
    pendingStatus.value = next
    return
  }
  pendingStatus.value = null
  try {
    await setStatus.execute({ release: current, status: next })
    toast.add({ title: `Release ${next.toLowerCase()}`, description: current.releaseName, color: 'success', icon: 'i-lucide-check' })
  } catch (caught) {
    if ((caught as MasarApiError).kind === 'conflict') {
      toast.add({ title: 'Someone else changed the status', description: 'The latest status is shown.', color: 'warning', icon: 'i-lucide-git-compare' })
    }
    await refresh()
  }
}

const confirmDelete = ref(false)
async function deleteRelease(detach: boolean) {
  if (!release.value) return
  try {
    const result = await remove.execute({ release: release.value, detach })
    confirmDelete.value = false
    toast.add({
      title: 'Release deleted',
      description: result.tasksDetached ? `${result.tasksDetached} task(s) kept without a Release.` : undefined,
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
    <div v-if="status === 'pending' && !release" class="space-y-4 p-6">
      <USkeleton class="h-8 w-1/2" />
      <USkeleton class="h-24" />
    </div>
    <StatePanel
      v-else-if="error?.kind === 'not_found' || (!release && status === 'success')"
      icon="i-lucide-file-x"
      title="Release not found"
      description="This Release does not exist or you do not have access to it."
    >
      <UButton v-if="mode === 'panel'" color="neutral" variant="outline" label="Close" @click="emit('close')" />
      <UButton v-else to="/spaces" label="Go to Spaces" />
    </StatePanel>
    <StatePanel v-else-if="error && !release" tone="error" icon="i-lucide-cloud-off" title="This Release could not be loaded" :description="error.message">
      <UButton label="Try again" @click="refresh()" />
    </StatePanel>

    <template v-else-if="release">
      <header class="flex items-center gap-1 border-b border-default px-4 py-2">
        <UBadge color="neutral" variant="subtle" icon="i-lucide-package" :label="`Release · ${release.spaceTitle}`" class="max-w-56 truncate" />
        <div class="ms-auto flex items-center gap-1">
          <UTooltip text="Copy link">
            <UButton icon="i-lucide-link" color="neutral" variant="ghost" size="sm" square aria-label="Copy link" @click="copyLink(`/releases/${name}`)" />
          </UTooltip>
          <UTooltip v-if="mode === 'panel'" text="Open as page">
            <UButton icon="i-lucide-maximize-2" color="neutral" variant="ghost" size="sm" square aria-label="Open as page" :to="`/releases/${release.name}`" />
          </UTooltip>
          <UTooltip v-if="canEdit" text="Delete Release">
            <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="sm" square aria-label="Delete Release" @click="confirmDelete = true" />
          </UTooltip>
          <UButton v-if="mode === 'panel'" icon="i-lucide-x" color="neutral" variant="ghost" size="sm" square aria-label="Close panel" @click="emit('close')" />
        </div>
      </header>

      <div class="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        <UAlert
          v-if="release.status === 'Archived'"
          color="neutral"
          variant="subtle"
          icon="i-lucide-archive"
          title="This Release is archived"
          description="It is read-only and its task links are kept as history. Restore it to make changes."
        />
        <div>
          <UInput
            v-model="releaseName"
            variant="none"
            :ui="{ base: 'px-1 text-lg font-semibold text-highlighted' }"
            class="w-full"
            aria-label="Release name"
            maxlength="80"
            :disabled="!canEdit"
            @focus="editing.releaseName = true"
            @blur="commitName"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          />
          <p v-if="nameError" class="px-1 text-sm text-error" role="alert">{{ nameError }}</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <ReleaseStatusBadge :status="release.status" />
          <UButton
            v-for="next in release.allowedStatuses"
            :key="next"
            size="sm"
            :color="next === 'Released' ? 'primary' : 'neutral'"
            :variant="next === 'Released' ? 'solid' : 'outline'"
            :label="release.status === 'Archived' ? `Restore as ${next}` : statusLabels[next]"
            :loading="setStatus.pending.value"
            @click="changeStatus(next)"
          />
        </div>

        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-3 text-sm">
          <span class="text-muted">Planned date</span>
          <div class="flex items-center gap-2">
            <DatePicker v-model="releaseDate" clearable class="w-full" aria-label="Planned date" :disabled="!canEdit" />
            <UButton v-if="release.releaseDate && canEdit" icon="i-lucide-x" color="neutral" variant="ghost" size="sm" square aria-label="Clear planned date" @click="save({ releaseDate: null })" />
          </div>
          <span class="text-muted">Progress</span>
          <PlanningProgress :progress="release.progress" />
          <template v-if="release.releasedAt">
            <span class="text-muted">Released</span>
            <span>{{ release.releasedBy?.fullName }} · {{ formatDateTime(release.releasedAt) }}</span>
          </template>
          <span class="text-muted">Created</span>
          <span>{{ release.createdBy?.fullName }} · {{ formatDateTime(release.creation) }}</span>
        </div>

        <UFormField label="Notes">
          <UTextarea v-model="notes" :rows="4" autoresize class="w-full" placeholder="Scope, highlights or release notes." :disabled="!canEdit" @focus="editing.notes = true" @blur="commitNotes" />
        </UFormField>

        <LinkedTasks :space="release.space" filter="release" :value="release.name" :can-link="release.permissions.canLinkTasks" />
      </div>

      <UModal
        :open="!!pendingStatus"
        :title="pendingStatus === 'Archived' ? 'Archive this Release?' : 'Release with open tasks?'"
        :description="pendingStatus === 'Archived'
          ? 'Archived Releases are read-only: tasks can no longer be added to or removed from it until it is restored.'
          : `${release.progress.open} linked task(s) are still open. They stay open and stay in this Release.`"
        @update:open="(value: boolean) => { if (!value) pendingStatus = null }"
      >
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton color="neutral" variant="ghost" label="Cancel" @click="pendingStatus = null" />
            <UButton :label="pendingStatus === 'Archived' ? 'Archive' : 'Mark as released'" @click="changeStatus(pendingStatus!, true)" />
          </div>
        </template>
      </UModal>
      <PlanningDeleteModal
        v-model:open="confirmDelete"
        kind="Release"
        :title="release.releaseName"
        :linked="release.progress.total"
        :pending="remove.pending.value"
        hint="To keep the history instead, archive the Release."
        @confirm="deleteRelease"
      />
    </template>
  </div>
</template>
