import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskListRow } from '~/types/api'
import { formatAgo } from '~/utils/format'
import { readSavedFilters, saveFilters } from '~/utils/savedFilters'
import { parseChips, toggleChipValue } from '~/utils/taskFilterChips'
import { nextColumnSort, parseColumnSort, sortTasks } from '~/utils/taskSort'

// Client revision 6 (2026-11-01): header sorting, click-to-filter, Last modified and saved filters.

const row = (name: string, fields: Partial<TaskListRow>) => ({ name, title: name, status: 'Open', priority: 'Medium', space: 'S-1', spaceTitle: 'Alpha', modified: '2026-10-01T10:00:00+03:00', ...fields }) as TaskListRow
const names = (tasks: TaskListRow[]) => tasks.map(t => t.name)
const tasks = [
  row('t1', { title: 'beta report', status: 'Working', priority: 'Low', spaceTitle: 'Gamma', modified: '2026-10-03T10:00:00+03:00' }),
  row('t2', { title: 'Alpha plan', status: 'Completed', priority: 'Highest', spaceTitle: 'alpha', modified: '2026-10-01T10:00:00+03:00' }),
  row('t3', { title: 'Task 10', status: 'Open', priority: 'Medium', spaceTitle: 'Beta', modified: '2026-10-02T10:00:00+03:00' }),
  row('t4', { title: 'Task 9', status: 'Open', priority: 'High', spaceTitle: 'Beta', modified: '2026-10-04T10:00:00+03:00' })
]

describe('column sorting', () => {
  it('sorts Task, Status and Space A to Z, ignoring case, numbers in order', () => {
    expect(names(sortTasks(tasks, { column: 'title', direction: 'asc' }))).toEqual(['t2', 't1', 't4', 't3'])
    expect(names(sortTasks(tasks, { column: 'status', direction: 'asc' }))).toEqual(['t2', 't3', 't4', 't1'])
    expect(names(sortTasks(tasks, { column: 'space', direction: 'asc' }))).toEqual(['t2', 't3', 't4', 't1'])
  })

  it('sorts Priority from Highest to Lowest first and Last modified newest first', () => {
    expect(names(sortTasks(tasks, nextColumnSort(null, 'priority')))).toEqual(['t2', 't4', 't3', 't1'])
    expect(names(sortTasks(tasks, nextColumnSort(null, 'modified')))).toEqual(['t4', 't1', 't3', 't2'])
  })

  it('reverses on the second click and keeps the server order for ties and without a sort', () => {
    const first = nextColumnSort(null, 'title')
    expect(nextColumnSort(first, 'title')).toEqual({ column: 'title', direction: 'desc' })
    expect(nextColumnSort(first, 'priority')).toEqual({ column: 'priority', direction: 'desc' })
    expect(names(sortTasks(tasks, { column: 'space', direction: 'desc' }))).toEqual(['t1', 't3', 't4', 't2'])
    expect(sortTasks(tasks, null)).toBe(tasks)
  })

  it('reads only known columns and directions from links', () => {
    expect(parseColumnSort('priority', undefined)).toEqual({ column: 'priority', direction: 'desc' })
    expect(parseColumnSort('title', 'desc')).toEqual({ column: 'title', direction: 'desc' })
    expect(parseColumnSort('creation', 'asc')).toBeNull()
  })
})

describe('click a cell to filter', () => {
  const filtersOf = (query: Record<string, string>) => parseChips(key => query[key])

  it('filters by the clicked value, and a second click removes it', () => {
    expect(toggleChipValue(filtersOf({}), 'priority', 'High')).toEqual({ priority: 'High', priority_op: null })
    expect(toggleChipValue(filtersOf({ priority: 'High' }), 'priority', 'High')).toEqual({ priority: null, priority_op: null })
    expect(toggleChipValue(filtersOf({ priority: 'High,Low' }), 'priority', 'Low')).toEqual({ priority: 'High', priority_op: null })
  })

  it('replaces another value or an "is not" filter, and a Space click clears Space-bound filters', () => {
    expect(toggleChipValue(filtersOf({ priority: 'Low' }), 'priority', 'High')).toEqual({ priority: 'High', priority_op: null })
    expect(toggleChipValue(filtersOf({ priority: 'High', priority_op: 'not' }), 'priority', 'High')).toEqual({ priority: 'High', priority_op: null })
    expect(toggleChipValue(filtersOf({}), 'space', 'S-1')).toEqual({ spaces: 'S-1', spaces_op: null, label: null, label_op: null, feature: null, release: null })
  })
})

describe('Last modified wording', () => {
  // Business time is Asia/Qatar (UTC+3).
  const now = new Date('2026-11-01T12:00:00+03:00')
  const at = (iso: string) => formatAgo(iso, now)

  it('uses minutes, hours and days, then weeks, months and years', () => {
    expect(at('2026-11-01T11:59:40+03:00')).toBe('just now')
    expect(at('2026-11-01T11:55:00+03:00')).toBe('5 minutes ago')
    expect(at('2026-11-01T09:00:00+03:00')).toBe('3 hours ago')
    expect(at('2026-10-31T08:00:00+03:00')).toBe('yesterday')
    expect(at('2026-10-28T12:00:00+03:00')).toBe('4 days ago')
    expect(at('2026-10-25T12:00:00+03:00')).toBe('1 week ago')
    expect(at('2026-10-11T12:00:00+03:00')).toBe('3 weeks ago')
    expect(at('2026-10-02T12:00:00+03:00')).toBe('1 month ago')
    expect(at('2026-05-01T12:00:00+03:00')).toBe('6 months ago')
    expect(at('2025-10-31T12:00:00+03:00')).toBe('1 year ago')
    expect(at('2023-06-01T12:00:00+03:00')).toBe('3 years ago')
  })
})

describe('saved filters', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('saves and reads one list\'s filters', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    saveFilters('space:S-1', { priority: 'High', sort: 'created' })
    expect(readSavedFilters('space:S-1')).toEqual({ priority: 'High', sort: 'created' })
    expect(readSavedFilters('all')).toBeNull()
  })

  it('ignores damaged or unavailable storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{"q": 1, "status": "Open"', setItem: () => { throw new Error('full') } })
    expect(readSavedFilters('all')).toBeNull()
    expect(() => saveFilters('all', { q: 'x' })).not.toThrow()
    vi.stubGlobal('localStorage', { getItem: () => '{"q": 1, "status": "Open"}' })
    expect(readSavedFilters('all')).toEqual({ status: 'Open' })
  })
})
