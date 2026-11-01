<script setup lang="ts">
import type { Feature, RoadmapColumn, SpaceDetail } from '~/types/api'

const props = defineProps<{ space: SpaceDetail }>()
const route = useRoute()
const router = useRouter()
const { data: features, status, error, refresh } = useFeatures(() => props.space.name)
const activeFeature = computed(() => (typeof route.query.feature === 'string' ? route.query.feature : null))
const canManage = computed(() => !!features.value?.permissions.canManage)

function setFeature(name: string | null) {
  const query = { ...route.query }
  if (name) query.feature = name
  else delete query.feature
  void router.replace({ query })
}

// Search narrows the board to matching titles; reordering is paused while it is active.
const search = ref('')
const visible = computed(() => {
  const term = search.value.trim().toLowerCase()
  const items = features.value?.items ?? []
  return term ? items.filter(f => f.title.toLowerCase().includes(term)) : items
})

const creating = ref(false)
const createIn = ref<RoadmapColumn>('Later')
function create(roadmap: RoadmapColumn = 'Later') {
  createIn.value = roadmap
  creating.value = true
}
</script>

<template>
  <!-- The board grows with its cards and the Space page scrolls; cards never shrink (client revision 6, R1). -->
  <div class="flex flex-1 flex-col">
    <div class="flex items-center gap-2 border-b border-default px-3 py-2 sm:px-4">
      <UInput v-model="search" icon="i-lucide-search" placeholder="Search Features" size="sm" class="w-full sm:w-56" aria-label="Search Features" />
      <p class="hidden text-sm text-muted sm:block" aria-live="polite">
        {{ search.trim() ? `${visible.length} of ${features?.items.length ?? 0}` : (features?.items.length ?? 0) }} Feature{{ (features?.items.length ?? 0) === 1 ? '' : 's' }}
      </p>
      <UButton v-if="canManage" class="ms-auto" size="sm" icon="i-lucide-plus" label="New Feature" @click="create()" />
    </div>
    <div v-if="status === 'pending' && !features?.items.length" class="flex gap-3 p-4">
      <USkeleton v-for="i in 4" :key="i" class="h-64 flex-1" />
    </div>
    <StatePanel v-else-if="error && !features?.items.length" tone="error" icon="i-lucide-cloud-off" title="The roadmap could not be loaded" :description="error.message">
      <UButton label="Try again" @click="refresh()" />
    </StatePanel>
    <StatePanel
      v-else-if="!features?.items.length"
      icon="i-lucide-map"
      title="No Features yet"
      :description="canManage ? 'Features group the tasks that deliver one capability. Plan them as Now, Next, Later and Done.' : 'Space Managers plan Features on this roadmap.'"
    >
      <UButton v-if="canManage" icon="i-lucide-plus" label="New Feature" @click="create()" />
    </StatePanel>
    <RoadmapBoard
      v-else
      class="flex-1"
      :space="space.name"
      :features="visible"
      :can-manage="canManage"
      :reorder-paused="!!search.trim()"
      :active-feature="activeFeature"
      @open="(feature: Feature) => setFeature(feature.name)"
      @create="create"
    />
    <FeatureFormModal v-model:open="creating" :space="space.name" :roadmap="createIn" />
    <FeaturePanel :feature-name="activeFeature" @close="setFeature(null)" />
  </div>
</template>
