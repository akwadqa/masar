<script setup lang="ts">
import type { SpaceDetail } from '~/types/api'

const props = defineProps<{ space: SpaceDetail }>()
const open = defineModel<boolean>('open', { required: true })
const { transferOwnership } = useSpaceMutations()
const toast = useToast()
const newOwner = ref<string | undefined>()

watch(open, (value) => { if (value) newOwner.value = undefined })

const candidates = computed(() => props.space.members
  .filter(member => member.name !== props.space.owner.name)
  .map(member => ({ label: `${member.fullName} (${member.role})`, value: member.name })))
const chosen = computed(() => props.space.members.find(m => m.name === newOwner.value))

async function confirm() {
  if (!newOwner.value) return
  try {
    const space = await transferOwnership.execute({ space: props.space, newOwner: newOwner.value })
    toast.add({ title: 'Ownership transferred', description: `${space.owner.fullName} now owns this Space.`, color: 'success', icon: 'i-lucide-crown' })
    open.value = false
  } catch {
    // Reported by the mutation toast; the latest Space is reloaded on conflict.
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Transfer ownership" description="The owner is accountable for this Space and always stays a Manager." :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <div class="space-y-4 text-sm">
        <UFormField label="New owner" help="Only current members can become the owner.">
          <USelect v-model="newOwner" :items="candidates" placeholder="Choose a member" class="w-full" aria-label="New owner" />
        </UFormField>
        <p v-if="chosen" class="text-muted">
          {{ chosen.fullName }} becomes the owner{{ chosen.role === 'Member' ? ' and is promoted to Manager' : '' }}.
          {{ space.owner.fullName }} stays a Manager.
        </p>
        <p v-if="!candidates.length" class="text-muted">Add another member first.</p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" label="Cancel" @click="open = false" />
        <UButton label="Transfer ownership" :disabled="!newOwner" :loading="transferOwnership.pending.value" @click="confirm" />
      </div>
    </template>
  </UModal>
</template>
