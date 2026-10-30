<script setup lang="ts">
import { parseDate, type CalendarDate } from '@internationalized/date'
import type { TimeEntry, TimeResult } from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'
import { formatDuration, parseDuration } from '~/utils/duration'
import { businessToday, formatDateTime, formatLongDate } from '~/utils/format'

// One Worklog entry: who, how long, for which day, note, and correction / void state (ADR-061).
const props = defineProps<{ entry: TimeEntry }>()
const emit = defineEmits<{ changed: [result: TimeResult] }>()
const { update, voidEntry } = useTimeMutations()
const { user } = useSession()
const editing = ref(false)
const confirmVoid = ref(false)
const reason = ref('')
const error = ref<string | null>(null)
const today = parseDate(businessToday())
const editDuration = ref('')
const editDate = shallowRef<CalendarDate | undefined>(today)
const editNote = ref('')
const ownEntry = computed(() => props.entry.worker?.name === user.value?.user)

function startEdit() {
  editDuration.value = formatDuration(props.entry.minutes)
  editDate.value = parseDate(props.entry.workDate)
  editNote.value = props.entry.description ?? ''
  error.value = null
  editing.value = true
}
async function saveEdit() {
  const parsed = parseDuration(editDuration.value)
  if (!parsed.ok) return void (error.value = parsed.error)
  if (!editDate.value) return void (error.value = 'Choose a work date up to today (Qatar time).')
  try {
    emit('changed', await update.execute({ entry: props.entry, changes: { duration: parsed.minutes, workDate: editDate.value.toString(), description: editNote.value } }))
    editing.value = false
  } catch (caught) {
    const apiError = caught as MasarApiError
    error.value = apiError.kind === 'conflict' ? 'This entry changed meanwhile. Cancel to see the latest version.' : apiError.message
  }
}
async function onVoid() {
  try {
    emit('changed', await voidEntry.execute({ entry: props.entry, reason: reason.value.trim() }))
    confirmVoid.value = false
  } catch (caught) {
    error.value = (caught as Error).message
  }
}
const menu = computed(() => [[
  ...(props.entry.permissions.canEdit ? [{ label: 'Correct entry', icon: 'i-lucide-pencil', onSelect: startEdit }] : []),
  ...(props.entry.permissions.canVoid ? [{ label: ownEntry.value ? 'Void entry' : 'Void entry (moderation)', icon: 'i-lucide-ban', color: 'error' as const, onSelect: () => { reason.value = ''; error.value = null; confirmVoid.value = true } }] : [])
]].filter(g => g.length))
</script>

<template>
  <article class="group flex gap-3 rounded-lg px-2 py-2" :aria-label="`${entry.worker?.fullName ?? 'Someone'} logged ${formatDuration(entry.minutes)} for ${formatLongDate(entry.workDate)}${entry.isVoided ? ', voided' : ''}`" :data-time-entry="entry.name">
    <UserAvatar :user="entry.worker" size="sm" class="mt-0.5" />
    <div class="min-w-0 flex-1 text-sm">
      <div class="flex flex-wrap items-baseline gap-x-2">
        <span class="font-medium text-highlighted">{{ entry.worker?.fullName }}</span>
        <span class="text-muted">logged</span>
        <UBadge :color="entry.isVoided ? 'neutral' : 'primary'" variant="subtle" size="sm" icon="i-lucide-timer" :label="formatDuration(entry.minutes)" :class="entry.isVoided ? 'line-through' : ''" />
        <span class="text-muted">for {{ formatLongDate(entry.workDate) }}</span>
        <span v-if="entry.editedAt && !entry.isVoided" class="text-xs text-muted" :title="`Corrected ${formatDateTime(entry.editedAt)}`">(corrected)</span>
        <UDropdownMenu v-if="menu.length" :items="menu" :content="{ align: 'end' }">
          <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="xs" square class="ms-auto opacity-60 group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100" :aria-label="`Actions for time entry of ${formatDuration(entry.minutes)}`" />
        </UDropdownMenu>
      </div>
      <p v-if="entry.description && !editing" class="mt-0.5 text-default" :class="entry.isVoided ? 'text-muted line-through' : ''">{{ entry.description }}</p>
      <p v-if="entry.isVoided" class="mt-0.5 text-xs text-muted">
        Voided{{ entry.voidedBy ? ` by ${entry.voidedBy.fullName}` : '' }}{{ entry.voidReason ? `: ${entry.voidReason}` : '' }} · not counted
      </p>
      <form v-if="editing" class="mt-2 flex flex-wrap items-end gap-2" novalidate @submit.prevent="saveEdit">
        <UFormField label="Time spent"><UInput v-model="editDuration" class="w-28" aria-label="Corrected time spent" /></UFormField>
        <UFormField label="Work date"><DatePicker v-model="editDate" :max-value="today" aria-label="Corrected work date" /></UFormField>
        <UFormField label="Note" class="min-w-40 flex-1"><UInput v-model="editNote" maxlength="1000" class="w-full" aria-label="Corrected note" /></UFormField>
        <UButton type="submit" size="sm" label="Save" :loading="update.pending.value" />
        <UButton size="sm" color="neutral" variant="ghost" label="Cancel" @click="editing = false" />
      </form>
      <p v-if="error && !confirmVoid" class="mt-1 text-sm text-error" role="alert">{{ error }}</p>
    </div>
    <UModal v-model:open="confirmVoid" :title="`Void ${formatDuration(entry.minutes)} logged by ${ownEntry ? 'you' : entry.worker?.fullName}?`" description="The entry stops counting towards the total. It stays visible as voided, with who voided it and why.">
      <template #body>
        <UFormField :label="ownEntry ? 'Reason (optional)' : 'Reason (required)'">
          <UInput v-model="reason" maxlength="1000" class="w-full" placeholder="e.g. Logged on the wrong task" aria-label="Void reason" />
        </UFormField>
        <p v-if="error" class="mt-2 text-sm text-error" role="alert">{{ error }}</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="confirmVoid = false" />
          <UButton color="error" label="Void entry" :disabled="!ownEntry && !reason.trim()" :loading="voidEntry.pending.value" @click="onVoid" />
        </div>
      </template>
    </UModal>
  </article>
</template>
