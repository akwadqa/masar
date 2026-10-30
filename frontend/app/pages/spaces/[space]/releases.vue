<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Release, ReleaseStatus, SpaceDetail } from '~/types/api'
import { RELEASE_STATUSES } from '~/types/api'
import { formatDateTime, formatLongDate } from '~/utils/format'

const props = defineProps<{ space: SpaceDetail }>()
const route = useRoute()
const router = useRouter()

const str = (key: string) => (typeof route.query[key] === 'string' ? route.query[key] as string : null)
const filters = computed(() => ({
  status: RELEASE_STATUSES.find(s => s === str('status')) ?? null,
  q: str('q')
}))
const { data: releases, status, error, refresh } = useReleases(() => props.space.name, filters)
const activeRelease = computed(() => str('release'))
const canManage = computed(() => !!releases.value?.permissions.canManage)

function setQuery(patch: Record<string, string | null>) {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) {
    if (typeof value === 'string' && value !== '') query[key] = value
  }
  void router.replace({ query })
}

const search = ref(filters.value.q ?? '')
let timer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => setQuery({ q: value.trim() || null }), 250)
})
onBeforeUnmount(() => clearTimeout(timer))

const statusItems = [{ label: 'All statuses', value: 'any' }, ...RELEASE_STATUSES.map(s => ({ label: s, value: s }))]
const columns: TableColumn<Release>[] = [
  { accessorKey: 'releaseName', header: 'Release' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'releaseDate', header: 'Planned date' },
  { id: 'progress', header: 'Progress' },
  { accessorKey: 'releasedAt', header: 'Released' }
]
const creating = ref(false)
const filtered = computed(() => !!(filters.value.status || filters.value.q))
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex flex-wrap items-center gap-2 border-b border-default px-3 py-2 sm:px-4">
      <UInput v-model="search" icon="i-lucide-search" placeholder="Search releases" size="sm" class="w-full sm:w-56" aria-label="Search releases" />
      <USelect
        :model-value="filters.status ?? 'any'"
        :items="statusItems"
        size="sm"
        class="w-40"
        aria-label="Filter by status"
        @update:model-value="(v) => setQuery({ status: v === 'any' ? null : String(v) })"
      />
      <UButton v-if="filtered" size="sm" variant="link" color="neutral" label="Clear filters" @click="search = ''; setQuery({ status: null, q: null })" />
      <UButton v-if="canManage" class="ms-auto" size="sm" icon="i-lucide-plus" label="New Release" @click="creating = true" />
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <StatePanel v-if="error && !releases?.items.length" tone="error" icon="i-lucide-cloud-off" title="Releases could not be loaded" :description="error.message">
        <UButton label="Try again" @click="refresh()" />
      </StatePanel>
      <StatePanel
        v-else-if="status !== 'pending' && !releases?.items.length"
        icon="i-lucide-package"
        :title="filtered ? 'No releases match these filters' : 'No releases yet'"
        :description="filtered ? undefined : (canManage ? 'Plan a release and add tasks to it from the Task List.' : 'Space Managers plan releases here.')"
      >
        <UButton v-if="canManage && !filtered" icon="i-lucide-plus" label="New Release" @click="creating = true" />
      </StatePanel>
      <UTable
        v-else
        :data="releases?.items ?? []"
        :columns="columns"
        :loading="status === 'pending'"
        sticky
        class="min-w-[40rem]"
        :ui="{ td: 'py-2', th: 'py-2' }"
      >
        <template #releaseName-cell="{ row }">
          <UButton
            variant="link"
            color="neutral"
            class="px-0 font-medium text-highlighted"
            :label="row.original.releaseName"
            :aria-current="activeRelease === row.original.name ? 'true' : undefined"
            @click="setQuery({ release: row.original.name })"
          />
        </template>
        <template #status-cell="{ row }">
          <ReleaseStatusBadge :status="row.original.status as ReleaseStatus" size="sm" />
        </template>
        <template #releaseDate-cell="{ row }">
          <span class="tabular-nums text-muted">{{ row.original.releaseDate ? formatLongDate(row.original.releaseDate) : '—' }}</span>
        </template>
        <template #progress-cell="{ row }">
          <PlanningProgress :progress="row.original.progress" compact class="w-36" />
        </template>
        <template #releasedAt-cell="{ row }">
          <span class="text-muted">{{ row.original.releasedAt ? formatDateTime(row.original.releasedAt) : '—' }}</span>
        </template>
      </UTable>
    </div>
    <ReleaseFormModal v-model:open="creating" :space="space.name" />
    <ReleasePanel :release-name="activeRelease" @close="setQuery({ release: null })" />
  </div>
</template>
