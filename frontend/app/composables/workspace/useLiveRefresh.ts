import { isUserBusy, REALTIME_EVENTS, refreshPrefixes } from '~/utils/realtimeEvents'

const DEBOUNCE_MS = 300
const BUSY_RETRY_MS = 1000
// After a reconnect, events sent while offline are lost: refresh everything shown.
const EVERYTHING = ['tasks:', 'task:', 'attachments:', 'batch', 'feature', 'release', 'space']

// One queue for the tab: bursts (bulk edits) merge into one refresh.
const pending = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined

function schedule(delay: number) {
  clearTimeout(timer)
  timer = setTimeout(flush, delay)
}

function flush() {
  if (!pending.size) return
  // Never replace what the person is typing or dragging: try again shortly.
  if (isUserBusy(document)) return schedule(BUSY_RETRY_MS)
  const prefixes = [...pending]
  pending.clear()
  void invalidateQueries(...prefixes)
}

/** Mark cached queries stale after a live event; on-screen ones refetch once the person is not busy. */
export function queueRefresh(prefixes: string[]) {
  prefixes.forEach(prefix => pending.add(prefix))
  schedule(DEBOUNCE_MS)
}

/**
 * Live task lists, boards, Batches and Spaces (specs/realtime.md, F1). Events from other people's changes
 * mark the matching queries stale; queries on screen refetch through the API. Call once (default layout).
 */
export function useLiveRefresh() {
  const { on, connected } = useRealtime()

  on(REALTIME_EVENTS.spaceChanged, payload => queueRefresh(refreshPrefixes(REALTIME_EVENTS.spaceChanged, payload)))
  on(REALTIME_EVENTS.batchChanged, payload => queueRefresh(refreshPrefixes(REALTIME_EVENTS.batchChanged, payload)))

  let wasConnected = false
  watch(connected, (now) => {
    if (now && wasConnected) queueRefresh(EVERYTHING)
    if (now) wasConnected = true
  })

  onScopeDispose(() => clearTimeout(timer))
}
