import { describe, expect, it } from 'vitest'
import { pruneSelection, selectAll, toggleSelection } from '~/utils/selection'
import { pushRecent } from '~/utils/recent'

const visible = ['a', 'b', 'c', 'd', 'e']

describe('task selection', () => {
  it('toggles single tasks and remembers the anchor', () => {
    let state = toggleSelection(new Set(), visible, 'b', null, false)
    expect([...state.selected]).toEqual(['b'])
    state = toggleSelection(state.selected, visible, 'b', state.anchor, false)
    expect(state.selected.size).toBe(0)
  })

  it('selects an inclusive range in visible order in either direction', () => {
    const first = toggleSelection(new Set(), visible, 'd', null, false)
    const range = toggleSelection(first.selected, visible, 'b', first.anchor, true)
    expect([...range.selected].sort()).toEqual(['b', 'c', 'd'])
  })

  it('falls back to a toggle when the anchor is no longer visible', () => {
    const state = toggleSelection(new Set(['x']), visible, 'c', 'x', true)
    expect([...state.selected].sort()).toEqual(['c', 'x'])
  })

  it('prunes selections that left the result and selects all visible', () => {
    expect([...pruneSelection(new Set(['a', 'z']), visible)]).toEqual(['a'])
    expect(selectAll(visible).size).toBe(5)
  })
})

describe('recent tasks', () => {
  it('keeps the newest first without duplicates and a bounded length', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(pushRecent(['a', 'b'], 'z', 2)).toEqual(['z', 'a'])
  })
})
