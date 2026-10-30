import type {
  Feature,
  FeatureDetail,
  PlanningList,
  Release,
  ReleaseDetail,
  ReleaseStatus,
  RoadmapColumn
} from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'
import { moveNeighbours, placeFeature } from '~/utils/roadmap'

const EMPTY_LIST = <T>(): PlanningList<T> => ({ items: [], permissions: { canManage: false, canLinkTasks: false } })

// ----------------------------------------------------------------------------- Features (roadmap)

/** Features of a Space in roadmap order. No Space (e.g. a cross-Space selection): nothing to load. */
export function useFeatures(space: MaybeRefOrGetter<string | null | undefined>) {
  const api = useMasarApi()
  return useMasarQuery<PlanningList<Feature>>(
    () => `features:${toValue(space) ?? 'none'}`,
    async (signal) => {
      const value = toValue(space)
      return value ? api.get<PlanningList<Feature>>('masar.api.features.list', { space: value }, signal) : EMPTY_LIST<Feature>()
    },
    { default: EMPTY_LIST<Feature> }
  )
}

export function useFeature(name: MaybeRefOrGetter<string>) {
  const api = useMasarApi()
  return useMasarQuery<FeatureDetail | null>(
    () => `feature:${toValue(name)}`,
    signal => api.get('masar.api.features.get', { feature: toValue(name) }, signal),
    { default: () => null }
  )
}

/** Store the server's Feature in its detail cache and in the Space roadmap. */
function applyFeature(feature: FeatureDetail) {
  writeCache(`feature:${feature.name}`, feature)
  updateCachedQueries<PlanningList<Feature>>(`features:${feature.space}`, list => ({
    ...list,
    items: list.items.map(item => (item.name === feature.name ? { ...item, ...feature } : item))
  }))
}

/** Optimistically place a Feature in a column, in the order the user dropped it. */
function optimisticPlacement(space: string, feature: string, roadmap: RoadmapColumn, columnOrder: string[]) {
  return updateCachedQueries<PlanningList<Feature>>(`features:${space}`, list => ({
    ...list,
    items: placeFeature(list.items, feature, roadmap, columnOrder)
  }))
}

const conflictsAreHandledInline = { toastOnError: (e: MasarApiError) => e.kind !== 'conflict' }

export function useFeatureMutations() {
  const api = useMasarApi()

  const create = useMasarMutation(
    (vars: { space: string, title: string, roadmap: RoadmapColumn, description?: string | null, client_request_id?: string }) =>
      api.post<FeatureDetail & { created: boolean }>('masar.api.features.create', vars),
    { invalidate: (_r, vars) => [`features:${vars.space}`], toastOnError: false }
  )

  const update = useMasarMutation(
    (vars: { feature: FeatureDetail, changes: Partial<Pick<FeatureDetail, 'title' | 'description'>> }) => {
      const base: Record<string, unknown> = {}
      for (const key of Object.keys(vars.changes)) base[key] = (vars.feature as unknown as Record<string, unknown>)[key]
      return api.post<FeatureDetail>('masar.api.features.update', { feature: vars.feature.name, changes: vars.changes, base })
    },
    { onSuccess: feature => applyFeature(feature), ...conflictsAreHandledInline }
  )

  /**
   * Move to a column/position. `columnOrder` is the target column's order after the drop (names),
   * used for the optimistic view and to derive the neighbours sent to the server (ADR-038).
   */
  const move = useMasarMutation(
    (vars: { feature: Feature, roadmap: RoadmapColumn, columnOrder: string[] }) => {
      return api.post<FeatureDetail>('masar.api.features.move', {
        feature: vars.feature.name,
        roadmap: vars.roadmap,
        ...moveNeighbours(vars.columnOrder, vars.feature.name),
        expected_roadmap: vars.feature.roadmap
      })
    },
    {
      optimistic: vars => optimisticPlacement(vars.feature.space, vars.feature.name, vars.roadmap, vars.columnOrder),
      onSuccess: feature => applyFeature(feature),
      invalidate: (_r, vars) => [`features:${vars.feature.space}`, 'tasks:'],
      ...conflictsAreHandledInline
    }
  )

  const remove = useMasarMutation(
    (vars: { feature: Feature, detach: boolean }) =>
      api.post<{ tasksDetached: number }>('masar.api.features.delete', { feature: vars.feature.name, detach: vars.detach }),
    {
      invalidate: (_r, vars) => [`features:${vars.feature.space}`, 'tasks:', 'task:'],
      ...conflictsAreHandledInline
    }
  )

  return { create, update, move, remove }
}

