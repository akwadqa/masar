<script setup lang="ts">
import type { EditableSpaceFields, SpaceDetail } from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'
import { htmlToText, textToHtml } from '~/utils/format'
import type { SpaceFormState } from './SpaceForm.vue'

const props = defineProps<{ space: SpaceDetail }>()
const { update } = useSpaceMutations()
const toast = useToast()
const conflict = ref(false)

const fromSpace = (space: SpaceDetail): SpaceFormState => ({
  title: space.title,
  category: space.category ?? '',
  spaceType: space.spaceType,
  completionDate: space.completionDate,
  gameplanUrl: space.gameplanUrl ?? '',
  details: htmlToText(space.details)
})
const state = ref<SpaceFormState>(fromSpace(props.space))
let baseline = JSON.stringify(state.value)
const reset = () => {
  state.value = fromSpace(props.space)
  baseline = JSON.stringify(state.value)
}
// Follow server updates (e.g. after membership changes) unless the user has unsaved edits.
watch(() => props.space.modified, () => {
  if (JSON.stringify(state.value) === baseline) reset()
})

function changes(): Partial<EditableSpaceFields> {
  const s = state.value
  const next: EditableSpaceFields = {
    title: s.title.trim(),
    category: s.category.trim() || null,
    spaceType: s.spaceType,
    completionDate: s.completionDate,
    gameplanUrl: s.gameplanUrl.trim() || null,
    details: htmlToText(props.space.details) === s.details.trim() ? props.space.details : textToHtml(s.details)
  }
  const diff: Partial<EditableSpaceFields> = {}
  for (const key of Object.keys(next) as Array<keyof EditableSpaceFields>) {
    if ((next[key] ?? null) !== ((props.space as unknown as Record<string, unknown>)[key] ?? null)) {
      (diff as Record<string, unknown>)[key] = next[key]
    }
  }
  return diff
}

async function save() {
  conflict.value = false
  const diff = changes()
  if (!Object.keys(diff).length) {
    toast.add({ title: 'No changes to save', color: 'neutral' })
    return
  }
  try {
    const space = await update.execute({ space: props.space, changes: diff })
    state.value = fromSpace(space)
    baseline = JSON.stringify(state.value)
    toast.add({ title: 'Space details saved', color: 'success', icon: 'i-lucide-circle-check' })
  } catch (caught) {
    if ((caught as MasarApiError).kind === 'conflict') {
      conflict.value = true
      await invalidateQueries(`space:${props.space.name}`)
    }
  }
}
</script>

<template>
  <UCard id="details">
    <template #header>
      <h2 class="font-medium text-highlighted">Details</h2>
    </template>
    <UAlert
      v-if="conflict"
      color="warning"
      variant="subtle"
      icon="i-lucide-git-compare"
      title="Someone else changed these details"
      description="Load the latest values, then apply your edits again."
      :actions="[{ label: 'Load latest', color: 'warning', onClick: () => { reset(); conflict = false } }]"
      class="mb-4"
    />
    <SpaceIdentityPicker :space="space" class="mb-5" />
    <SpaceForm v-model="state" submit-label="Save details" :pending="update.pending.value" @submit="save" @cancel="reset" />
  </UCard>
</template>
