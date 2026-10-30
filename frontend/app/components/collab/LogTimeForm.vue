<script setup lang="ts">
import { parseDate, type CalendarDate } from '@internationalized/date'
import type { TaskDetail, TimeResult } from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'
import { formatDuration, parseDuration, parseEstimate } from '~/utils/duration'
import { businessToday } from '~/utils/format'

// Quick manual time entry (ADR-060). The draft and its request id survive failures and reloads, so
// retrying after a lost response returns the same entry instead of logging the time twice.
const props = defineProps<{ task: TaskDetail }>()
const emit = defineEmits<{ logged: [result: TimeResult], cancel: [] }>()
const { log } = useTimeMutations()
const toast = useToast()

const today = parseDate(businessToday())
const duration = ref('')
const workDate = shallowRef<CalendarDate | undefined>(today)
const note = ref('')
const updateEstimate = ref(false)
const estimate = ref(props.task.remainingMinutes === null ? '' : formatDuration(props.task.remainingMinutes))
const error = ref<string | null>(null)
let requestId: string = crypto.randomUUID()
const draftKey = computed(() => `masar:time-draft:${props.task.name}`)

interface Draft { duration: string, workDate: string, note: string, updateEstimate: boolean, estimate: string, requestId: string }
onMounted(() => {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey.value) ?? 'null') as Draft | null
    if (!draft) return
    duration.value = draft.duration
    note.value = draft.note
    updateEstimate.value = draft.updateEstimate
    estimate.value = draft.estimate
    requestId = draft.requestId
    const saved = draft.workDate ? parseDate(draft.workDate) : today
    workDate.value = saved.compare(today) > 0 ? today : saved
  } catch { /* no usable draft */ }
})
watch([duration, workDate, note, updateEstimate, estimate], () => {
  try {
    if (!duration.value && !note.value) return localStorage.removeItem(draftKey.value)
    localStorage.setItem(draftKey.value, JSON.stringify({ duration: duration.value, workDate: workDate.value?.toString() ?? '', note: note.value, updateEstimate: updateEstimate.value, estimate: estimate.value, requestId }))
  } catch { /* storage unavailable */ }
})

const parsed = computed(() => (duration.value.trim() ? parseDuration(duration.value) : null))
const parsedEstimate = computed(() => parseEstimate(estimate.value))

async function submit() {
  error.value = null
  if (!parsed.value) return void (error.value = 'Enter how long you worked, for example 1h 30m.')
  if (!parsed.value.ok) return void (error.value = parsed.value.error)
  // novalidate: the date field's native range check would otherwise block submit silently; an
  // incomplete date (a cleared segment) leaves no value.
  if (!workDate.value) return void (error.value = 'Choose a work date up to today (Qatar time).')
  if (workDate.value.compare(today) > 0) return void (error.value = 'Work cannot be logged for a future date.')
  if (updateEstimate.value && !parsedEstimate.value.ok) return void (error.value = parsedEstimate.value.error)
  try {
    const result = await log.execute({
      task: props.task.name,
      duration: parsed.value.minutes,
      workDate: workDate.value.toString(),
      description: note.value.trim(),
      clientRequestId: requestId,
      remaining: updateEstimate.value && parsedEstimate.value.ok ? { minutes: parsedEstimate.value.minutes, base: props.task.remainingMinutes } : undefined
    })
    try { localStorage.removeItem(draftKey.value) } catch { /* ignore */ }
    requestId = crypto.randomUUID()
    duration.value = ''
    note.value = ''
    toast.add({ title: `${formatDuration(result.entry.minutes)} logged`, description: props.task.title, color: 'success', icon: 'i-lucide-timer' })
    emit('logged', result)
  } catch (caught) {
    const apiError = caught as MasarApiError
    // The draft and request id are kept: saving again never logs the time twice.
    error.value = apiError.kind === 'conflict'
      ? 'Someone else changed the remaining estimate meanwhile. Your time was not logged; review the estimate and save again.'
      : apiError.message
    if (apiError.kind === 'conflict') await invalidateQueries(`task:${props.task.name}`)
  }
}
</script>

<template>
  <form class="space-y-3 rounded-lg border border-default bg-elevated/30 p-3" aria-label="Log time" novalidate @submit.prevent="submit">
    <div class="grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,11rem)_1fr]">
      <UFormField label="Time spent" :hint="parsed?.ok ? `= ${formatDuration(parsed.minutes)}` : undefined" required>
        <UInput v-model="duration" placeholder="1h 30m" autofocus class="w-full" aria-label="Time spent" data-testid="log-duration" inputmode="text" autocomplete="off" />
      </UFormField>
      <UFormField label="Work date">
        <DatePicker v-model="workDate" :max-value="today" class="w-full" aria-label="Work date" />
      </UFormField>
      <UFormField label="Note" hint="Optional">
        <UInput v-model="note" maxlength="1000" placeholder="What did you work on?" class="w-full" aria-label="Work note" />
      </UFormField>
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <UCheckbox v-model="updateEstimate" label="Update remaining estimate" />
      <UInput v-if="updateEstimate" v-model="estimate" placeholder="e.g. 2h (empty = no estimate)" size="sm" class="w-56" aria-label="Remaining estimate" data-testid="log-remaining" />
      <span v-if="updateEstimate && parsedEstimate.ok" class="text-xs text-muted">
        {{ parsedEstimate.minutes === null ? 'No estimate' : `${formatDuration(parsedEstimate.minutes)} left` }}
      </span>
    </div>
    <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
    <div class="flex justify-end gap-2">
      <UButton color="neutral" variant="ghost" label="Cancel" @click="emit('cancel')" />
      <UButton type="submit" icon="i-lucide-timer" label="Log time" :loading="log.pending.value" :disabled="log.pending.value" />
    </div>
  </form>
</template>
