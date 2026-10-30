<script setup lang="ts">
import type { TaskDetail, TimeResult } from '~/types/api'
import { formatClock, formatDuration } from '~/utils/duration'

// Start/stop timer of a Task. Stopping creates exactly one Time Entry for the measured time (or a
// shorter, explicit duration) and never changes the remaining estimate. One active timer per person.
const props = defineProps<{ task: TaskDetail, editable: boolean }>()
const emit = defineEmits<{ logged: [result: TimeResult] }>()
const timer = useTimer()
const toast = useToast()

const here = computed(() => timer.session.value?.task === props.task.name)
const elsewhere = computed(() => !!timer.session.value && !here.value)
const busy = ref(false)
const stopping = ref(false)
const minutes = ref<number | undefined>()
const note = ref('')
const measuredMinutes = computed(() => Math.max(1, Math.round(timer.elapsedSeconds.value / 60)))

async function run(action: () => Promise<unknown>) {
  busy.value = true
  try {
    await action()
  } catch { /* reported by useTimer */ } finally {
    busy.value = false
  }
}

function openStop() {
  minutes.value = timer.overLimit.value ? undefined : measuredMinutes.value
  note.value = ''
  stopping.value = true
}

async function confirmStop() {
  await run(async () => {
    const result = await timer.stop({ minutes: minutes.value, description: note.value.trim() || undefined })
    stopping.value = false
    if (result.result) {
      emit('logged', result.result)
      toast.add({ title: `${formatDuration(result.minutes ?? 0)} logged`, description: props.task.title, color: 'success', icon: 'i-lucide-timer' })
    }
  })
}

async function switchHere() {
  await run(async () => {
    await timer.stop()
    await timer.start(props.task.name)
  })
}
</script>

<template>
  <section aria-labelledby="timer-heading">
    <div class="flex flex-wrap items-center gap-2">
      <UIcon name="i-lucide-timer" class="size-4 text-dimmed" />
      <h3 id="timer-heading" class="text-section text-highlighted">Timer</h3>

      <template v-if="here">
        <span class="text-lg font-semibold tabular-nums text-highlighted" role="timer" :aria-label="`Elapsed ${formatClock(timer.elapsedSeconds.value)}`" data-testid="timer-clock">
          {{ formatClock(timer.elapsedSeconds.value) }}
        </span>
        <UBadge :color="timer.session.value!.state === 'Running' ? 'success' : 'neutral'" variant="subtle" :label="timer.session.value!.state" />
        <div class="ms-auto flex gap-1">
          <UButton v-if="timer.session.value!.state === 'Running'" color="neutral" variant="outline" icon="i-lucide-pause" label="Pause" :loading="busy" @click="run(timer.pause)" />
          <UButton v-else color="neutral" variant="outline" icon="i-lucide-play" label="Resume" :loading="busy" @click="run(timer.resume)" />
          <UButton icon="i-lucide-square" label="Stop" :disabled="busy" @click="openStop" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-trash-2" square aria-label="Discard timer" :disabled="busy" @click="run(timer.discard)" />
        </div>
      </template>
      <template v-else-if="elsewhere">
        <span class="text-sm text-muted">Running on <ULink :to="`/tasks/${timer.session.value!.task}`" class="text-primary">{{ timer.session.value!.taskTitle }}</ULink></span>
        <UButton v-if="editable" class="ms-auto" color="neutral" variant="outline" icon="i-lucide-repeat" label="Stop it and start here" :loading="busy" @click="switchHere" />
      </template>
      <UButton v-else-if="editable" class="ms-auto" icon="i-lucide-play" label="Start timer" :loading="busy" @click="run(() => timer.start(task.name))" />
      <span v-else class="ms-auto text-sm text-muted">Read-only</span>
    </div>

    <form v-if="here && stopping" class="mt-4 grid gap-3 border-t border-default pt-4 sm:grid-cols-[8rem_1fr_auto]" @submit.prevent="confirmStop">
      <UFormField :label="timer.overLimit.value ? 'Minutes worked' : 'Minutes'" :help="timer.overLimit.value ? 'Over 24 hours: enter the real time.' : `Measured ${formatDuration(measuredMinutes)}`">
        <UInputNumber v-model="minutes" :min="1" :max="measuredMinutes" required aria-label="Minutes to log" data-testid="timer-minutes" />
      </UFormField>
      <UFormField label="Work note">
        <UInput v-model="note" placeholder="Optional" aria-label="Timer work note" class="w-full" />
      </UFormField>
      <div class="flex items-end gap-1">
        <UButton type="submit" label="Save time entry" :loading="busy" :disabled="!minutes" />
        <UButton color="neutral" variant="ghost" label="Cancel" @click="stopping = false" />
      </div>
    </form>
  </section>
</template>
