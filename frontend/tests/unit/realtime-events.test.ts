import { describe, expect, it } from 'vitest'
import { isUserBusy, REALTIME_EVENTS, refreshPrefixes } from '~/utils/realtimeEvents'

describe('refreshPrefixes', () => {
  it('refreshes lists, boards and the changed Space only, never Task details', () => {
    const prefixes = refreshPrefixes(REALTIME_EVENTS.spaceChanged, { space: 'SP-A' })
    expect(prefixes).toEqual(expect.arrayContaining(['tasks:', 'batches:', 'batch-tasks:', 'spaces:list', 'space:SP-A', 'space-members:SP-A']))
    expect(prefixes).not.toContain('space:SP-B')
    expect(prefixes.some(prefix => prefix.startsWith('task:'))).toBe(false)
  })

  it('refreshes the Batch list and only the changed Batch', () => {
    expect(refreshPrefixes(REALTIME_EVENTS.batchChanged, { batch: 'B-1' }))
      .toEqual(['batches:', 'batch:B-1', 'batch-tasks:B-1', 'batch-history:B-1'])
  })

  it('leaves the cache alone for notifications, which the bell handles itself', () => {
    expect(refreshPrefixes(REALTIME_EVENTS.notification, {})).toEqual([])
  })
})

describe('isUserBusy', () => {
  const doc = (active: Partial<HTMLElement> | null, dragging = false) => ({
    activeElement: active as Element | null,
    querySelector: () => (dragging ? ({} as Element) : null)
  })

  it('is busy while a text field or an editable area has focus', () => {
    expect(isUserBusy(doc({ tagName: 'INPUT', isContentEditable: false }))).toBe(true)
    expect(isUserBusy(doc({ tagName: 'TEXTAREA', isContentEditable: false }))).toBe(true)
    expect(isUserBusy(doc({ tagName: 'DIV', isContentEditable: true }))).toBe(true)
  })

  it('is busy while a card is being dragged', () => {
    expect(isUserBusy(doc({ tagName: 'BODY', isContentEditable: false }, true))).toBe(true)
  })

  it('is free when nothing is focused or a button has focus', () => {
    expect(isUserBusy(doc(null))).toBe(false)
    expect(isUserBusy(doc({ tagName: 'BUTTON', isContentEditable: false }))).toBe(false)
  })
})
