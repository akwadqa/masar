import type { MaybeRefOrGetter } from 'vue'
import { MasarApiError, toApiError } from '~/utils/apiError'

const STALE_AFTER_MS = 30_000

interface QueryOptions<T> {
  /** Value shown before the first response. */
  default?: () => T
  /** Refetch when the window regains focus and data is older than STALE_AFTER_MS. */
  refetchOnFocus?: boolean
}

/**
 * Keyed, deduplicated query on top of useAsyncData (ADR-009).
 * - Same key ⇒ shared state and a single in-flight request (dedupe: 'defer').
 * - Fresh cached data (< 30 s) renders instantly on navigation without a request.
 */
export function useMasarQuery<T>(
  key: MaybeRefOrGetter<string>,
  fetcher: (signal: AbortSignal | undefined) => Promise<T>,
  options: QueryOptions<T> = {}
) {
  const fetchedAt = useState<Record<string, number>>('masar:query-fetched-at', () => ({}))

  const result = useAsyncData<T>(
    key,
    (_nuxtApp, context) => fetcher(context?.signal).then((value) => {
      fetchedAt.value[toValue(key)] = Date.now()
      return value
    }),
    {
      dedupe: 'defer',
      default: options.default as (() => T) | undefined,
      getCachedData(cacheKey, nuxtApp, context) {
        if (context.cause !== 'initial') return undefined
        const age = Date.now() - (fetchedAt.value[cacheKey] ?? 0)
        return age < STALE_AFTER_MS ? (nuxtApp.payload.data[cacheKey] as T | undefined) : undefined
      }
    }
  )

  if (options.refetchOnFocus !== false && import.meta.client) {
    const onFocus = () => {
      const age = Date.now() - (fetchedAt.value[toValue(key)] ?? 0)
      if (age >= STALE_AFTER_MS && result.status.value !== 'pending') void result.refresh()
    }
    onMounted(() => window.addEventListener('focus', onFocus))
    onBeforeUnmount(() => window.removeEventListener('focus', onFocus))
  }

  // useAsyncData wraps thrown errors in NuxtError; expose the normalised Masar error instead.
  const error = computed<MasarApiError | null>(() => {
    const value = result.error.value as (Error & { cause?: unknown }) | null | undefined
    if (!value) return null
    if (value instanceof MasarApiError) return value
    if (value.cause instanceof MasarApiError) return value.cause
    return toApiError(500, null)
  })

  return { data: result.data, status: result.status, refresh: result.refresh, error }
}

interface AsyncDataEntry { data: { value: unknown } }
type NuxtAppWithAsyncData = ReturnType<typeof useNuxtApp> & { _asyncData: Record<string, AsyncDataEntry | undefined> }

export function cacheKeys(prefix: string): string[] {
  const nuxtApp = useNuxtApp() as NuxtAppWithAsyncData
  const keys = new Set([...Object.keys(nuxtApp._asyncData ?? {}), ...Object.keys(nuxtApp.payload.data)])
  return [...keys].filter(key => key.startsWith(prefix))
}

/** Read cached query data: the live useAsyncData ref when mounted, else the payload cache. */
export function readCache<T>(key: string): T | undefined {
  const nuxtApp = useNuxtApp() as NuxtAppWithAsyncData
  return (nuxtApp._asyncData?.[key]?.data.value ?? nuxtApp.payload.data[key]) as T | undefined
}

/** Write cached query data so every component using the key re-renders. */
export function writeCache<T>(key: string, value: T) {
  const nuxtApp = useNuxtApp() as NuxtAppWithAsyncData
  const entry = nuxtApp._asyncData?.[key]
  if (entry) entry.data.value = value
  nuxtApp.payload.data[key] = value
}

/** Refresh every active query whose key starts with one of the prefixes, and mark all matching cached
 *  data stale so a query mounted later (e.g. on another tab) refetches instead of reusing it. */
export async function invalidateQueries(...prefixes: string[]) {
  const keys = [...new Set(prefixes.flatMap(prefix => cacheKeys(prefix)))]
  const fetchedAt = useState<Record<string, number>>('masar:query-fetched-at', () => ({}))
  for (const key of keys) delete fetchedAt.value[key]
  if (keys.length) await refreshNuxtData(keys)
}

/** Apply a synchronous update to the cached data of every key matching a prefix. Returns a rollback. */
export function updateCachedQueries<T>(prefix: string, update: (value: T) => T): () => void {
  const snapshots = new Map<string, T>()
  for (const key of cacheKeys(prefix)) {
    const current = readCache<T>(key)
    if (current === undefined || current === null) continue
    snapshots.set(key, current)
    writeCache(key, update(current))
  }
  return () => {
    for (const [key, value] of snapshots) writeCache(key, value)
  }
}
