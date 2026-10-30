import { describe, expect, it } from 'vitest'
import type { TaskListRow } from '~/types/api'
import { buildTaskRows, insertTask, nextFocusIndex } from '~/utils/taskRows'

const task = (name: string, clientRequestId: string | null = null): TaskListRow => ({
  name, title: name, space: 's', priority: 'Medium', dueDate: null, isCompleted: false, isImportant: false,
  isMyDay: false, assignees: [], taskOwner: null, actionCount: 0, actionDoneCount: 0, commentCount: 0,
  sortOrder: 0, modified: '', clientRequestId, labels: [], feature: null, release: null
})
const action = (name: string, task: string) => ({
  name, task, title: name, isDone: false, doneBy: null, doneAt: null, sortOrder: 0, promotedTask: null,
  promotedAt: null, createdBy: 'u', modified: '', clientRequestId: null
})

describe('task row model', () => {
  it('places pending drafts above tasks', () => {
    const rows = buildTaskRows([task('a')], [{ id: 'd1', title: 'Draft', status: 'saving' }])
    expect(rows.map(r => r.kind)).toEqual(['draft', 'task'])
  })

  it('hides a draft once its task arrived from the server (no visual duplicate)', () => {
    const rows = buildTaskRows([task('a', 'd1')], [{ id: 'd1', title: 'Draft', status: 'saving' }])
    expect(rows.map(r => r.kind)).toEqual(['task'])
  })

  it('renders expanded Actions under their task and status rows while loading or empty', () => {
    const rows = buildTaskRows([task('a'), task('b'), task('c')], [], {
      a: [action('x1', 'a'), action('x2', 'a')], b: 'loading', c: []
    })
    expect(rows.map(r => r.key)).toEqual([
      'task:a', 'action:x1', 'action:x2', 'task:b', 'actions-status:b', 'task:c', 'actions-status:c'
    ])
  })

  it('inserts a created task once, at the top', () => {
    const rows = [task('a'), task('b')]
    expect(insertTask(rows, task('c')).map(r => r.name)).toEqual(['c', 'a', 'b'])
    expect(insertTask(rows, task('a'))).toBe(rows)
  })

  it('clamps keyboard focus movement', () => {
    expect(nextFocusIndex(-1, 1, 3)).toBe(0)
    expect(nextFocusIndex(-1, -1, 3)).toBe(2)
    expect(nextFocusIndex(2, 1, 3)).toBe(2)
    expect(nextFocusIndex(0, -1, 3)).toBe(0)
    expect(nextFocusIndex(0, 1, 0)).toBe(-1)
  })
})
