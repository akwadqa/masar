<script setup lang="ts">
import type { SpaceDetail, SpaceMember, SpaceRole } from '~/types/api'

const props = defineProps<{ space: SpaceDetail }>()
const { user } = useSession()
const { addMember, changeRole } = useSpaceMutations()
const toast = useToast()

const canManage = computed(() => props.space.permissions.canManageMembers)
const newUser = ref<string | undefined>()
const newRole = ref<SpaceRole>('Member')
const pickerKey = ref(0)
const removing = ref<SpaceMember | null>(null)
const transferOpen = ref(false)
const roleItems = [{ label: 'Member', value: 'Member' }, { label: 'Manager', value: 'Manager' }]

async function add() {
  if (!newUser.value) return
  try {
    const space = await addMember.execute({ space: props.space.name, user: newUser.value, role: newRole.value })
    const added = space.members.find(m => m.name === newUser.value)
    toast.add({ title: `${added?.fullName ?? 'Member'} added as ${newRole.value}`, color: 'success', icon: 'i-lucide-user-plus' })
    newUser.value = undefined
    newRole.value = 'Member'
    pickerKey.value++ // reset the picker's search state
  } catch {
    // Reported by the mutation toast.
  }
}

async function setRole(member: SpaceMember, role: SpaceRole) {
  if (role === member.role) return
  try {
    await changeRole.execute({ space: props.space.name, user: member.name, role })
    toast.add({ title: `${member.fullName} is now a ${role}`, color: 'neutral', icon: 'i-lucide-shield' })
  } catch {
    // Reported by the mutation toast; the cached Space is unchanged.
  }
}
</script>

<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="font-medium text-highlighted">Members</h2>
          <p class="text-sm text-muted">{{ space.members.length }} {{ space.members.length === 1 ? 'person has' : 'people have' }} access to this Space.</p>
        </div>
        <UButton
          v-if="space.permissions.canTransferOwnership"
          color="neutral"
          variant="outline"
          icon="i-lucide-crown"
          label="Transfer ownership"
          @click="transferOpen = true"
        />
      </div>
    </template>

    <form v-if="canManage" class="flex flex-col gap-2 border-b border-default p-4 sm:flex-row" @submit.prevent="add">
      <div class="min-w-0 flex-1">
        <UserPicker :key="pickerKey" v-model="newUser" :space="space.name" placeholder="Add a person" aria-label="Person to add" />
      </div>
      <USelect v-model="newRole" :items="roleItems" class="sm:w-36" aria-label="Role for the new member" />
      <UButton type="submit" icon="i-lucide-user-plus" label="Add" :disabled="!newUser" :loading="addMember.pending.value" />
    </form>

    <ul class="divide-y divide-default" aria-label="Space members">
      <!-- Phones (QA-D03): name and e-mail keep the first line; the role and remove controls wrap below
           them, lined up with the text (avatar 2rem + gap 0.75rem). -->
      <li v-for="member in space.members" :key="member.name" class="flex items-center gap-3 px-4 py-3 max-sm:flex-wrap" :data-member="member.name">
        <UserAvatar :user="member" size="sm" />
        <div class="min-w-0 flex-1 max-sm:basis-[calc(100%-2.75rem)]">
          <p class="flex items-center gap-1.5 truncate text-sm font-medium text-highlighted">
            {{ member.fullName }}
            <span v-if="member.name === user?.user" class="font-normal text-muted">(you)</span>
            <UBadge v-if="member.name === space.owner.name" color="warning" variant="subtle" size="sm" icon="i-lucide-crown" label="Owner" />
          </p>
          <p class="truncate text-xs text-muted">{{ member.name }}</p>
        </div>
        <template v-if="canManage">
          <USelect
            :model-value="member.role"
            :items="roleItems"
            size="sm"
            class="w-32 max-sm:ms-11"
            :disabled="member.name === space.owner.name"
            :aria-label="`Role of ${member.fullName}`"
            @update:model-value="(role: string) => setRole(member, role as SpaceRole)"
          />
          <UTooltip :text="member.name === space.owner.name ? 'Transfer ownership before removing the owner' : 'Remove from Space'">
            <UButton
              icon="i-lucide-user-minus"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              :disabled="member.name === space.owner.name"
              :aria-label="`Remove ${member.fullName}`"
              @click="removing = member"
            />
          </UTooltip>
        </template>
        <UBadge v-else color="neutral" variant="outline" :label="member.role" />
      </li>
    </ul>

    <RemoveMemberModal :space="space" :member="removing" @close="removing = null" />
    <TransferOwnershipModal v-model:open="transferOpen" :space="space" />
  </UCard>
</template>
