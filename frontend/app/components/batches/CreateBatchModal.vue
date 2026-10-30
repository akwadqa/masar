<script setup lang="ts">
import { parseDate, type CalendarDate } from '@internationalized/date'
import type { BatchPreset } from '~/types/api'
import { endForPreset, inclusiveDays } from '~/utils/batchDates'
import { businessToday, formatLongDate } from '~/utils/format'

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ created: [name: string, title: string] }>()
const { create } = useBatchMutations()
const toast = useToast()

const batchName = ref('')
const preset = ref<BatchPreset | 'custom'>('two_weeks')
// CalendarDate values stay out of `reactive` so they are not proxied.
const startDate = shallowRef<CalendarDate>(parseDate(businessToday()))
const customEnd = shallowRef<CalendarDate | null>(null)
const error = ref<string | null>(null)
let requestId = crypto.randomUUID()

watch(open, (value) => {
  if (!value) return
  batchName.value = ''
  preset.value = 'two_weeks'
  startDate.value = parseDate(businessToday())
  customEnd.value = null
  error.value = null
  requestId = crypto.randomUUID()
})

const endDate = computed(() => {
  if (!startDate.value) return null
  if (preset.value !== 'custom') return endForPreset(startDate.value.toString(), preset.value)
  return customEnd.value?.toString() ?? null
})
const days = computed(() => (startDate.value && endDate.value ? inclusiveDays(startDate.value.toString(), endDate.value) : null))
const presetItems = [
  { label: 'One Week', value: 'one_week', description: '7 days' },
  { label: 'Two Weeks', value: 'two_weeks', description: '14 days' },
  { label: 'Custom', value: 'custom', description: 'Choose the end date' }
]

async function submit() {
  error.value = null
  if (!batchName.value.trim()) return void (error.value = 'A Sprint needs a name.')
  if (!startDate.value || !endDate.value) return void (error.value = 'Choose a start and an end date.')
  if (days.value === null) return void (error.value = 'The end date cannot be before the start date.')
  try {
    const result = await create.execute({
      batchName: batchName.value.trim(),
      startDate: startDate.value.toString(),
      preset: preset.value === 'custom' ? undefined : preset.value,
      endDate: endDate.value,
      clientRequestId: requestId
    })
    open.value = false
    toast.add({ title: 'Sprint created', description: result.batch.batchName, color: 'success', icon: 'i-lucide-circle-check' })
    emit('created', result.batch.name, result.batch.batchName)
  } catch (caught) {
    error.value = (caught as Error).message
  }
}
</script>

<template>
  <UModal v-model:open="open" title="New Sprint" description="A short, time-boxed plan. It can hold tasks from every Space you manage.">
    <template #body>
      <form class="space-y-4" @submit.prevent="submit">
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" role="alert" />
        <UFormField label="Name" required>
          <UInput v-model="batchName" maxlength="140" class="w-full" autofocus placeholder="e.g. November week 1" />
        </UFormField>
        <UFormField label="Start date" required>
          <DatePicker v-model="startDate" class="w-full" aria-label="Start date" />
        </UFormField>
        <UFormField label="Duration">
          <URadioGroup v-model="preset" :items="presetItems" orientation="horizontal" variant="table" />
        </UFormField>
        <UFormField v-if="preset === 'custom'" label="End date" required>
          <DatePicker v-model="customEnd" class="w-full" aria-label="End date" />
        </UFormField>
        <p v-if="endDate && days" class="text-sm text-muted" aria-live="polite">
          {{ formatLongDate(startDate.toString()) }} – {{ formatLongDate(endDate) }} · {{ days }} {{ days === 1 ? 'day' : 'days' }} (Asia/Qatar calendar)
        </p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
          <UButton type="submit" label="Create Sprint" :loading="create.pending.value" />
        </div>
      </form>
    </template>
  </UModal>
</template>
