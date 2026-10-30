<script setup lang="ts">
import { parseDate, type CalendarDate } from '@internationalized/date'
import type { MasarApiError } from '~/utils/apiError'
import { inclusiveDays } from '~/utils/batchDates'

const route = useRoute()
const router = useRouter()
const name = computed(() => String(route.params.batch))
const { data: batch, status, error, refresh } = useBatch(name)
const mutations = useBatchMutations()
const toast = useToast()
const { user } = useSession()
useHead(() => ({ title: batch.value ? `${batch.value.batchName} · Masar` : 'Sprint · Masar' }))

type Tab = 'tasks' | 'add' | 'history'
const tabs = computed(() => {
  const value = batch.value
  if (!value) return []
  if (value.status === 'Finished') return [{ label: 'Results', value: 'history', icon: 'i-lucide-history' }]
  const items = [{ label: 'Tasks', value: 'tasks', icon: 'i-lucide-list-checks' }]
  if (value.canManage) items.push({ label: 'Add tasks', value: 'add', icon: 'i-lucide-list-plus' })
  if (value.status === 'Active') items.push({ label: 'Scope changes', value: 'history', icon: 'i-lucide-history' })
  return items
})
const tab = computed<Tab>({
  get: () => {
    const wanted = route.query.tab as Tab | undefined
    return tabs.value.some(t => t.value === wanted) ? wanted! : (tabs.value[0]?.value as Tab ?? 'tasks')
  },
  set: (value) => { void router.replace({ query: { ...route.query, tab: value, task: undefined } }) }
})

// ---- planning metadata (Planned only)
const editing = ref(false)
const editName = ref('')
const editStart = shallowRef<CalendarDate | null>(null)
const editEnd = shallowRef<CalendarDate | null>(null)
const editError = ref<string | null>(null)
function startEdit() {
  if (!batch.value) return
  editName.value = batch.value.batchName
  editStart.value = parseDate(batch.value.startDate)
  editEnd.value = parseDate(batch.value.endDate)
  editError.value = null
  editing.value = true
}
async function saveEdit() {
  const current = batch.value
  if (!current || !editStart.value || !editEnd.value) return
  if (inclusiveDays(editStart.value.toString(), editEnd.value.toString()) === null) {
    editError.value = 'The end date cannot be before the start date.'
    return
  }
  const changes: Record<string, string> = {}
  if (editName.value.trim() !== current.batchName) changes.batchName = editName.value.trim()
  if (editStart.value.toString() !== current.startDate) changes.startDate = editStart.value.toString()
  if (editEnd.value.toString() !== current.endDate) changes.endDate = editEnd.value.toString()
  if (!Object.keys(changes).length) return void (editing.value = false)
  try {
    await mutations.update.execute({ batch: current, changes })
    editing.value = false
  } catch (caught) {
    const apiError = caught as MasarApiError
    editError.value = apiError.kind === 'conflict' ? 'Someone else changed this Sprint. The latest values are shown.' : apiError.message
    if (apiError.kind === 'conflict') await refresh()
  }
}

// ---- lifecycle
const confirmStart = ref(false)
let startRequest = crypto.randomUUID()
watch(confirmStart, (value) => { if (value) startRequest = crypto.randomUUID() })
async function start() {
  if (!batch.value) return
  try {
    await mutations.start.execute({ batch: batch.value.name, requestId: startRequest })
    confirmStart.value = false
    toast.add({ title: 'Sprint started', description: batch.value?.batchName, color: 'success', icon: 'i-lucide-play' })
  } catch {
    confirmStart.value = false
    await refresh()
  }
}
const finishing = ref(false)
const transferring = ref(false)
const confirmDelete = ref(false)
async function remove() {
  if (!batch.value) return
  try {
    await mutations.remove.execute({ batch: batch.value.name })
    toast.add({ title: 'Sprint deleted', color: 'neutral', icon: 'i-lucide-trash-2' })
    await navigateTo('/sprints')
  } catch {
    confirmDelete.value = false
  }
}
async function claim() {
  const current = batch.value
  const me = user.value?.user
  if (!current || !me) return
  await mutations.transfer.execute({ batch: current, newOwner: me }).catch(() => refresh())
}

const menuItems = computed(() => {
  const value = batch.value
  if (!value?.canManage) return []
  const items = []
  if (value.status === 'Planned') items.push({ label: 'Edit name and dates', icon: 'i-lucide-pencil', onSelect: startEdit })
  items.push({ label: 'Transfer ownership', icon: 'i-lucide-user-round-cog', onSelect: () => { transferring.value = true } })
  if (value.status === 'Planned') items.push({ label: 'Delete Sprint', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { confirmDelete.value = true } })
  return items
})
</script>

