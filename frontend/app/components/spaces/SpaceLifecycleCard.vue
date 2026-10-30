<script setup lang="ts">
import type { SpaceDetail, SpaceStatus } from '~/types/api'

const props = defineProps<{ space: SpaceDetail }>()
const { setStatus } = useSpaceMutations()
const toast = useToast()
const target = ref<SpaceStatus | null>(null)

// Provisional lifecycle rules (Q-06 default, ADR-026).
const meaning: Record<SpaceStatus, string> = {
  'In Progress': 'Active work. Members create and update tasks.',
  'Completed': 'Finished successfully. Members can read; Managers can still wrap up tasks.',
  'Cancelled': 'Stopped before completion. Members can read; Managers can still wrap up tasks.',
  'Closed': 'Archived. Everything stays readable; tasks can no longer be changed until the Space is reopened.'
}
const actionLabel = (status: SpaceStatus) => (status === 'In Progress' ? 'Reopen' : `Mark ${status.toLowerCase()}`)

async function confirm() {
  if (!target.value) return
  const status = target.value
  try {
    await setStatus.execute({ space: props.space, status })
    toast.add({ title: `Space is now ${status}`, color: 'neutral', icon: 'i-lucide-flag' })
    target.value = null
  } catch {
    target.value = null
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-medium text-highlighted">Status</h2>
    </template>
    <div class="space-y-4">
      <div class="flex items-start gap-3">
        <SpaceStatusBadge :status="space.status" />
        <p class="text-sm text-muted">{{ meaning[space.status] }}</p>
      </div>
      <div v-if="space.permissions.canChangeStatus && space.permissions.allowedStatuses.length" class="flex flex-wrap gap-2">
        <UButton
          v-for="status in space.permissions.allowedStatuses"
          :key="status"
          size="sm"
          :color="status === 'In Progress' ? 'primary' : 'neutral'"
          :variant="status === 'In Progress' ? 'solid' : 'outline'"
          :label="actionLabel(status)"
          @click="target = status"
        />
      </div>
    </div>

    <UModal
      :open="!!target"
      :title="target ? `${actionLabel(target)}?` : ''"
      :description="target ? meaning[target] : ''"
      @update:open="(value: boolean) => { if (!value) target = null }"
    >
      <template #body>
        <p class="text-sm text-muted">No tasks are deleted. You can change the status again later.</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" label="Cancel" @click="target = null" />
          <UButton :label="target ? actionLabel(target) : 'Confirm'" :loading="setStatus.pending.value" @click="confirm" />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
