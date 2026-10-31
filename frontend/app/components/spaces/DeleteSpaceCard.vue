<script setup lang="ts">
import type { SpaceDetail } from '~/types/api'

// Deleting a Space (client decision 2026-10-31): the owner or a Masar administrator removes the Space
// with all its Tasks, Features, Versions, Labels, files, comments and time logs. The title must be
// typed to confirm; the server checks the permission and the title again.
const props = defineProps<{ space: SpaceDetail }>()
const { deleteSpace } = useSpaceMutations()
const toast = useToast()
const open = ref(false)
const typed = ref('')

watch(open, (value) => { if (value) typed.value = '' })
const normalise = (value: string) => value.split(/\s+/).filter(Boolean).join(' ')
const matches = computed(() => normalise(typed.value) === normalise(props.space.title))

async function confirm() {
  if (!matches.value) return
  try {
    const result = await deleteSpace.execute({ space: props.space.name, confirmTitle: typed.value })
    open.value = false
    await navigateTo('/spaces', { replace: true })
    toast.add({
      title: 'Space deleted',
      description: `${props.space.title} and ${result.tasksDeleted} ${result.tasksDeleted === 1 ? 'task' : 'tasks'} were deleted.`,
      color: 'success',
      icon: 'i-lucide-trash-2'
    })
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
      <p class="max-w-prose text-sm text-muted">
        Permanently deletes this Space with all its tasks, features, versions, labels, files, comments and
        time logs. This cannot be undone.
      </p>
      <UButton color="error" variant="soft" icon="i-lucide-trash-2" label="Delete Space" @click="open = true" />
    </div>

    <UModal v-model:open="open" :title="`Delete ${space.title}?`" description="Everything in this Space is deleted permanently, for every member.">
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
