<script setup lang="ts">
import type { LabelRef } from '~/types/api'

// Shared Space labels: pick existing ones or create a new one inline (server normalises and dedupes).
// Client revision 3: a wide list with colour dots and a visible "Create label" entry for the typed name.
const props = defineProps<{ space: string, selected: LabelRef[], disabled?: boolean, placeholder?: string }>()
const emit = defineEmits<{ add: [label: string], remove: [label: string] }>()

const { data: labels } = useSpaceLabels(() => props.space)
const { create } = useLabelMutations()
const searchTerm = ref('')

const items = computed(() => (labels.value ?? []).map(label => ({
  label: label.title,
  value: label.name,
  chip: { color: label.color }
})))
const model = computed(() => props.selected.map(l => l.name))
// Accessible name with the visible text (QA-D10): the chosen labels, or the placeholder.
const accessibleName = computed(() => (props.selected.length ? `Labels: ${props.selected.map(l => l.title).join(', ')}` : (props.placeholder ?? 'Add labels')))

function onUpdate(next: string[]) {
  const current = model.value
  for (const name of next.filter(n => !current.includes(n))) emit('add', name)
  for (const name of current.filter(n => !next.includes(n))) emit('remove', name)
}

async function onCreate(title: string) {
  try {
    const result = await create.execute({ space: props.space, title })
    if (!model.value.includes(result.label.name)) emit('add', result.label.name)
    searchTerm.value = ''
  } catch {
    // Reported by the mutation toast.
  }
}
</script>

<template>
  <USelectMenu
    v-model:search-term="searchTerm"
    :model-value="model"
    :items="items"
    value-key="value"
    multiple
    :disabled="disabled"
    :placeholder="placeholder ?? 'Add labels'"
    :search-input="{ placeholder: 'Find a label, or type a new one to create it', icon: 'i-lucide-search' }"
    :create-item="{ position: 'top' }"
    :content="{ align: 'start' }"
    :ui="{ content: 'w-80 min-w-80', item: 'py-2' }"
    class="w-full"
    :aria-label="accessibleName"
    @update:model-value="(value: string[]) => onUpdate(value)"
    @create="onCreate"
  >
    <template #create-item-label="{ item }">
      Create label “{{ item }}”
    </template>
    <template #empty>
      <span class="text-sm text-muted">No labels yet. Type a name to create the first one.</span>
    </template>
    <template #default>
      <LabelChips v-if="selected.length" :labels="selected" :max="4" />
      <span v-else class="text-muted">{{ placeholder ?? 'Add labels' }}</span>
    </template>
  </USelectMenu>
</template>
