<script setup lang="ts">
const props = defineProps<{ releaseName: string | null }>()
const emit = defineEmits<{ close: [] }>()

const open = computed({
  get: () => !!props.releaseName,
  set: (value: boolean) => {
    if (!value) emit('close')
  }
})
</script>

<template>
  <USlideover
    v-model:open="open"
    side="right"
    :modal="false"
    :overlay="false"
    title="Release details"
    :ui="{ content: 'w-full sm:max-w-xl', header: 'sr-only', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <ReleaseDetail v-if="releaseName" :key="releaseName" :name="releaseName" mode="panel" @deleted="emit('close')" @close="emit('close')" />
    </template>
  </USlideover>
</template>
