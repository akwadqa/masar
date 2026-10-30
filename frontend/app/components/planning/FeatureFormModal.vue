<script setup lang="ts">
import type { RoadmapColumn } from '~/types/api'
import { ROADMAP_COLUMNS } from '~/types/api'
import { textToHtml } from '~/utils/format'

const props = defineProps<{ space: string, roadmap?: RoadmapColumn }>()
const open = defineModel<boolean>('open', { required: true })
const { create } = useFeatureMutations()
const toast = useToast()

const state = reactive({ title: '', roadmap: 'Later' as RoadmapColumn, description: '' })
const error = ref<string | null>(null)
// One id per dialog: repeating the submit after a lost response returns the same Feature.
let requestId = crypto.randomUUID()
watch(open, (value) => {
  if (!value) return
  requestId = crypto.randomUUID()
  Object.assign(state, { title: '', roadmap: props.roadmap ?? 'Later', description: '' })
  error.value = null
})

async function submit() {
  error.value = null
  if (!state.title.trim()) {
    error.value = 'A Feature needs a title.'
    return
  }
  try {
    const feature = await create.execute({
      space: props.space, title: state.title.trim(), roadmap: state.roadmap, description: textToHtml(state.description),
      client_request_id: requestId
    })
    open.value = false
    toast.add({ title: 'Feature created', description: feature.title, color: 'success', icon: 'i-lucide-circle-check' })
  } catch (caught) {
    error.value = (caught as Error).message
  }
}
</script>

<template>
  <UModal v-model:open="open" title="New Feature" description="Features group the tasks that deliver one capability.">
    <template #body>
      <form class="space-y-4" @submit.prevent="submit">
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" role="alert" />
        <UFormField label="Title" required>
          <UInput v-model="state.title" maxlength="240" class="w-full" autofocus placeholder="e.g. Single sign-on" />
        </UFormField>
        <UFormField label="Roadmap">
          <USelect v-model="state.roadmap" :items="ROADMAP_COLUMNS" class="w-full" />
        </UFormField>
        <UFormField label="Description" hint="Optional">
          <UTextarea v-model="state.description" :rows="4" autoresize class="w-full" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton type="submit" label="Create Feature" :loading="create.pending.value" />
        </div>
      </form>
    </template>
  </UModal>
</template>
