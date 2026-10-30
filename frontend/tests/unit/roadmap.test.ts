import { describe, expect, it } from 'vitest'
import type { Feature, RoadmapColumn } from '~/types/api'
import { moveNeighbours, placeFeature, stepOrder } from '~/utils/roadmap'

const feature = (name: string, roadmap: RoadmapColumn): Feature => ({
  name, space: 's', title: name, roadmap, sortOrder: 0, modified: '',
  progress: { total: 0, completed: 0, open: 0, percent: null }
})

describe('roadmap ordering', () => {
  it('derives the neighbours sent to the move API', () => {
    expect(moveNeighbours(['a', 'b', 'c'], 'b')).toEqual({ before: 'a', after: 'c' })
    expect(moveNeighbours(['a', 'b'], 'a')).toEqual({ before: undefined, after: 'b' })
    expect(moveNeighbours(['a'], 'a')).toEqual({ before: undefined, after: undefined })
    expect(moveNeighbours(['a'], 'x')).toEqual({})
  })

  it('steps within a column and stops at the edges', () => {
    expect(stepOrder(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(stepOrder(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c'])
    expect(stepOrder(['a', 'b'], 'a', -1)).toBeNull()
    expect(stepOrder(['a', 'b'], 'b', 1)).toBeNull()
  })

  it('places a moved Feature optimistically without losing or duplicating cards', () => {
    const items = [feature('a', 'Now'), feature('b', 'Now'), feature('c', 'Next')]
    const placed = placeFeature(items, 'a', 'Next', ['c', 'a'])
    expect(placed.map(f => `${f.name}:${f.roadmap}`)).toEqual(['b:Now', 'c:Next', 'a:Next'])
    expect(placeFeature(items, 'missing', 'Done', ['missing'])).toBe(items)
  })
})
