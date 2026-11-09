<script setup lang="ts">
import type { SpaceDetail } from '~/types/api'

// Deleting a Space (client decision 2026-11-03, replacing the cascade of 2026-10-31): only a Space with
// no tasks, in any status, can be deleted; its Features, Versions, Labels and files go with it. The owner
// or a Masar administrator deletes it and types the title to confirm; the server checks the permission,
// the title and the task count again.
const props = defineProps<{ space: SpaceDetail }>()
const { deleteSpace } = useSpaceMutations()
const toast = useToast()
const open = ref(false)
const typed = ref('')
const hasTasks = computed(() => props.space.taskCount > 0)

watch(open, (value) => { if (value) typed.value = '' })
const normalise = (value: string) => value.split(/\s+/).filter(Boolean).join(' ')
const matches = computed(() => normalise(typed.value) === normalise(props.space.title))

async function confirm() {
  if (!matches.value) return
  try {
    await deleteSpace.execute({ space: props.space.name, confirmTitle: typed.value })
    open.value = false
    await navigateTo('/spaces', { replace: true })
    toast.add({ title: 'Space deleted', description: `${props.space.title} was deleted.`, color: 'success', icon: 'i-lucide-trash-2' })
  } catch {
    // Reported by the mutation toast; the Space stays.
  }
}
</script>

<template>
  <UCard :ui="{ root: 'ring-error/40' }">
    <template #header>
      <h2 class="font-medium text-error">Delete Space</h2>
    </template>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p v-if="hasTasks" class="max-w-prose text-sm text-muted" data-testid="delete-space-blocked">
        This Space still has {{ space.taskCount }} {{ space.taskCount === 1 ? 'task' : 'tasks' }}. Delete its
        tasks first; only an empty Space can be deleted.
      </p>
      <p v-else class="max-w-prose text-sm text-muted">
        Permanently deletes this Space with its features, versions, labels and files. This cannot be undone.
      </p>
      <UButton color="error" variant="soft" icon="i-lucide-trash-2" label="Delete Space" :disabled="hasTasks" @click="open = true" />
    </div>

    <UModal v-model:open="open" :title="`Delete ${space.title}?`" description="The Space is deleted permanently, for every member.">
      <template #body>
        <UFormField :label="`Type the Space title to confirm: ${space.title}`">
          <UInput v-model="typed" class="w-full" autocomplete="off" aria-label="Space title" @keydown.enter="confirm" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" label="Cancel" @click="open = false" />
          <UButton color="error" icon="i-lucide-trash-2" label="Delete permanently" :disabled="!matches" :loading="deleteSpace.pending.value" @click="confirm" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
