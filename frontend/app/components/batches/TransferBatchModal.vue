<script setup lang="ts">
import type { BatchDetail, UserRef } from '~/types/api'

const props = defineProps<{ batch: BatchDetail }>()
const open = defineModel<boolean>('open', { required: true })
const { transfer } = useBatchMutations()
const toast = useToast()
const candidates = ref<UserRef[]>([])
const loading = ref(false)
const newOwner = ref<string | undefined>()
const error = ref<string | null>(null)

watch(open, async (value) => {
  if (!value) return
  newOwner.value = undefined
  error.value = null
  loading.value = true
  try {
    candidates.value = await useMasarApi().get<UserRef[]>('masar.api.batches.owner_candidates', { batch: props.batch.name })
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    loading.value = false
  }
})
const items = computed(() => candidates.value.map(u => ({ label: u.fullName, value: u.name, avatar: { src: u.image ?? undefined, alt: u.fullName } })))

async function submit() {
  if (!newOwner.value) return
  try {
    const batch = await transfer.execute({ batch: props.batch, newOwner: newOwner.value })
    open.value = false
    toast.add({ title: 'Sprint transferred', description: `${batch.owner.fullName} now owns ${batch.batchName}.`, color: 'success', icon: 'i-lucide-check' })
  } catch (caught) {
    error.value = (caught as Error).message
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Transfer Sprint" description="The new owner must manage every Space whose tasks are in this Sprint.">
    <template #body>
      <div class="space-y-4">
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" role="alert" />
        <USelectMenu v-model="newOwner" :items="items" value-key="value" :loading="loading" placeholder="Choose the new owner" class="w-full" aria-label="New owner" />
        <p v-if="!loading && !items.length && !error" class="text-sm text-muted">Nobody else manages all of this Sprint's Spaces.</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton label="Transfer" :disabled="!newOwner" :loading="transfer.pending.value" @click="submit" />
        </div>
      </div>
    </template>
  </UModal>
</template>
