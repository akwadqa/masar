<script setup lang="ts">
import type { UserRef } from '~/types/api'

// Async search over active Masar users (server-authorised). Used for owners and new members.
const props = defineProps<{ space?: string, placeholder?: string, initial?: UserRef | null, ariaLabel?: string }>()
const model = defineModel<string | undefined>()

const searchTerm = ref('')
const loading = ref(false)
const results = ref<UserRef[]>([])
const selected = ref<UserRef | null>(props.initial ?? null)
let timer: ReturnType<typeof setTimeout> | undefined
let requestId = 0

async function search(term: string) {
  const id = ++requestId
  loading.value = true
  try {
    const users = await searchUserCandidates(term, props.space)
    if (id === requestId) results.value = users
  } catch {
    if (id === requestId) results.value = []
  } finally {
    if (id === requestId) loading.value = false
  }
}

watch(searchTerm, (term) => {
  clearTimeout(timer)
  timer = setTimeout(() => search(term), 200)
})
onMounted(() => search(''))
onBeforeUnmount(() => clearTimeout(timer))

const items = computed(() => {
  const list = [...results.value]
  if (selected.value && !list.some(u => u.name === selected.value!.name)) list.unshift(selected.value)
  return list.map(user => ({
    label: user.fullName,
    description: user.name,
    value: user.name,
    avatar: { src: user.image ?? undefined, alt: user.fullName }
  }))
})

function onUpdate(value: string | undefined) {
  model.value = value
  selected.value = [...results.value, ...(selected.value ? [selected.value] : [])].find(u => u.name === value) ?? null
}
</script>

<template>
  <USelectMenu
    :model-value="model"
    v-model:search-term="searchTerm"
    :items="items"
    value-key="value"
    ignore-filter
    :loading="loading"
    :placeholder="placeholder ?? 'Search people'"
    :search-input="{ placeholder: 'Search by name or email' }"
    class="w-full"
    :aria-label="ariaLabel ?? placeholder ?? 'Select a person'"
    @update:model-value="onUpdate"
  >
    <template #empty>
      {{ loading ? 'Searching…' : 'No matching people' }}
    </template>
  </USelectMenu>
</template>