<template>
  <UDashboardPanel :id="`batch-${name}`" :ui="{ body: 'p-0 sm:p-0 gap-0' }">
    <template #header>
      <UDashboardNavbar :title="batch?.batchName ?? 'Sprint'">
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton to="/sprints" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" aria-label="All Sprints" />
        </template>
        <template #right>
          <template v-if="batch">
            <BatchStatusBadge :status="batch.status" />
            <!-- Phones (QA-D04): these show their icon only, so the header controls do not overlap and the
                 Sprint title keeps room; the name stays as the accessible name. -->
            <UButton v-if="batch.canManage && batch.status === 'Planned'" icon="i-lucide-play" label="Start Sprint" aria-label="Start Sprint" :ui="{ label: 'max-sm:hidden' }" @click="confirmStart = true" />
            <UButton v-if="batch.canManage && batch.status === 'Active'" icon="i-lucide-flag" label="Finish Sprint" aria-label="Finish Sprint" :ui="{ label: 'max-sm:hidden' }" @click="finishing = true" />
            <UDropdownMenu v-if="menuItems.length" :items="menuItems" :content="{ align: 'end' }">
              <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" square aria-label="More Sprint actions" />
            </UDropdownMenu>
          </template>
          <NotificationBell placement="navbar" class="lg:hidden" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="status === 'pending' && !batch" class="space-y-3 p-4 sm:p-6">
        <USkeleton class="h-20" />
        <USkeleton v-for="i in 5" :key="i" class="h-11" />
      </div>
      <StatePanel
        v-else-if="error?.kind === 'not_found' || (!batch && status === 'success')"
        icon="i-lucide-calendar-x"
        title="Sprint not found"
        description="This Sprint does not exist or it holds no work you can access."
      >
        <UButton to="/sprints" label="Go to Sprints" />
      </StatePanel>
      <StatePanel v-else-if="error && !batch" tone="error" icon="i-lucide-cloud-off" title="This Sprint could not be loaded" :description="error.message">
        <UButton label="Try again" @click="refresh()" />
      </StatePanel>

      <div v-else-if="batch" class="flex h-full min-h-0 flex-col">
        <section class="space-y-3 border-b border-default px-4 py-4 sm:px-6" aria-label="Sprint summary">
          <form v-if="editing" class="flex flex-wrap items-end gap-2" @submit.prevent="saveEdit">
            <UFormField label="Name" class="min-w-56 flex-1">
              <UInput v-model="editName" maxlength="140" class="w-full" />
            </UFormField>
            <UFormField label="Start">
              <DatePicker v-model="editStart" aria-label="Start date" />
            </UFormField>
            <UFormField label="End">
              <DatePicker v-model="editEnd" aria-label="End date" />
            </UFormField>
            <UButton type="submit" label="Save" :loading="mutations.update.pending.value" />
            <UButton color="neutral" variant="ghost" label="Cancel" @click="editing = false" />
            <p v-if="editError" class="w-full text-sm text-error" role="alert">{{ editError }}</p>
          </form>
          <BatchSummary v-else :batch="batch" />
          <UAlert
            v-if="batch.ownerLacksAccess || batch.ownerLacksAuthority"
            color="warning"
            variant="subtle"
            icon="i-lucide-shield-alert"
            title="You no longer manage every Space in this Sprint"
            description="Planning, starting and finishing need Manager access to every Space whose tasks are in it. Ask a Manager of all those Spaces to take it over."
          />
          <UAlert
            v-if="batch.canClaim"
            color="info"
            variant="subtle"
            icon="i-lucide-user-round-cog"
            title="This Sprint's owner can no longer manage it"
            description="You manage every Space in it, so you can take it over."
            :actions="[{ label: 'Take over this Sprint', color: 'info', onClick: claim }]"
          />
        </section>

        <UTabs
          v-if="tabs.length > 1"
          v-model="tab"
          :items="tabs"
          :content="false"
          variant="link"
          size="sm"
          class="border-b border-default px-2 sm:px-4"
        />
        <div class="min-h-0 flex-1">
          <BatchTasksPanel v-if="tab === 'tasks'" :batch="batch" class="h-full" />
          <BatchPlanner v-else-if="tab === 'add'" :batch="batch" class="h-full" />
          <BatchHistoryTable v-else :batch="batch" />
        </div>
      </div>

      <template v-if="batch">
        <UModal v-model:open="confirmStart" :title="`Start ${batch.batchName}?`" description="The Sprint becomes Active. Task completion is not changed; tasks can still be added or removed, and those changes are recorded as scope changes.">
          <template #footer>
            <div class="flex w-full justify-end gap-2">
              <UButton color="neutral" variant="ghost" label="Cancel" @click="confirmStart = false" />
              <UButton icon="i-lucide-play" label="Start Sprint" :loading="mutations.start.pending.value" @click="start" />
            </div>
          </template>
        </UModal>
        <FinishBatchModal v-if="batch.status === 'Active'" v-model:open="finishing" :batch="batch" />
        <TransferBatchModal v-model:open="transferring" :batch="batch" />
        <UModal v-model:open="confirmDelete" :title="`Delete ${batch.batchName}?`" description="Only an empty, planned Sprint can be deleted. This cannot be undone.">
          <template #footer>
            <div class="flex w-full justify-end gap-2">
              <UButton color="neutral" variant="ghost" label="Cancel" @click="confirmDelete = false" />
              <UButton color="error" label="Delete Sprint" :loading="mutations.remove.pending.value" @click="remove" />
            </div>
          </template>
        </UModal>
      </template>
    </template>
  </UDashboardPanel>
</template>
