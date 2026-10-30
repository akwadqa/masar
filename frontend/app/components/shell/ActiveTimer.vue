<script setup lang="ts">
import { formatClock } from '~/utils/duration'

// Sidebar reminder of the running or paused timer, from any page. It links to the timed Task.
defineProps<{ collapsed?: boolean }>()
const { user } = useSession()
const timer = useTimer()
watch(() => user.value?.isMasarUser, (isUser) => {
  if (isUser) void timer.load().catch(() => undefined)
  else timer.session.value = null
}, { immediate: true })
</script>

<template>
  <NuxtLink
    v-if="timer.session.value"
    :to="`/tasks/${timer.session.value.task}`"
    class="mt-auto flex items-center gap-2 rounded-card border border-default bg-default py-2 text-sm hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
    :class="collapsed ? 'justify-center' : 'px-2.5'"
    :aria-label="`Timer ${timer.session.value.state.toLowerCase()} on ${timer.session.value.taskTitle}: ${formatClock(timer.elapsedSeconds.value)}`"
    data-testid="active-timer"
  >
    <span class="relative flex size-2.5 shrink-0">
      <span v-if="timer.session.value.state === 'Running'" class="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
      <span class="relative inline-flex size-2.5 rounded-full" :class="timer.session.value.state === 'Running' ? 'bg-success' : 'bg-dimmed'" />
    </span>
    <span v-if="!collapsed" class="min-w-0 flex-1">
      <span class="block truncate font-medium text-highlighted">{{ timer.session.value.taskTitle }}</span>
      <span class="text-xs font-medium tabular-nums text-muted">{{ formatClock(timer.elapsedSeconds.value) }}{{ timer.session.value.state === 'Paused' ? ' · paused' : '' }}</span>
    </span>
  </NuxtLink>
</template>
