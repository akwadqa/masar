<script setup lang="ts">
import type { TimeResult } from '~/types/api'
import { formatDateTime } from '~/utils/format'
import { rememberRecent } from '~/utils/recent'
import { TASK_FIELD_LABELS } from '~/composables/workspace/useTaskEditor'
import { transferFiles } from '~/utils/transferFiles'

// One Task editor for the side panel and the full page (client revisions 2 and 3): Feature and Release
// as icons in the header; title, property chips (status first) and the people (owner and assignees,
// always visible); the Markdown description; the time box (timer, logged and
// remaining); Actions, attachments and activity; record details as a footer.
const props = defineProps<{ name: string, mode: 'panel' | 'page' }>()
const emit = defineEmits<{ deleted: [], close: [] }>()
// Direct comment links: /tasks/<task>?comment=<id> (page) or ?task=<task>&comment=<id> (panel).
const route = useRoute()
const focusComment = computed(() => (typeof route.query.comment === 'string' ? route.query.comment : null))
const toast = useToast()

const editor = useTaskEditor(() => props.name)
const { task, status, error, refresh, editable, conflict, mutations } = editor
const { data: members } = useSpaceMembers(() => task.value?.space ?? '')

// Time tracking: the Log time form lives in the effort summary; the Worklog can open it.
const logTimeOpen = ref(false)
const timelineRef = ref<{ entryLogged: (result: TimeResult) => void } | null>(null)
function openLogTime() {
  logTimeOpen.value = true
  void nextTick(() => document.getElementById('effort-heading')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
}

// Local title buffer; it follows the server value except while the user is editing.
const title = ref('')
const editing = reactive({ title: false })
watch(task, (value) => {
  if (!value) return
  rememberRecent(value.name)
  if (!editing.title) title.value = value.title
}, { immediate: true })

function commitTitle() {
  editing.title = false
  const value = title.value.replace(/\s+/g, ' ').trim()
  if (!task.value) return
  if (!value) {
    title.value = task.value.title
    toast.add({ title: 'A task needs a title.', color: 'warning' })
    return
  }
  if (value !== task.value.title) void editor.save({ title: value })
}


// Files dropped anywhere on the Task, or images pasted outside a text field, become Task attachments.
const bodyRef = ref<HTMLElement | null>(null)
const attachmentsRef = ref<{ upload: (files: File[]) => Promise<void> } | null>(null)
const { dragging } = useFileDrop(bodyRef, files => void attachmentsRef.value?.upload(files), () => editable.value)
function onPaste(event: ClipboardEvent) {
  const target = event.target as HTMLElement | null
  if (!editable.value || target?.closest('input, textarea, [contenteditable="true"]')) return
  const files = transferFiles(event.clipboardData)
  if (!files.length) return
  event.preventDefault()
  void attachmentsRef.value?.upload(files)
}

const confirmDelete = ref(false)
async function deleteTask() {
  if (!task.value) return
  try {
    await mutations.remove.execute({ task: task.value })
    confirmDelete.value = false
    toast.add({ title: 'Task deleted', color: 'neutral', icon: 'i-lucide-trash-2' })
    emit('deleted')
  } catch {
    confirmDelete.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div v-if="status === 'pending' && !task" class="space-y-4 p-6">
      <USkeleton class="h-8 w-3/4" />
      <USkeleton class="h-24" />
      <USkeleton class="h-40" />
    </div>

    <StatePanel
      v-else-if="error?.kind === 'not_found' || (!task && status === 'success')"
      icon="i-lucide-file-x"
      title="Task not found"
      description="This task does not exist or you do not have access to it."
    >
      <UButton v-if="mode === 'panel'" color="neutral" variant="outline" label="Close" @click="emit('close')" />
      <UButton v-else to="/spaces" label="Go to Spaces" />
    </StatePanel>

    <StatePanel v-else-if="error && !task" tone="error" icon="i-lucide-cloud-off" title="This task could not be loaded" :description="error.message">
      <UButton label="Try again" @click="refresh()" />
    </StatePanel>

    <template v-else-if="task">
      <TaskDetailHeader :task="task" :mode="mode" @delete="confirmDelete = true" @close="emit('close')">
        <template #planning>
          <TaskPlanningLink kind="feature" :task="task" :editor="editor" />
          <TaskPlanningLink kind="release" :task="task" :editor="editor" />
        </template>
      </TaskDetailHeader>

      <div ref="bodyRef" class="relative flex min-h-0 flex-1 flex-col" @paste="onPaste">
      <div
        v-if="dragging"
        class="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-card border-2 border-dashed border-primary bg-primary/10 text-sm font-semibold text-primary backdrop-blur-[1px]"
        aria-hidden="true"
      >
        Drop files to attach them to this task
      </div>
      <!-- `relative` makes this scroller the containing block of absolutely positioned descendants
           (sr-only headings, menu internals). Otherwise they are placed against the outer box, stick out
           below it and make the side panel's own body scroll, leaving a blank area under the task. -->
      <div class="relative flex-1 space-y-7 overflow-y-auto p-5 sm:p-7">
        <UAlert
          v-if="!editable"
          color="neutral"
          variant="subtle"
          icon="i-lucide-lock"
          title="This task is read-only"
          description="The Space is not active, or your role does not allow changes."
        />
        <UAlert
          v-if="conflict"
          color="warning"
          variant="subtle"
          icon="i-lucide-git-compare"
          :title="`Someone else changed the ${TASK_FIELD_LABELS[conflict.field]}`"
          description="The latest value is shown. You can keep it or apply your change again."
          :actions="[
            { label: 'Keep theirs', color: 'neutral', variant: 'outline', onClick: () => { conflict = null } },
            { label: 'Use mine', color: 'warning', onClick: editor.applyMine }
          ]"
        />

        <div class="space-y-4">
          <UTextarea
            v-model="title"
            :rows="1"
            autoresize
            variant="none"
            class="w-full"
            :ui="{ base: 'px-0 !text-2xl font-semibold font-display text-highlighted resize-none' }"
            aria-label="Task title"
            :disabled="!editable"
            maxlength="240"
            data-testid="task-title"
            @focus="editing.title = true"
            @blur="commitTitle"
            @keydown.enter.prevent="($event.target as HTMLTextAreaElement).blur()"
            @keydown.esc="title = task.title; ($event.target as HTMLTextAreaElement).blur()"
          />
          <TaskPropertyChips :task="task" :editor="editor" />
          <TaskPeoplePicker
            :assignees="task.assignees"
            :owner="task.taskOwner"
            :owner-ref="task.taskOwnerRef"
            :members="members ?? []"
            :disabled="!editable"
            @toggle="editor.toggleAssignee"
            @owner="editor.setOwner"
          />
        </div>

        <TaskDescription :value="task.description" :editable="editable" @save="(markdown) => editor.save({ description: markdown })" />

        <TaskActions :task="task.name" :editable="editable" />

        <TaskAttachments ref="attachmentsRef" :task="task.name" :can-upload="editable" />

        <!-- Time sits below attachments and above the activity (client revision 4). -->
        <section class="space-y-4 rounded-card bg-elevated/70 p-4 sm:p-5" aria-label="Time">
          <TaskTimer :task="task" :editable="editable" @logged="(result) => timelineRef?.entryLogged(result)" />
          <USeparator />
          <EffortSummary v-model:form-open="logTimeOpen" :task="task" :editable="editable" @logged="(result) => timelineRef?.entryLogged(result)" />
        </section>

        <TaskTimeline ref="timelineRef" :task="task.name" :can-comment="editable" :focus-comment="focusComment" class="border-t border-default pt-6" @log-time="openLogTime" />

        <footer class="border-t border-default pt-4" aria-label="Task record">
          <dl class="flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-muted">
            <div class="flex gap-1">
              <dt>Created by</dt>
              <dd class="text-default">{{ task.createdBy?.fullName ?? 'Unknown' }}</dd>
              <dd>· {{ formatDateTime(task.creation) }}</dd>
            </div>
            <div v-if="task.sourceTask" class="flex gap-1">
              <dt>Promoted from</dt>
              <dd><ULink :to="`/tasks/${task.sourceTask.name}`" class="text-primary">{{ task.sourceTask.title }}</ULink></dd>
            </div>
            <div v-if="task.isCompleted && task.completedBy" class="flex gap-1">
              <dt>{{ task.status }} by</dt>
              <dd class="text-default">{{ task.completedBy.fullName }}</dd>
              <dd>· {{ formatDateTime(task.completedAt) }}</dd>
            </div>
          </dl>
        </footer>
      </div>
      </div>

      <UModal v-model:open="confirmDelete" title="Delete this task?" description="This permanently deletes the task and its history. This cannot be undone.">
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton color="neutral" variant="outline" label="Cancel" @click="confirmDelete = false" />
            <UButton color="error" label="Delete task" :loading="mutations.remove.pending.value" @click="deleteTask" />
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>
