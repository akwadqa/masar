<script setup lang="ts">
import type { Label, LabelColor, SpaceDetail } from '~/types/api'
import { LABEL_COLORS } from '~/types/api'

// Labels of one Space (client revision 3: labels are Space-scoped). Managers create labels with a
// colour, rename or recolour them, and delete them; members also create labels from the Task picker.
const props = defineProps<{ space: SpaceDetail }>()
const { data: labels } = useSpaceLabels(() => props.space.name)
const { create, update, remove } = useLabelMutations()
const toast = useToast()

const title = ref('')
const color = ref<LabelColor>('primary')
const deleting = ref<Label | null>(null)
const colorItems = LABEL_COLORS.map(value => ({ label: value[0]!.toUpperCase() + value.slice(1), value, chip: { color: value } }))

async function add() {
  const value = title.value.replace(/\s+/g, ' ').trim()
  if (!value) return
  const result = await create.execute({ space: props.space.name, title: value, color: color.value }).catch(() => null)
  if (!result) return
  title.value = ''
  if (!result.created) toast.add({ title: `“${result.label.title}” already exists`, color: 'neutral', icon: 'i-lucide-tag' })
}
function rename(label: Label, value: string) {
  const next = value.replace(/\s+/g, ' ').trim()
  if (next && next !== label.title) void update.execute({ space: props.space.name, label: label.name, title: next }).catch(() => undefined)
}
async function confirmDelete() {
  if (!deleting.value) return
  await remove.execute({ space: props.space.name, label: deleting.value.name }).catch(() => undefined)
  deleting.value = null
}
</script>

<template>
  <UCard :ui="{ body: 'space-y-4' }">
    <template #header>
      <div class="space-y-1">
        <h2 class="text-section text-highlighted">Labels</h2>
        <p class="text-sm text-muted">Labels belong to this Space. Everyone who can edit tasks can add them to tasks or create new ones from a task.</p>
      </div>
    </template>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="add">
      <UFormField label="New label" class="min-w-56 flex-1">
        <UInput v-model="title" placeholder="e.g. Client feedback" maxlength="60" class="w-full" aria-label="New label name" />
      </UFormField>
      <UFormField label="Colour">
        <USelect v-model="color" :items="colorItems" class="w-40" aria-label="New label colour" />
      </UFormField>
      <UButton type="submit" icon="i-lucide-plus" label="Create label" :loading="create.pending.value" :disabled="!title.trim()" />
    </form>
    <ul v-if="labels?.length" class="divide-y divide-default rounded-card border border-default" aria-label="Labels of this Space">
      <li v-for="label in labels" :key="label.name" class="flex flex-wrap items-center gap-3 px-3 py-2">
        <UBadge :color="label.color" variant="soft" :label="label.title" class="max-w-48 truncate" />
        <UInput
          :model-value="label.title"
          class="min-w-40 flex-1"
          variant="ghost"
          maxlength="60"
          :aria-label="`Rename ${label.title}`"
          @change="(event: Event) => rename(label, (event.target as HTMLInputElement).value)"
        />
        <USelect
          :model-value="label.color"
          :items="colorItems"
          class="w-36"
          :aria-label="`Colour of ${label.title}`"
          @update:model-value="(value) => update.execute({ space: space.name, label: label.name, color: value as LabelColor }).catch(() => undefined)"
        />
        <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" square :aria-label="`Delete ${label.title}`" @click="deleting = label" />
      </li>
    </ul>
    <p v-else class="text-sm text-muted">No labels yet.</p>

    <UModal
      :open="!!deleting"
      :title="`Delete the label “${deleting?.title ?? ''}”?`"
      description="It is removed from every task of this Space. Tasks are not deleted."
      @update:open="(value) => { if (!value) deleting = null }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="deleting = null" />
          <UButton color="error" label="Delete label" :loading="remove.pending.value" @click="confirmDelete" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
