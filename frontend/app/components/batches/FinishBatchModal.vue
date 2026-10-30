<script setup lang="ts">
import type { BatchDetail, FinishPreview } from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'
import { formatLongDate } from '~/utils/format'

// Finishing is consequential: it freezes the results and moves unfinished work (ADR-049, ADR-050).
const props = defineProps<{ batch: BatchDetail }>()
const open = defineModel<boolean>('open', { required: true })
const { finish } = useBatchMutations()
const toast = useToast()

const preview = ref<FinishPreview | null>(null)
const loadError = ref<string | null>(null)
const carry = ref<'Unbatched' | 'Batch'>('Unbatched')
const destination = ref<string | undefined>()
const error = ref<string | null>(null)
// One id per dialog: a repeated click after a lost response replays the same finish.
let requestId = crypto.randomUUID()

watch(open, async (value) => {
  if (!value) return
  requestId = crypto.randomUUID()
  preview.value = null
  loadError.value = null
  error.value = null
  carry.value = 'Unbatched'
  destination.value = undefined
  try {
    preview.value = await fetchFinishPreview(props.batch.name)
  } catch (caught) {
    loadError.value = (caught as Error).message
  }
})

const destinationItems = computed(() => (preview.value?.destinations ?? []).map(d => ({
  label: `${d.batchName} · starts ${formatLongDate(d.startDate)}`, value: d.name
})))
const carryItems = computed(() => [
  { label: 'Return them to the Backlog', value: 'Unbatched', description: 'They stay open and can be planned again later.' },
  {
    label: 'Move them to a planned Sprint',
    value: 'Batch',
    description: destinationItems.value.length ? 'They become part of the chosen Sprint.' : 'You have no other planned Sprint.',
    disabled: !destinationItems.value.length
  }
])

async function confirm() {
  error.value = null
  if (carry.value === 'Batch' && !destination.value) return void (error.value = 'Choose the planned Sprint for unfinished tasks.')
  try {
    const result = await finish.execute({ batch: props.batch.name, carry: carry.value, destination: destination.value, requestId })
    open.value = false
    const moved = result.carriedOver ? `${result.carriedOver} moved to the next Sprint` : `${result.returned} returned to the Backlog`
    toast.add({ title: 'Sprint finished', description: `${result.completed} completed · ${moved}.`, color: 'success', icon: 'i-lucide-flag' })
  } catch (caught) {
    const apiError = caught as MasarApiError
    error.value = apiError.kind === 'conflict' ? 'This Sprint was finished by someone else. The latest state is shown.' : apiError.message
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="`Finish ${batch.batchName}?`" :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <div v-if="!preview && !loadError" class="space-y-2" aria-busy="true">
        <USkeleton class="h-16" />
        <USkeleton class="h-24" />
      </div>
      <UAlert v-else-if="loadError" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="loadError" role="alert" />
      <div v-else-if="preview" class="space-y-4 text-sm">
        <p class="text-muted">
          {{ formatLongDate(batch.startDate) }} – {{ formatLongDate(batch.endDate) }}. The results are frozen when you finish:
          later changes to these tasks do not alter them.
        </p>
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-md border border-default p-3">
            <p class="text-2xl font-semibold tabular-nums text-highlighted">{{ preview.completed }}</p>
            <p class="text-muted">completed</p>
          </div>
          <div class="rounded-md border border-default p-3">
            <p class="text-2xl font-semibold tabular-nums text-highlighted">{{ preview.unfinished }}</p>
            <p class="text-muted">unfinished — they stay open</p>
          </div>
        </div>
        <template v-if="preview.unfinished">
          <UFormField label="What happens to the unfinished tasks?">
            <URadioGroup v-model="carry" :items="carryItems" variant="card" />
          </UFormField>
          <UFormField v-if="carry === 'Batch'" label="Planned Sprint" required>
            <USelect v-model="destination" :items="destinationItems" placeholder="Choose a Sprint" class="w-full" />
          </UFormField>
          <UAlert
            v-if="preview.unfinishedInClosedSpaces && carry === 'Batch'"
            color="neutral"
            variant="subtle"
            icon="i-lucide-archive"
            :title="`${preview.unfinishedInClosedSpaces} unfinished task(s) belong to closed Spaces`"
            description="Closed Spaces are read-only, so those tasks return to the Backlog."
          />
        </template>
        <p v-else class="text-muted">Every task is completed. Nothing needs to move.</p>
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" role="alert" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
        <UButton icon="i-lucide-flag" label="Finish Sprint" :disabled="!preview" :loading="finish.pending.value" @click="confirm" />
      </div>
    </template>
  </UModal>
</template>
