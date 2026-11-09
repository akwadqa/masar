import { describe, expect, it } from 'vitest'
import { activeUsers, describePeople, updateSignals } from '~/utils/liveSignals'

describe('live signals', () => {
  it('adds, renews and removes one person per field', () => {
    let signals = updateSignals([], 'lina', 'title', true, 1000)
    signals = updateSignals(signals, 'lina', 'title', true, 5000)
    expect(signals).toEqual([{ user: 'lina', field: 'title', until: 5000 }])
    signals = updateSignals(signals, 'omar', 'description', true, 5000)
    signals = updateSignals(signals, 'lina', 'title', false, 0)
    expect(signals).toEqual([{ user: 'omar', field: 'description', until: 5000 }])
  })

  it('counts a signal only until it expires, and only for its own field', () => {
    const signals = updateSignals(updateSignals([], 'lina', 'title', true, 2000), 'omar', '', true, 9000)
    expect(activeUsers(signals, 1000, 'title')).toEqual(['lina'])
    expect(activeUsers(signals, 2000, 'title')).toEqual([])
    expect(activeUsers(signals, 1000)).toEqual(['omar'])
  })
})

describe('describePeople', () => {
  it('names one, two or several people', () => {
    expect(describePeople([], 'is typing…')).toBe('')
    expect(describePeople(['Lina'], 'is typing…')).toBe('Lina is typing…')
    expect(describePeople(['Lina', 'Omar'], 'are typing…')).toBe('Lina and Omar are typing…')
    expect(describePeople(['Lina', 'Omar', 'Sara'], 'are typing…')).toBe('Lina, Omar and 1 other are typing…')
    expect(describePeople(['Lina', 'Omar', 'Sara', 'Ali'], 'are typing…')).toBe('Lina, Omar and 2 others are typing…')
  })
})
