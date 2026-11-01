import { describe, expect, it } from 'vitest'
import { parseMine, toggleMine } from '~/utils/mineFilter'

// "Assigned to me" and "Owned by me" can be on together (client decision 2026-11-02).
describe('mine filter', () => {
  it('reads one, both or neither from the link, including older single-value links', () => {
    expect(parseMine('assigned')).toEqual({ assignedToMe: true, ownedByMe: false })
    expect(parseMine('owned')).toEqual({ assignedToMe: false, ownedByMe: true })
    expect(parseMine('assigned,owned')).toEqual({ assignedToMe: true, ownedByMe: true })
    expect(parseMine(undefined)).toEqual({ assignedToMe: false, ownedByMe: false })
    expect(parseMine(undefined, true)).toEqual({ assignedToMe: true, ownedByMe: false })
    expect(parseMine('none', true)).toEqual({ assignedToMe: false, ownedByMe: false })
  })

  it('switches each toggle on its own, keeping the other', () => {
    const none = { assignedToMe: false, ownedByMe: false }
    expect(toggleMine(none, 'owned')).toBe('owned')
    expect(toggleMine({ assignedToMe: true, ownedByMe: false }, 'owned')).toBe('assigned,owned')
    expect(toggleMine({ assignedToMe: true, ownedByMe: true }, 'assigned')).toBe('owned')
    expect(toggleMine({ assignedToMe: false, ownedByMe: true }, 'owned')).toBeNull()
  })
})
