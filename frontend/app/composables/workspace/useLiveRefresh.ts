import { isUserBusy, REALTIME_EVENTS, refreshPrefixes } from '~/utils/realtimeEvents'

const DEBOUNCE_MS = 300
const BUSY_RETRY_MS = 1000
// After a reconnect, events sent while offline are lost: refresh everything shown.
const EVERYTHING = ['tasks:', 'batch', 'feature', 'release', 'space']

/**
 * Live task lists, boards, Batches and Spaces (specs/realtime.md, F1). Events from other people's changes
 * mark the matching queries stale; queries on screen refetch through the API. Bursts (bulk edits) are
 * merged, and a refresh waits while the person is typing or dragging a card. Call once (default layout).
 */
export function useLiveRefresh() {
  const { on, connected } = useRealtime()
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  function schedule(delay: number) {
    clearTimeout(timer)
    timer = setTimeout(flush, delay)
  }

  function queue(prefixes: string[]) {
    prefixes.forEach(prefix => pending.add(prefix))
    schedule(DEBOUNCE_MS)
  }

  function flush() {
    if (!pending.size) return
    if (isUserBusy(document)) return schedule(BUSY_RETRY_MS)
    const prefixes = [...pending]
    pending.clear()
    void invalidateQueries(...prefixes)
  }

  on(REALTIME_EVENTS.spaceChanged, payload => queue(refreshPrefixes(REALTIME_EVENTS.spaceChanged, payload)))
  on(REALTIME_EVENTS.batchChanged, payload => queue(refreshPrefixes(REALTIME_EVENTS.batchChanged, payload)))

  let wasConnected = false
  watch(connected, (now) => {
    if (now && wasConnected) queue(EVERYTHING)
    if (now) wasConnected = true
  })

  onScopeDispose(() => clearTimeout(timer))
}
