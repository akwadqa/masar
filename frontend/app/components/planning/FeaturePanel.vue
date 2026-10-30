<script setup lang="ts">
const props = defineProps<{ featureName: string | null }>()
const emit = defineEmits<{ close: [] }>()

const open = computed({
  get: () => !!props.featureName,
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
    title="Feature details"
    :ui="{ content: 'w-full sm:max-w-xl', header: 'sr-only', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <FeatureDetail v-if="featureName" :key="featureName" :name="featureName" mode="panel" @deleted="emit('close')" @close="emit('close')" />
    </template>
  </USlideover>
</template>
