import type { Batch, Feature, Release, TaskListFilters } from '~/types/api'
import { formatLongDate } from '~/utils/format'

export type FilterPanelKind = 'feature' | 'release' | 'batch'

export interface FilterPanelItem {
  value: string
  label: string
  meta?: string
  count?: number
  /** Share of finished Tasks (Features and Versions) */
  percent?: number | null
  icon?: string
}

/** Which filter side panels are open and the F / V shortcuts that toggle them. Each panel opens and
 *  closes on its own, so Features and Versions can be open together (client request 2026-10-30); open
 *  panels keep the order of `available`. Opening or closing a panel never changes the filters.
 *  Shortcuts are ignored while typing (defineShortcuts). */
export function useFilterPanel(available: MaybeRefOrGetter<FilterPanelKind[]>) {
  const openPanels = ref<FilterPanelKind[]>([])
  function togglePanel(kind: FilterPanelKind) {
    if (!toValue(available).includes(kind)) return
    const open = openPanels.value.includes(kind)
    openPanels.value = toValue(available).filter(item => item === kind ? !open : openPanels.value.includes(item))
  }
  function closePanel(kind: FilterPanelKind) {
    openPanels.value = openPanels.value.filter(item => item !== kind)
  }
  defineShortcuts({
    f: () => togglePanel('feature'),
    v: () => togglePanel('release')
  })
  return { openPanels, togglePanel, closePanel }
}

interface PanelSources {
  features: () => Feature[] | undefined
  releases: () => Release[] | undefined
  batches: () => Batch[] | undefined
}

/** Panel state plus the items of each panel and the display names of the active panel filters. */
export function useTaskFilterPanels(available: MaybeRefOrGetter<FilterPanelKind[]>, sources: PanelSources, filters: Ref<TaskListFilters>) {
  const { openPanels, togglePanel, closePanel } = useFilterPanel(available)
  watch(() => toValue(available), (kinds) => { openPanels.value = openPanels.value.filter(kind => kinds.includes(kind)) })
  const panelItems = computed<Record<FilterPanelKind, FilterPanelItem[]>>(() => ({
    feature: featurePanelItems(sources.features() ?? []),
    release: releasePanelItems(sources.releases() ?? []),
    batch: batchPanelItems(sources.batches() ?? [])
  }))
  const activeNames = computed(() => {
    const names: Partial<Record<FilterPanelKind, string>> = {}
    for (const kind of toValue(available)) {
      const value = filters.value[kind]
      const item = value ? panelItems.value[kind].find(entry => entry.value === value) : undefined
      if (item) names[kind] = item.label
    }
    return names
  })
  return { openPanels, togglePanel, closePanel, panelItems, activeNames }
}

export function featurePanelItems(features: Feature[]): FilterPanelItem[] {
  return [
    { value: 'none', label: 'Tasks without a Feature', icon: 'i-lucide-circle-dashed' },
    ...features.map(feature => ({
      value: feature.name,
      label: feature.title,
      meta: [feature.spaceTitle, feature.roadmap].filter(Boolean).join(' · '),
      count: feature.progress.total,
      percent: feature.progress.percent ?? 0
    }))
  ]
}

export function releasePanelItems(releases: Release[]): FilterPanelItem[] {
  return [
    { value: 'none', label: 'Tasks without a Version', icon: 'i-lucide-circle-dashed' },
    ...releases.map(release => ({
      value: release.name,
      label: release.releaseName,
      meta: [release.spaceTitle, release.status, release.releaseDate ? formatLongDate(release.releaseDate) : null].filter(Boolean).join(' · '),
      count: release.progress.total,
      percent: release.progress.percent ?? 0
    }))
  ]
}

export function batchPanelItems(batches: Batch[]): FilterPanelItem[] {
  return [
    { value: 'any', label: 'In a current Sprint', icon: 'i-lucide-calendar-check' },
    ...batches.filter(batch => batch.status !== 'Finished').map(batch => ({
      value: batch.name,
      label: batch.batchName,
      meta: `${batch.status} · ${formatLongDate(batch.startDate)}`
    })),
    { value: 'none', label: 'Not in a Sprint', icon: 'i-lucide-circle-dashed' }
  ]
}
