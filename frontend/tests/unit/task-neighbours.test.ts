import { describe, expect, it } from 'vitest'
import { nextTaskAfter } from '~/utils/taskNeighbours'

describe('nextTaskAfter', () => {
  const order = ['T-1', 'T-2', 'T-3']

  it('opens the Task below the current one', () => {
    expect(nextTaskAfter(order, 'T-1')).toBe('T-2')
    expect(nextTaskAfter(order, 'T-2')).toBe('T-3')
  })

  it('opens the Task above when the current one is last', () => {
    expect(nextTaskAfter(order, 'T-3')).toBe('T-2')
  })

  it('has nothing to open when the current Task is the only row', () => {
    expect(nextTaskAfter(['T-1'], 'T-1')).toBeNull()
  })

  it('has nothing to open when the current Task is not in the list', () => {
    expect(nextTaskAfter(order, 'T-9')).toBeNull()
    expect(nextTaskAfter([], 'T-1')).toBeNull()
  })
})
