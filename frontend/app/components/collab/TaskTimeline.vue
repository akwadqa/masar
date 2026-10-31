<script setup lang="ts">
import type { TaskComment, TimelineView, TimeResult } from '~/types/api'
import { describeHistory } from '~/utils/history'
import { useNow } from '@vueuse/core'
import { businessToday, formatDayHeading, formatTime } from '~/utils/format'

// Comments | History | Worklog (plus All). Comments is the view a Task opens on (client revision 5).
// Newest first with the composer on top (client request, Oct 2026; supersedes ADR-057's oldest-first
// display). useTimeline keeps items oldest first because its cursors and polling depend on that order;
// only this view reverses them.
const props = defineProps<{ task: string, canComment: boolean, focusComment?: string | null }>()
const emit = defineEmits<{ logTime: [] }>()
const view = ref<TimelineView>('comments')
const anchor = ref<string | null>(props.focusComment ?? null)
watch(() => props.focusComment, (value) => { if (value) { anchor.value = value; view.value = 'comments' } })
const timeline = useTimeline(() => props.task, view, anchor)
const highlighted = ref<string | null>(null)

// Deep link: once the page holding the comment has loaded, bring it into view and mark it.
watch(() => [timeline.status.value, anchor.value] as const, async ([state, target]) => {
  if (state !== 'success' || !target) return
  await nextTick()
  const element = document.getElementById(`comment-${target}`)
  if (element) {
    element.scrollIntoView({ block: 'center', behavior: 'smooth' })
    highlighted.value = target
    setTimeout(() => { if (highlighted.value === target) highlighted.value = null }, 4000)
  }
}, { immediate: true })

const views = [
  { label: 'All', value: 'all' },
  { label: 'Comments', value: 'comments' },
  { label: 'History', value: 'history' },
  { label: 'Worklog', value: 'worklog' }
]
function setView(value: string | number) {
  anchor.value = null
  view.value = value as TimelineView
}
function onTimeChanged(result: TimeResult) {
  timeline.upsertEntry(result.entry)
}
// Called by Task details after a new entry was logged elsewhere in the panel.
defineExpose({ entryLogged: (result: TimeResult) => timeline.upsertEntry(result.entry) })

const newestFirst = computed(() => [...timeline.items.value].reverse())
// One clock for every comment's relative time ("5 minutes ago").
const now = useNow({ interval: 60_000 })

// A day heading before the first (newest) item of each business day.
const startsDay = (index: number) => {
  const items = newestFirst.value
  return index === 0 || businessToday(new Date(items[index]!.at)) !== businessToday(new Date(items[index - 1]!.at))
}

function onSaved(comment: TaskComment) {
  timeline.upsertComment(comment)
  if (timeline.laterCursor.value) void timeline.load()
}
</script>

<template>
  <section class="space-y-3" aria-labelledby="activity-heading">
    <div class="flex flex-wrap items-center gap-2">
      <h3 id="activity-heading" class="text-sm font-semibold text-highlighted">Activity</h3>
      <UTabs :model-value="view" :items="views" :content="false" size="xs" variant="pill" class="ms-auto" :ui="{ trigger: 'data-[state=inactive]:text-toned' }" @update:model-value="setView" />
    </div>

    <CommentComposer v-if="canComment && view !== 'history' && view !== 'worklog'" :task="task" @saved="onSaved" />
    <p v-else-if="!canComment && view !== 'history'" class="text-xs text-muted">This task is read-only for you in this Space.</p>

    <div v-if="timeline.status.value === 'pending' && !timeline.items.value.length" class="space-y-2">
        <USkeleton v-for="i in 3" :key="i" class="h-14" />
      </div>
      <UAlert v-else-if="timeline.status.value === 'error'" color="error" variant="subtle" icon="i-lucide-cloud-off" :title="timeline.error.value?.message ?? 'Activity could not be loaded'" :actions="[{ label: 'Try again', onClick: () => timeline.load() }]" />
      <template v-else>
        <UButton v-if="timeline.laterCursor.value" size="xs" color="neutral" variant="link" icon="i-lucide-chevrons-up" label="Show newer activity" :loading="timeline.loadingMore.value" @click="timeline.loadLater()" />
        <div v-if="!timeline.items.value.length && view === 'worklog'" class="flex flex-wrap items-center gap-3 text-sm text-muted">
          No time logged yet.
          <UButton v-if="canComment" size="xs" color="neutral" variant="outline" icon="i-lucide-timer" label="Log time" @click="emit('logTime')" />
        </div>
        <p v-else-if="!timeline.items.value.length" class="text-sm text-muted">
          {{ view === 'history' ? 'No recorded changes yet.' : canComment ? 'No comments yet. Start the discussion above.' : 'No comments yet.' }}
        </p>
        <ol class="space-y-1" aria-label="Activity timeline">
          <li v-for="(item, index) in newestFirst" :key="item.id">
            <p v-if="startsDay(index)" class="flex items-center gap-3 py-2 text-xs font-semibold text-dimmed" role="separator">
              <span class="h-px flex-1 bg-(--ui-border)" />{{ formatDayHeading(item.at) }}<span class="h-px flex-1 bg-(--ui-border)" />
            </p>
            <TimeEntryItem v-if="item.kind === 'time'" :entry="item.entry" @changed="onTimeChanged" />
            <CommentItem v-else-if="item.kind === 'comment'" :comment="item.comment" :highlighted="highlighted === item.comment.name" :now="now" @changed="timeline.upsertComment" />
            <p v-else class="flex items-baseline gap-2 ps-11 pe-2 py-0.5 text-xs text-dimmed">
              <span class="size-1.5 shrink-0 -translate-y-px rounded-full bg-(--ui-border-accented)" aria-hidden="true" />
              <span class="min-w-0">{{ describeHistory(item.history) }}</span>
              <time class="ms-auto shrink-0 tabular-nums" :datetime="item.at">{{ formatTime(item.at) }}</time>
            </p>
          </li>
        </ol>
        <UButton v-if="timeline.earlierCursor.value" size="xs" color="neutral" variant="link" icon="i-lucide-chevrons-down" label="Show earlier activity" :loading="timeline.loadingMore.value" @click="timeline.loadEarlier()" />
      </template>
  </section>
</template>
