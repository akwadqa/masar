<script setup lang="ts">
import type { CalendarDate } from '@internationalized/date'
import { textToHtml } from '~/utils/format'

const props = defineProps<{ space: string }>()
const open = defineModel<boolean>('open', { required: true })
const { create } = useReleaseMutations()
const toast = useToast()

const state = reactive({ releaseName: '', notes: '' })
// Kept out of `reactive` so the CalendarDate instance is not proxied.
const releaseDate = shallowRef<CalendarDate | null>(null)
const error = ref<string | null>(null)
watch(open, (value) => {
  if (!value) return
  Object.assign(state, { releaseName: '', notes: '' })
  releaseDate.value = null
  error.value = null
})

async function submit() {
  error.value = null
  if (!state.releaseName.trim()) {
    error.value = 'A Release needs a name or version.'
    return
  }
  try {
    const release = await create.execute({
      space: props.space,
      releaseName: state.releaseName.trim(),
      releaseDate: releaseDate.value ? releaseDate.value.toString() : null,
      notes: textToHtml(state.notes)
    })
    open.value = false
    toast.add({ title: 'Release created', description: release.releaseName, color: 'success', icon: 'i-lucide-circle-check' })
  } catch (caught) {
    error.value = (caught as Error).message
  }
}
</script>

<template>
  <UModal v-model:open="open" title="New Release" description="Release names are unique within the Space, ignoring case and spacing.">
    <template #body>
      <form class="space-y-4" @submit.prevent="submit">
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" role="alert" />
        <UFormField label="Name or version" required>
          <UInput v-model="state.releaseName" maxlength="80" class="w-full" autofocus placeholder="e.g. v1.4 or 2026.11" />
        </UFormField>
        <UFormField label="Planned date" hint="Optional">
          <DatePicker v-model="releaseDate" clearable class="w-full" aria-label="Release date" />
        </UFormField>
        <UFormField label="Notes" hint="Optional">
          <UTextarea v-model="state.notes" :rows="4" autoresize class="w-full" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton type="submit" label="Create Release" :loading="create.pending.value" />
        </div>
      </form>
    </template>
  </UModal>
</template>