// ----------------------------------------------------------------------------- Releases

export interface ReleaseFilters {
  status?: ReleaseStatus | null
  q?: string | null
}

export function useReleases(space: MaybeRefOrGetter<string | null | undefined>, filters: MaybeRefOrGetter<ReleaseFilters> = {}) {
  const api = useMasarApi()
  return useMasarQuery<PlanningList<Release>>(
    () => `releases:${toValue(space) ?? 'none'}:${toValue(filters).status ?? ''}:${toValue(filters).q ?? ''}`,
    async (signal) => {
      const value = toValue(space)
      const f = toValue(filters)
      return value
        ? api.get<PlanningList<Release>>('masar.api.releases.list', { space: value, status: f.status || undefined, q: f.q || undefined }, signal)
        : EMPTY_LIST<Release>()
    },
    { default: EMPTY_LIST<Release> }
  )
}

export function useRelease(name: MaybeRefOrGetter<string>) {
  const api = useMasarApi()
  return useMasarQuery<ReleaseDetail | null>(
    () => `release:${toValue(name)}`,
    signal => api.get('masar.api.releases.get', { release: toValue(name) }, signal),
    { default: () => null }
  )
}

function applyRelease(release: ReleaseDetail) {
  writeCache(`release:${release.name}`, release)
  void invalidateQueries(`releases:${release.space}:`, 'tasks:')
}

export function useReleaseMutations() {
  const api = useMasarApi()

  const create = useMasarMutation(
    (vars: { space: string, releaseName: string, releaseDate?: string | null, notes?: string | null }) =>
      api.post<ReleaseDetail>('masar.api.releases.create', {
        space: vars.space, release_name: vars.releaseName, release_date: vars.releaseDate || undefined, notes: vars.notes || undefined
      }),
    { onSuccess: release => applyRelease(release), toastOnError: false }
  )

  const update = useMasarMutation(
    (vars: { release: ReleaseDetail, changes: Partial<Pick<ReleaseDetail, 'releaseName' | 'releaseDate' | 'notes'>> }) => {
      const base: Record<string, unknown> = {}
      for (const key of Object.keys(vars.changes)) base[key] = (vars.release as unknown as Record<string, unknown>)[key]
      return api.post<ReleaseDetail>('masar.api.releases.update', { release: vars.release.name, changes: vars.changes, base })
    },
    { onSuccess: release => applyRelease(release), ...conflictsAreHandledInline }
  )

  const setStatus = useMasarMutation(
    (vars: { release: Release, status: ReleaseStatus }) =>
      api.post<ReleaseDetail>('masar.api.releases.set_status', {
        release: vars.release.name, status: vars.status, expected_status: vars.release.status
      }),
    { onSuccess: release => applyRelease(release), ...conflictsAreHandledInline }
  )

  const remove = useMasarMutation(
    (vars: { release: Release, detach: boolean }) =>
      api.post<{ tasksDetached: number }>('masar.api.releases.delete', { release: vars.release.name, detach: vars.detach }),
    {
      invalidate: (_r, vars) => [`releases:${vars.release.space}:`, 'tasks:', 'task:'],
      ...conflictsAreHandledInline
    }
  )

  return { create, update, setStatus, remove }
}

// ----------------------------------------------------------------------------- across Spaces (All Tasks)

/** Features and Releases of every Space the user belongs to, or of the chosen Spaces. */
export function useMyFeatures(spaces: MaybeRefOrGetter<string[] | null | undefined>) {
  const api = useMasarApi()
  return useMasarQuery<{ items: Feature[] }>(
    () => `features:mine:${(toValue(spaces) ?? []).join(',')}`,
    signal => api.get('masar.api.features.list_mine', { spaces: toValue(spaces)?.length ? JSON.stringify(toValue(spaces)) : undefined }, signal),
    { default: () => ({ items: [] }) }
  )
}

export function useMyReleases(spaces: MaybeRefOrGetter<string[] | null | undefined>) {
  const api = useMasarApi()
  return useMasarQuery<{ items: Release[] }>(
    () => `releases:mine:${(toValue(spaces) ?? []).join(',')}`,
    signal => api.get('masar.api.releases.list_mine', { spaces: toValue(spaces)?.length ? JSON.stringify(toValue(spaces)) : undefined }, signal),
    { default: () => ({ items: [] }) }
  )
}
