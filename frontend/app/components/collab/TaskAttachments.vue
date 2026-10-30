<script setup lang="ts">
import type { TaskAttachment } from '~/types/api'
import { formatDateTime } from '~/utils/format'
import { nameUploadedFile } from '~/utils/transferFiles'

// Private Task files (ADR-054): links go to /private/files, which re-checks Space membership.
const props = defineProps<{ task: string, canUpload: boolean }>()
const { data: files, refresh } = useTaskAttachments(() => props.task)
const { removeAttachment } = useCommentMutations()
const toast = useToast()
const progress = ref<Array<{ id: string, name: string, percent: number }>>([])
const picker = ref<HTMLInputElement | null>(null)
const toDelete = ref<TaskAttachment | null>(null)

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
async function upload(list: File[]) {
  for (const file of list.map(item => nameUploadedFile(item))) {
    const id = crypto.randomUUID()
    progress.value = [...progress.value, { id, name: file.name, percent: 0 }]
    try {
      await uploadAttachment(props.task, file, 'Task', (percent) => {
        progress.value = progress.value.map(p => (p.id === id ? { ...p, percent } : p))
      })
      toast.add({ title: 'File attached', description: file.name, color: 'success', icon: 'i-lucide-paperclip' })
    } catch (caught) {
      toast.add({ title: `${file.name} could not be uploaded`, description: (caught as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
    } finally {
      progress.value = progress.value.filter(p => p.id !== id)
    }
  }
  await refresh()
  // Task rows show a paperclip for Tasks with files (client revision 5).
  void invalidateQueries('tasks:')
}
defineExpose({ upload })
async function confirmRemove() {
  if (!toDelete.value) return
  try {
    await removeAttachment.execute({ task: props.task, attachment: toDelete.value.name })
  } finally {
    toDelete.value = null
  }
}
</script>

<template>
  <section class="space-y-2" aria-labelledby="attachments-heading">
    <div class="flex items-center gap-2">
      <h3 id="attachments-heading" class="text-sm font-semibold text-highlighted">Attachments</h3>
      <UBadge v-if="files?.length" color="neutral" variant="subtle" size="sm" :label="String(files.length)" />
      <template v-if="canUpload">
        <input ref="picker" type="file" multiple class="hidden" aria-hidden="true" data-testid="attachment-input" @change="upload([...(($event.target as HTMLInputElement).files ?? [])]); ($event.target as HTMLInputElement).value = ''">
        <UButton class="ms-auto" size="xs" color="neutral" variant="outline" icon="i-lucide-paperclip" label="Attach file" @click="picker?.click()" />
      </template>
    </div>
    <ul v-if="files?.length || progress.length" class="grid gap-2 sm:grid-cols-2">
      <li v-for="p in progress" :key="p.id" class="flex items-center gap-2 rounded-md border border-dashed border-default p-2 text-sm" aria-live="polite">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-muted" /> <span class="truncate">{{ p.name }}</span>
        <span class="ms-auto tabular-nums text-muted">{{ p.percent }}%</span>
      </li>
      <li v-for="file in files" :key="file.name" class="flex min-w-0 items-center gap-2 rounded-md border border-default p-2 text-sm">
        <a :href="file.url" target="_blank" class="shrink-0" :aria-label="`Open ${file.fileName}`">
          <img v-if="file.isImage" :src="file.url" :alt="file.fileName" class="size-10 rounded object-cover" loading="lazy">
          <span v-else class="grid size-10 place-items-center rounded bg-elevated"><UIcon name="i-lucide-file" class="size-5 text-muted" /></span>
        </a>
        <div class="min-w-0 flex-1">
          <a :href="file.url" target="_blank" class="block truncate font-medium text-highlighted hover:underline">{{ file.fileName }}</a>
          <p class="truncate text-xs text-muted">{{ size(file.size) }} · {{ file.uploadedBy?.fullName }} · {{ formatDateTime(file.uploadedAt) }}{{ file.comment ? ' · in a comment' : '' }}</p>
        </div>
        <UButton v-if="file.canDelete" icon="i-lucide-trash-2" color="neutral" variant="ghost" size="xs" square :aria-label="`Remove ${file.fileName}`" @click="toDelete = file" />
      </li>
    </ul>
    <p v-else class="text-sm text-muted">{{ canUpload ? 'No files yet. Attach or drop files here; they stay private to this Space.' : 'No files.' }}</p>
    <UModal :open="!!toDelete" :title="`Remove ${toDelete?.fileName}?`" description="The file is deleted for everyone." @update:open="(v: boolean) => { if (!v) toDelete = null }">
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="toDelete = null" />
          <UButton color="error" label="Remove file" :loading="removeAttachment.pending.value" @click="confirmRemove" />
        </div>
      </template>
    </UModal>
  </section>
</template>
