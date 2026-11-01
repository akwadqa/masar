import { describe, expect, it } from 'vitest'
import { mergeNewestPage } from '~/utils/timelineMerge'

// Items are oldest first, like the server's timeline pages.
const item = (id: string, text = id) => ({ id, text })
const ids = (list: { id: string }[] | null) => list?.map(i => i.id)

describe('mergeNewestPage (client revision 6, R2)', () => {
  it('appends new items after the known ones, in server order', () => {
    const known = [item('c1'), item('c2'), item('c3')]
    const page = [item('c2'), item('c3'), item('c4'), item('c5')]
    expect(ids(mergeNewestPage(known, page, true))).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
  })

  it('refreshes changed items in place', () => {
    const known = [item('c1'), item('c2')]
    const merged = mergeNewestPage(known, [item('c2', 'edited')], true)
    expect(merged).toEqual([item('c1'), item('c2', 'edited')])
  })

  it('never moves the newest comment below older ones (the e-mail deep-link bug)', () => {
    // The whole timeline is loaded; the newest comment X is last (shown first, newest first).
    const known = [item('c1'), item('c2'), item('c3'), item('x')]
    const page = [item('c2'), item('c3'), item('x')]
    const merged = mergeNewestPage(known, page, true)
    expect(ids(merged)).toEqual(['c1', 'c2', 'c3', 'x'])
    expect(merged!.at(-1)!.id).toBe('x')
  })

  it('takes the page as the whole timeline when nothing precedes it', () => {
    expect(ids(mergeNewestPage([item('a'), item('b')], [item('b'), item('c')], false))).toEqual(['b', 'c'])
    expect(mergeNewestPage([item('a')], [], false)).toEqual([])
  })

  it('asks for a full reload when the page does not overlap the known items', () => {
    expect(mergeNewestPage([item('c1'), item('c2')], [item('c9'), item('c10')], true)).toBeNull()
    expect(mergeNewestPage([item('c1')], [], true)).toBeNull()
  })
})
