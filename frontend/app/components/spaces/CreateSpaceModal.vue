<script setup lang="ts">
import type { SpaceFormState } from './SpaceForm.vue'
import { textToHtml } from '~/utils/format'

const open = defineModel<boolean>('open', { required: true })
const { create } = useSpaceMutations()
const toast = useToast()
const error = ref<string | null>(null)

const blank = (): SpaceFormState => ({
  title: '', category: '', owner: undefined, spaceType: 'Internal',
  completionDate: null, gameplanUrl: '', details: ''
})
const state = ref<SpaceFormState>(blank())
watch(open, (value) => {
  if (value) {
    state.value = blank()
    error.value = null
  }
})

async function submit() {
  error.value = null
  try {
    const space = await create.execute({
      title: state.value.title.trim(),
      owner: state.value.owner!,
      category: state.value.category.trim() || null,
      spaceType: state.value.spaceType,
      completionDate: state.value.completionDate,
      gameplanUrl: state.value.gameplanUrl.trim() || null,
      details: textToHtml(state.value.details)
    })
    open.value = false
    toast.add({ title: 'Space created', description: space.title, color: 'success', icon: 'i-lucide-circle-check' })
    await navigateTo(`/spaces/${space.name}/summary`)
  } catch (caught) {
    error.value = (caught as Error).message
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Create Space" description="Spaces group the work, people and access of one project." :ui="{ content: 'sm:max-w-xl' }">
    <template #body>
      <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" class="mb-4" role="alert" />
      <SpaceForm v-model="state" with-owner submit-label="Create Space" :pending="create.pending.value" @submit="submit" @cancel="open = false" />
    </template>
  </UModal>
</template>
