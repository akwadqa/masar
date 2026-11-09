import type { RealtimeEvents } from '~/types/api'

/** Realtime event names (specs/realtime.md); the server publishes them from realtime_service.py. */
export const REALTIME_EVENTS = {
  spaceChanged: 'masar_space_changed',
  batchChanged: 'masar_batch_changed',
  notification: 'masar_notification'
} as const satisfies Record<string, keyof RealtimeEvents>

/**
 * Cached query prefixes a live event makes stale (keys: useTasks, useBatches, useSpaces, usePlanning).
 * A Space change touches everything shown about that Space, including Batch boards with its Tasks and
 * Features and Versions; Task details are not refreshed here, so an open editor is never replaced.
 */
export function refreshPrefixes<E extends keyof RealtimeEvents>(event: E, payload: RealtimeEvents[E]): string[] {
  if (event === REALTIME_EVENTS.spaceChanged) {
    const { space } = payload as RealtimeEvents['masar_space_changed']
    return [
      'tasks:', 'batches:', 'batch:', 'batch-tasks:', 'batch-history:',
      'features:', 'feature:', 'releases:', 'release:',
      'spaces:list', `space:${space}`, `space-members:${space}`, `space-files:${space}`
    ]
  }
  if (event === REALTIME_EVENTS.batchChanged) {
    const { batch } = payload as RealtimeEvents['masar_batch_changed']
    return ['batches:', `batch:${batch}`, `batch-tasks:${batch}`, `batch-history:${batch}`]
  }
  return []
}

/** True while the person is typing in a field or dragging a card: a refresh then waits (specs/realtime.md). */
export function isUserBusy(doc: Pick<Document, 'activeElement' | 'querySelector'>): boolean {
  const active = doc.activeElement as HTMLElement | null
  const typing = !!active && (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName))
  // vue-draggable-plus (SortableJS) marks the card being dragged.
  return typing || !!doc.querySelector('.sortable-chosen, .sortable-drag, .sortable-ghost')
}
