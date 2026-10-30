<script setup lang="ts">
// Space category (client revision 5): chosen from the shared list; a name that is not in it yet can be
// added from the same field and joins the list when the Space is saved.
const model = defineModel<string>({ required: true })
const { data: categories } = useSpaceCategories()
const added = ref<string[]>([])
const items = computed(() => [...new Set([...(categories.value ?? []), ...added.value, ...(model.value ? [model.value] : [])])]
  .sort((a, b) => a.localeCompare(b)))

function onCreate(name: string) {
  const value = name.split(/\s+/).join(' ').trim().slice(0, 140)
  if (!value) return
  // Same name in another case: use the existing entry, as the server would.
  const existing = items.value.find(item => item.toLowerCase() === value.toLowerCase())
  if (!existing) added.value = [...added.value, value]
  model.value = existing ?? value
}
</script>

<template>
  <!-- The Clear button is laid over the input's end instead of inside the menu's trigger button, so no
       button is nested in another (QA-D10); an empty trailing slot keeps the input's padding. -->
  <div class="relative w-full">
  <UInputMenu
    :model-value="model || undefined"
    :items="items"
    create-item
    placeholder="Choose or add a category"
    icon="i-lucide-tag"
    class="w-full"
    aria-label="Category"
    @update:model-value="(value: string | undefined) => model = value ?? ''"
    @create="onCreate"
  >
    <template #create-item-label="{ item }">
      Add category “{{ item }}”
    </template>
    <template v-if="model" #trailing>
      <span class="block size-4" aria-hidden="true" />
    </template>
  </UInputMenu>
  <span v-if="model" class="absolute inset-y-0 end-0 flex items-center pe-2.5">
    <UButton icon="i-lucide-x" color="neutral" variant="link" size="xs" aria-label="Clear category" @click.stop="model = ''" />
  </span>
  </div>
</template>
