import type {
  BatchDetail,
  BatchHistoryRow,
  BatchList,
  BatchPreset,
  BatchStatus,
  FinishPreview,
  FinishResult,
  TaskListFilters,
  TaskListRow
} from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'

// Every Batch read is scoped by the server to the viewer's Spaces (ADR-045, ADR-048).
const EMPTY: BatchList = { items: [], permissions: { canCreate: false } }
const AFTER_MEMBERSHIP_CHANGE = ['batches:', 'batch:', 'batch-tasks:', 'batch-history:', 'tasks:', 'task:']

export interface BatchListFilters {
  status?: BatchStatus | null
  q?: string | null
  /** Only Batches holding this Space's Tasks, with progress counted for this Space */
  space?: string | null
  /** Planning targets: Planned/Active Batches the caller manages */
  manageable?: boolean
}

export function useBatchList(filters: MaybeRefOrGetter<BatchListFilters> = {}) {
  const api = useMasarApi()
  return useMasarQuery<BatchList>(
    () => `batches:${JSON.stringify(toValue(filters))}`,
    (signal) => {
      const f = toValue(filters)
      return api.get<BatchList>('masar.api.batches.list', {
        status: f.status || undefined, q: f.q || undefined, space: f.space || undefined, manageable: f.manageable || undefined
      }, signal)
    },
    { default: () => EMPTY }
  )
}

/** Batches the caller can plan into (Task detail, bulk bar, finishing destinations). */
export function useManageableBatches() {
  return useBatchList({ manageable: true })
}

export function useBatch(name: MaybeRefOrGetter<string>) {
  const api = useMasarApi()
  return useMasarQuery<BatchDetail | null>(
    () => `batch:${toValue(name)}`,
    signal => api.get('masar.api.batches.get', { batch: toValue(name) }, signal),
    { default: () => null }
  )
}

export function useBatchTasks(name: MaybeRefOrGetter<string>, filters: MaybeRefOrGetter<Partial<TaskListFilters>> = {}) {
  const api = useMasarApi()
  return useMasarQuery<TaskListRow[]>(
    () => `batch-tasks:${toValue(name)}:${JSON.stringify(toValue(filters))}`,
    signal => fetchAllPages(cursor => api.get('masar.api.batches.tasks', {
      ...toQuery({ completed: 'all', assignedToMe: false, ownedByMe: false, sort: 'manual', ...toValue(filters) }),
      batch: toValue(name),
      cursor: cursor ?? undefined,
      limit: 500
    }, signal)),
    { default: () => [] }
  )
}

export function useBatchHistory(name: MaybeRefOrGetter<string>) {
  const api = useMasarApi()
  return useMasarQuery<BatchHistoryRow[]>(
    () => `batch-history:${toValue(name)}`,
    signal => api.get('masar.api.batches.history', { batch: toValue(name) }, signal),
    { default: () => [] }
  )
}

export function fetchFinishPreview(batch: string) {
  return useMasarApi().get<FinishPreview>('masar.api.batches.finish_preview', { batch })
}

/** Open, unbatched tasks of one Space for the planning picker (server-side filters). */
export function searchPlanningCandidates(space: string, filters: Partial<TaskListFilters>) {
  const api = useMasarApi()
  return fetchAllPages(cursor => api.get('masar.api.tasks.list', {
    space,
    ...toQuery({ completed: 'open', assignedToMe: false, ownedByMe: false, sort: 'manual', ...filters }),
    cursor: cursor ?? undefined,
    limit: 500
  }))
}

function applyBatch(batch: BatchDetail) {
  writeCache(`batch:${batch.name}`, batch)
  void invalidateQueries('batches:')
}

const conflictsAreHandledInline = { toastOnError: (e: MasarApiError) => e.kind !== 'conflict' }

export function useBatchMutations() {
  const api = useMasarApi()

  const create = useMasarMutation(
    (vars: { batchName: string, startDate: string, preset?: BatchPreset, endDate?: string, clientRequestId: string }) =>
      api.post<{ batch: BatchDetail, created: boolean }>('masar.api.batches.create', {
        batch_name: vars.batchName,
        start_date: vars.startDate,
        preset: vars.preset,
        end_date: vars.preset ? undefined : vars.endDate,
        client_request_id: vars.clientRequestId
      }),
    { onSuccess: result => applyBatch(result.batch), toastOnError: false }
  )

  const update = useMasarMutation(
    (vars: { batch: BatchDetail, changes: Partial<Pick<BatchDetail, 'batchName' | 'startDate' | 'endDate'>> }) => {
      const base: Record<string, unknown> = {}
      for (const key of Object.keys(vars.changes)) base[key] = (vars.batch as unknown as Record<string, unknown>)[key]
      return api.post<BatchDetail>('masar.api.batches.update', { batch: vars.batch.name, changes: vars.changes, base })
    },
    { onSuccess: batch => applyBatch(batch), ...conflictsAreHandledInline }
  )

  const remove = useMasarMutation(
    (vars: { batch: string }) => api.post('masar.api.batches.delete', vars),
    { invalidate: () => ['batches:'] }
  )

  const transfer = useMasarMutation(
    (vars: { batch: BatchDetail, newOwner: string }) =>
      api.post<BatchDetail>('masar.api.batches.transfer_ownership', {
        batch: vars.batch.name, new_owner: vars.newOwner, expected_owner: vars.batch.owner.name
      }),
    { onSuccess: batch => applyBatch(batch), ...conflictsAreHandledInline }
  )

  /** Move tasks (from any number of Spaces) into a Batch, or out of their Batch with `batch: null`. */
  const moveTasks = useMasarMutation(
    (vars: { tasks: TaskListRow[], batch: string | null }) =>
      api.post<{ changed: string[], unchanged: string[] }>('masar.api.batches.move_tasks', {
        tasks: vars.tasks.map(t => t.name),
        batch: vars.batch ?? undefined,
        expected: Object.fromEntries(vars.tasks.map(t => [t.name, t.batch?.name ?? null]))
      }),
    { invalidate: () => AFTER_MEMBERSHIP_CHANGE, ...conflictsAreHandledInline }
  )

  const start = useMasarMutation(
    (vars: { batch: string, requestId: string }) =>
      api.post<BatchDetail>('masar.api.batches.start', { batch: vars.batch, request_id: vars.requestId }),
    { onSuccess: batch => applyBatch(batch), invalidate: () => AFTER_MEMBERSHIP_CHANGE, ...conflictsAreHandledInline }
  )

  const finish = useMasarMutation(
    (vars: { batch: string, carry: 'Unbatched' | 'Batch', destination?: string, requestId: string }) =>
      api.post<FinishResult>('masar.api.batches.finish', {
        batch: vars.batch, carry: vars.carry, destination: vars.destination, request_id: vars.requestId
      }),
    { onSuccess: result => applyBatch(result.batch), invalidate: () => AFTER_MEMBERSHIP_CHANGE, ...conflictsAreHandledInline }
  )

  return { create, update, remove, transfer, moveTasks, start, finish }
}
