<script setup lang="ts">
import type { RemovalImpact, SpaceDetail, SpaceMember } from '~/types/api'

const props = defineProps<{ space: SpaceDetail, member: SpaceMember | null }>()
const emit = defineEmits<{ close: [] }>()
const { user } = useSession()
const { removeMember } = useSpaceMutations()
const toast = useToast()

const impact = ref<RemovalImpact | null>(null)
const loadingImpact = ref(false)
const impactError = ref<string | null>(null)

const open = computed({
  get: () => !!props.member,
  set: (value: boolean) => { if (!value) emit('close') }
})

watch(() => props.member, async (member) => {
  impact.value = null
  impactError.value = null
  if (!member) return
  loadingImpact.value = true
  try {
    impact.value = await fetchRemovalImpact(props.space.name, member.name)
  } catch (caught) {
    impactError.value = (caught as Error).message
  } finally {
    loadingImpact.value = false
  }
}, { immediate: true })

const isSelf = computed(() => props.member?.name === user.value?.user)

async function confirm() {
  if (!props.member) return
  const member = props.member
  try {
    const result = await removeMember.execute({ space: props.space.name, user: member.name })
    toast.add({
      title: `${member.fullName} was removed`,
      description: result.tasksUpdated ? `${result.tasksUpdated} task assignment${result.tasksUpdated === 1 ? '' : 's'} updated.` : undefined,
      color: 'neutral',
      icon: 'i-lucide-user-minus'
    })
    emit('close')
    if (!result.space) await navigateTo('/spaces')
  } catch {
    // Reported by the mutation toast.
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="member ? `Remove ${member.fullName}?` : 'Remove member'" :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <div class="space-y-4 text-sm">
        <p class="text-default">
          {{ isSelf ? 'You' : member?.fullName }} will lose access to this Space and its tasks immediately.
          Their past work and history stay attributed to them.
        </p>
        <USkeleton v-if="loadingImpact" class="h-20" />
        <UAlert v-else-if="impactError" color="error" variant="subtle" :title="impactError" />
        <div v-else-if="impact" class="rounded-md border border-default p-3" data-testid="removal-impact">
          <p v-if="!impact.assignedTasks" class="text-muted">No task assignments are affected.</p>
          <ul v-else class="space-y-1.5">
            <li>Removed as assignee from <strong>{{ impact.assignedTasks }}</strong> task{{ impact.assignedTasks === 1 ? '' : 's' }} ({{ impact.openAssignedTasks }} open).</li>
            <li v-if="impact.ownershipMoves">Task ownership moves to the next assignee on <strong>{{ impact.ownershipMoves }}</strong> task{{ impact.ownershipMoves === 1 ? '' : 's' }}.</li>
            <li v-if="impact.tasksLeftUnassigned"><strong>{{ impact.tasksLeftUnassigned }}</strong> task{{ impact.tasksLeftUnassigned === 1 ? ' becomes' : 's become' }} unassigned and without an owner.</li>
          </ul>
        </div>
        <UAlert v-if="isSelf" color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="You are removing yourself" description="You will no longer be able to open this Space." />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" label="Cancel" @click="emit('close')" />
        <UButton color="error" label="Remove member" :loading="removeMember.pending.value" :disabled="loadingImpact || !!impactError" @click="confirm" />
      </div>
    </template>
  </UModal>
</template>
