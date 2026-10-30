<script setup lang="ts">
import type { TaskAction } from '~/types/api'
import { errorMessage } from '~/utils/apiError'

// Checklist of a Task. Additions keep their text and idempotency key until the server confirms.
const props = defineProps<{ task: string, editable: boolean }>()

const { data: actions, status, error, refresh } = useTaskActions(() => props.task)
const mutations = useActionMutations()
const toast = useToast()

const draftKey = computed(() => `masar:action-draft:${props.task}`)
const newTitle = ref('')
const pendingId = ref<string | null>(null)
const addError = ref<string | null>(null)
const editing = ref<string | null>(null)
const editText = ref('')

onMounted(() => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey.value) ?? 'null') as { title: string, id: string | null } | null
    if (saved) {
      newTitle.value = saved.title
      pendingId.value = saved.id
    }
  } catch { /* storage unavailable */ }
})
watch([newTitle, pendingId], ([title, id]) => {
  try {
    if (title) sessionStorage.setItem(draftKey.value, JSON.stringify({ title, id }))
    else sessionStorage.removeItem(draftKey.value)
  } catch { /* storage unavailable */ }
})

async function add() {
  const title = newTitle.value.replace(/\s+/g, ' ').trim()
  if (!title || mutations.add.pending.value) return
  // The same id is reused on retry, so a request that reached the server is never duplicated.
  pendingId.value ??= crypto.randomUUID()
  addError.value = null
  try {
    await mutations.add.execute({ task: props.task, title, clientRequestId: pendingId.value })
    newTitle.value = ''
    pendingId.value = null
  } catch (caught) {
    addError.value = errorMessage(caught)
  }
}

function startEdit(action: TaskAction) {
  if (!props.editable || action.promotedTask) return
  editing.value = action.name
  editText.value = action.title
}

async function saveEdit(action: TaskAction) {
  const title = editText.value.replace(/\s+/g, ' ').trim()
  editing.value = null
  if (!title || title === action.title) return
  await mutations.update.execute({ action, title }).catch(() => refresh())
}

function move(action: TaskAction, delta: -1 | 1) {
  const list = [...(actions.value ?? [])]
  const index = list.findIndex(a => a.name === action.name)
  const target = index + delta
  if (index < 0 || target < 0 || target >= list.length) return
  list.splice(index, 1)
  list.splice(target, 0, action)
  const before = list[target + 1]?.name
  const after = list[target - 1]?.name
  void mutations.move.execute({ action, before, after, reordered: list }).catch(() => refresh())
}

async function promote(action: TaskAction) {
  try {
    const result = await mutations.promote.execute({ action })
    toast.add({
      title: result.created ? 'Promoted to a task' : 'Already promoted',
      description: result.task.title,
      color: 'success',
      icon: 'i-lucide-arrow-up-right',
      actions: [{ label: 'Open task', onClick: () => navigateTo(`/tasks/${result.task.name}`) }]
    })
  } catch { /* reported by the mutation toast */ }
}

function rowKeydown(event: KeyboardEvent, action: TaskAction) {
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault()
    move(action, event.key === 'ArrowUp' ? -1 : 1)
  }
}

function menu(action: TaskAction, index: number) {
  const last = (actions.value?.length ?? 0) - 1
  return [[
    { label: 'Move up', icon: 'i-lucide-arrow-up', kbds: ['alt', 'arrowup'], disabled: index === 0, onSelect: () => move(action, -1) },
    { label: 'Move down', icon: 'i-lucide-arrow-down', kbds: ['alt', 'arrowdown'], disabled: index === last, onSelect: () => move(action, 1) }
  ], [
    { label: action.promotedTask ? 'Already promoted' : 'Promote to task', icon: 'i-lucide-arrow-up-right', disabled: !!action.promotedTask, onSelect: () => promote(action) }
  ], [
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => mutations.remove.execute({ action }).catch(() => undefined) }
  ]]
}

const doneCount = computed(() => (actions.value ?? []).filter(a => a.isDone || a.promotedTaskCompleted).length)
</script>

<template>
  <section class="space-y-2" aria-labelledby="actions-heading">
    <div class="flex items-center justify-between">
      <h3 id="actions-heading" class="text-sm font-medium text-highlighted">
        Actions
        <span v-if="actions?.length" class="ms-1 font-normal text-muted">{{ doneCount }}/{{ actions.length }}</span>
      </h3>
    </div>

    <USkeleton v-if="status === 'pending' && !actions?.length" class="h-16" />
    <UAlert v-else-if="error" color="error" variant="subtle" :title="error.message" :actions="[{ label: 'Retry', onClick: () => refresh() }]" />

    <ul v-else class="space-y-0.5" aria-label="Actions">
      <li
        v-for="(action, index) in actions"
        :key="action.name"
        class="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-elevated/60 focus-within:bg-elevated/60"
        :data-action="action.name"
        @keydown="rowKeydown($event, action)"
      >
        <UCheckbox
          :model-value="action.promotedTask ? !!action.promotedTaskCompleted : action.isDone"
          :disabled="!editable || !!action.promotedTask"
          :aria-label="`${action.isDone ? 'Reopen' : 'Complete'} action: ${action.title}`"
          @update:model-value="(value) => mutations.setDone.execute({ action, done: value === true }).catch(() => undefined)"
        />
        <UInput
          v-if="editing === action.name"
          v-model="editText"
          size="sm"
          class="flex-1"
          autofocus
          aria-label="Edit action"
          maxlength="240"
          @keydown.enter.prevent="saveEdit(action)"
          @keydown.esc.prevent="editing = null"
          @blur="saveEdit(action)"
        />
        <button
          v-else
          type="button"
          class="min-w-0 flex-1 truncate text-left text-sm"
          :class="action.isDone || action.promotedTaskCompleted ? 'text-muted line-through' : 'text-default'"
          :disabled="!editable || !!action.promotedTask"
          :aria-label="`Edit action: ${action.title}`"
          @click="startEdit(action)"
        >
          {{ action.title }}
        </button>
        <ULink v-if="action.promotedTask" :to="`/tasks/${action.promotedTask}`" class="flex shrink-0 items-center gap-1 text-xs text-primary">
          <UIcon name="i-lucide-arrow-up-right" class="size-3.5" /> Promoted task
        </ULink>
        <UDropdownMenu v-if="editable" :items="menu(action, index)" :content="{ align: 'end' }">
          <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="xs" square :aria-label="`More options for ${action.title}`" class="opacity-60 group-hover:opacity-100" />
        </UDropdownMenu>
      </li>
    </ul>

    <form v-if="editable" class="flex items-center gap-2" @submit.prevent="add">
      <UIcon name="i-lucide-plus" class="size-4 shrink-0 text-dimmed" />
      <UInput v-model="newTitle" variant="none" placeholder="Add an action…" class="flex-1" :ui="{ base: 'px-0' }" aria-label="New action" maxlength="240" />
      <UButton v-if="newTitle.trim()" type="submit" size="xs" label="Add" :loading="mutations.add.pending.value" />
    </form>
    <UAlert
      v-if="addError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Action not saved"
      :description="`${addError} Your text is kept.`"
      :actions="[{ label: 'Retry', onClick: add }]"
      data-testid="action-error"
    />
  </section>
</template>
