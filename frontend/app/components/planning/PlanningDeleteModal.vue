<script setup lang="ts">
// Deletion never cascades to Tasks (ADR-039): with linked Tasks the Manager must explicitly
// choose to remove them from the record; the Tasks themselves are kept.
const props = defineProps<{ kind: 'Feature' | 'Release', title: string, linked: number, pending: boolean, hint?: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirm: [detach: boolean] }>()
const detach = ref(false)
watch(open, (value) => { if (value) detach.value = false })
const blocked = computed(() => props.linked > 0 && !detach.value)
</script>

<template>
  <UModal v-model:open="open" :title="`Delete ${kind.toLowerCase()} “${title}”?`" :description="linked ? undefined : 'This cannot be undone.'">
    <template v-if="linked" #body>
      <div class="space-y-3 text-sm">
        <p>
          {{ linked }} task{{ linked === 1 ? ' is' : 's are' }} linked to this {{ kind }}. Tasks are never deleted with it.
          <span v-if="hint">{{ hint }}</span>
        </p>
        <UCheckbox v-model="detach" :label="`Remove ${linked === 1 ? 'the task' : `all ${linked} tasks`} from this ${kind} and delete it`" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
        <UButton color="error" :label="`Delete ${kind}`" :disabled="blocked" :loading="pending" @click="emit('confirm', detach)" />
      </div>
    </template>
  </UModal>
</template>
