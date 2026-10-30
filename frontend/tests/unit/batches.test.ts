import { describe, expect, it } from 'vitest'
import type { BatchRef, TaskListRow } from '~/types/api'
import { endForPreset, inclusiveDays, presetFor } from '~/utils/batchDates'
import { buildTaskRows, groupTasksByBatch } from '~/utils/taskRows'

const batch = (name: string, status: BatchRef['status']): BatchRef => ({ name, title: name.toUpperCase(), status })
const task = (name: string, b: BatchRef | null): TaskListRow => ({
  name, title: name, space: 's', priority: 'Medium', dueDate: null, isCompleted: false, isImportant: false,
  isMyDay: false, assignees: [], taskOwner: null, actionCount: 0, actionDoneCount: 0, commentCount: 0,
  sortOrder: 0, modified: '', clientRequestId: null, labels: [], feature: null, release: null, batch: b
})

describe('Batch date presets (inclusive calendar days)', () => {
  it('One Week ends on the sixth day after the start (Monday → Sunday)', () => {
    expect(endForPreset('2026-11-02', 'one_week')).toBe('2026-11-08')
    expect(endForPreset('2026-11-02', 'two_weeks')).toBe('2026-11-15')
  })
  it('crosses month, year and leap-day boundaries without shifting', () => {
    expect(endForPreset('2026-12-28', 'one_week')).toBe('2027-01-03')
    expect(endForPreset('2028-02-25', 'one_week')).toBe('2028-03-02')
  })
  it('counts inclusive days and recognises presets', () => {
    expect(inclusiveDays('2026-11-02', '2026-11-02')).toBe(1)
    expect(inclusiveDays('2026-11-02', '2026-11-01')).toBeNull()
    expect(presetFor('2026-11-02', '2026-11-08')).toBe('one_week')
    expect(presetFor('2026-11-02', '2026-11-15')).toBe('two_weeks')
    expect(presetFor('2026-11-02', '2026-11-10')).toBe('custom')
  })
})

describe('Batch-grouped task rows', () => {
  const active = batch('a', 'Active')
  const planned = batch('p', 'Planned')
  const tasks = [task('t1', planned), task('t2', null), task('t3', active), task('t4', active)]

  it('orders groups Active, Planned, then unbatched', () => {
    expect(groupTasksByBatch(tasks).map(g => [g.batch?.name ?? 'none', g.tasks.map(t => t.name)])).toEqual([
      ['a', ['t3', 't4']], ['p', ['t1']], ['none', ['t2']]
    ])
  })
  it('renders header → tasks → Actions and hides collapsed groups', () => {
    const rows = buildTaskRows(tasks, [], { t3: [] }, { collapsed: new Set(['p']) })
    expect(rows.map(r => r.key)).toEqual([
      'group:a', 'task:t3', 'actions-status:t3', 'task:t4', 'group:p', 'group:none', 'task:t2'
    ])
    const header = rows.find(r => r.key === 'group:p')
    expect(header && header.kind === 'group' && header.collapsed && header.count).toBe(1)
  })
  it('keys rows by identity so selection never follows a virtual position', () => {
    const keys = buildTaskRows(tasks, [], {}, { collapsed: new Set() }).map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
