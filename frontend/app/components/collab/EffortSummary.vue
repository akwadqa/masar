<script setup lang="ts">
import type { TaskDetail, TimeResult } from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'
import { formatDuration, parseEstimate } from '~/utils/duration'

// Logged total (server-computed from valid entries) and the optional remaining estimate (ADR-062).
const props = defineProps<{ task: TaskDetail, editable: boolean }>()
const emit = defineEmits<{ logged: [result: TimeResult] }>()
const formOpen = defineModel<boolean>('formOpen', { default: false })
const { update } = useTaskMutations()
const toast = useToast()

const editingEstimate = ref(false)
const estimateText = ref('')
const estimateError = ref<string | null>(null)
watch(editingEstimate, (open) => {
  if (open) {
    estimateText.value = props.task.remainingMinutes === null ? '' : formatDuration(props.task.remainingMinutes)
    estimateError.value = null
  }
})
async function saveEstimate() {
  const parsed = parseEstimate(estimateText.value)
  if (!parsed.ok) return void (estimateError.value = parsed.error)
  try {
    await update.execute({ task: props.task, changes: { remainingMinutes: parsed.minutes } })
    editingEstimate.value = false
  } catch (caught) {
    if ((caught as MasarApiError).kind === 'conflict') {
      toast.add({ title: 'Someone else changed the estimate', description: 'The latest value is shown.', color: 'warning', icon: 'i-lucide-git-compare' })
      editingEstimate.value = false
      await invalidateQueries(`task:${props.task.name}`)
    } else estimateError.value = (caught as Error).message
  }
}
</script>

<template>
  <section class="space-y-2" aria-labelledby="effort-heading">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <h3 id="effort-heading" class="sr-only">Time logged</h3>
      <span data-testid="logged-total">Logged <strong class="tabular-nums text-highlighted">{{ formatDuration(task.loggedMinutes) }}</strong></span>
      <UPopover v-model:open="editingEstimate" :disabled="!editable">
        <UButton color="neutral" variant="link" class="px-0" :disabled="!editable" data-testid="remaining-estimate" :aria-label="`Remaining ${task.remainingMinutes === null ? 'not estimated' : formatDuration(task.remainingMinutes)}${editable ? '. Edit the remaining estimate' : ''}`">
          Remaining
          <strong class="tabular-nums text-highlighted">{{ task.remainingMinutes === null ? 'not estimated' : formatDuration(task.remainingMinutes) }}</strong>
          <UIcon v-if="editable" name="i-lucide-pencil" class="size-3.5 text-muted" />
        </UButton>
        <template #content>
          <form class="w-64 space-y-2 p-3" @submit.prevent="saveEstimate">
            <UFormField label="Remaining estimate" hint="Empty = no estimate">
              <UInput v-model="estimateText" placeholder="e.g. 2h 30m" autofocus aria-label="Remaining estimate value" />
            </UFormField>
            <p v-if="estimateError" class="text-xs text-error" role="alert">{{ estimateError }}</p>
            <div class="flex justify-end gap-2">
              <UButton size="sm" color="neutral" variant="ghost" label="Cancel" @click="editingEstimate = false" />
              <UButton size="sm" type="submit" label="Save" :loading="update.pending.value" />
            </div>
          </form>
        </template>
      </UPopover>
      <UButton v-if="editable && !formOpen" class="ms-auto" color="neutral" variant="outline" icon="i-lucide-timer" label="Log time" @click="formOpen = true" />
    </div>
    <LogTimeForm v-if="formOpen" :task="task" @logged="(r) => { formOpen = false; emit('logged', r) }" @cancel="formOpen = false" />
  </section>
</template>
