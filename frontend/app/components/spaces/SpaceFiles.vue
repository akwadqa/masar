<script setup lang="ts">
import type { SpaceDetail, SpaceFile } from '~/types/api'
import { formatDateTime } from '~/utils/format'
import { nameUploadedFile } from '~/utils/transferFiles'

// Private Space files (BRD, customer documents, project material). Members read them; Space Managers add
// and remove them in Settings (`manage`). Links go to /private/files, which re-checks Space membership.
const props = defineProps<{ space: SpaceDetail, manage?: boolean }>()
const { data: files, refresh } = useSpaceFiles(() => props.space.name)
const { remove } = useSpaceFileMutations()
const toast = useToast()
const progress = ref<Array<{ id: string, name: string, percent: number }>>([])
const picker = ref<HTMLInputElement | null>(null)
const toDelete = ref<SpaceFile | null>(null)
const canManage = computed(() => props.manage && props.space.permissions.canManageFiles)

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
async function upload(list: File[]) {
  for (const file of list.map(item => nameUploadedFile(item))) {
    const id = crypto.randomUUID()
    progress.value = [...progress.value, { id, name: file.name, percent: 0 }]
    try {
      await uploadSpaceFile(props.space.name, file, (percent) => {
        progress.value = progress.value.map(p => (p.id === id ? { ...p, percent } : p))
      })
      toast.add({ title: 'File added', description: file.name, color: 'success', icon: 'i-lucide-paperclip' })
    } catch (caught) {
      toast.add({ title: `${file.name} could not be uploaded`, description: (caught as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
    } finally {
      progress.value = progress.value.filter(p => p.id !== id)
    }
  }
  await refresh()
}
async function confirmRemove() {
  if (!toDelete.value) return
  try {
    await remove.execute({ space: props.space.name, file: toDelete.value.name })
  } finally {
    toDelete.value = null
  }
}
</script>

<template>
  <UCard id="files" :ui="{ body: 'space-y-3' }">
    <template #header>
      <div class="flex items-center gap-2">
        <h2 class="font-medium text-highlighted">Files</h2>
        <UBadge v-if="files?.length" color="neutral" variant="subtle" size="sm" :label="String(files.length)" />
        <template v-if="canManage">
          <input ref="picker" type="file" multiple class="hidden" aria-hidden="true" data-testid="space-file-input" @change="upload([...(($event.target as HTMLInputElement).files ?? [])]); ($event.target as HTMLInputElement).value = ''">
          <UButton class="ms-auto" size="sm" color="neutral" variant="outline" icon="i-lucide-upload" label="Upload file" @click="picker?.click()" />
        </template>
        <UButton
          v-else-if="space.permissions.canManageFiles"
          class="ms-auto"
          :to="`/spaces/${space.name}/settings#files`"
          icon="i-lucide-pencil"
          color="neutral"
          variant="outline"
          size="sm"
          label="Manage"
        />
      </div>
    </template>
    <ul v-if="files?.length || progress.length" class="grid gap-2 sm:grid-cols-2">
      <li v-for="p in progress" :key="p.id" class="flex items-center gap-2 rounded-md border border-dashed border-default p-2 text-sm" aria-live="polite">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-muted" /> <span class="truncate">{{ p.name }}</span>
        <span class="ms-auto tabular-nums text-muted">{{ p.percent }}%</span>
      </li>
      <li v-for="file in files" :key="file.name" class="flex min-w-0 items-center gap-2 rounded-md border border-default p-2 text-sm">
        <a :href="file.url" target="_blank" class="shrink-0" :aria-label="`Open ${file.fileName}`">
          <img v-if="file.isImage" :src="file.url" :alt="file.fileName" class="size-10 rounded object-cover" loading="lazy">
          <span v-else class="grid size-10 place-items-center rounded bg-elevated"><UIcon name="i-lucide-file-text" class="size-5 text-muted" /></span>
        </a>
        <div class="min-w-0 flex-1">
          <a :href="file.url" target="_blank" class="block truncate font-medium text-highlighted hover:underline">{{ file.fileName }}</a>
          <p class="truncate text-xs text-muted">{{ size(file.size) }} · {{ file.uploadedBy?.fullName }} · {{ formatDateTime(file.uploadedAt) }}</p>
        </div>
        <UButton v-if="canManage && file.canDelete" icon="i-lucide-trash-2" color="neutral" variant="ghost" size="xs" square :aria-label="`Remove ${file.fileName}`" @click="toDelete = file" />
      </li>
    </ul>
    <p v-else class="text-sm text-muted">
      {{ canManage ? 'No files yet. Upload BRDs, customer documents and other project material; only members of this Space can open them.' : 'No files yet.' }}
    </p>
    <UModal :open="!!toDelete" :title="`Remove ${toDelete?.fileName}?`" description="The file is deleted for everyone in this Space." @update:open="(v: boolean) => { if (!v) toDelete = null }">
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="toDelete = null" />
          <UButton color="error" label="Remove file" :loading="remove.pending.value" @click="confirmRemove" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
