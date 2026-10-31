import { describe, expect, it } from 'vitest'
import type { TaskListFilters } from '../../app/types/api'
import { chipApiQuery, chipIsActive, chipQuery, chipsAdmitNewTask, parseChips } from '../../app/utils/taskFilterChips'

const base: TaskListFilters = { completed: 'all', assignedToMe: false, ownedByMe: false, sort: 'recently_updated' }
const query = (values: Record<string, string>) => (key: string) => values[key]

describe('task filter chips', () => {
  it('reads legacy links as "is"', () => {
    const chips = parseChips(query({ status: 'Open,Working', owner: 'a@x.qa', priority: 'High', label: 'lbl-1' }))
    expect(chips.statuses).toEqual(['Open', 'Working'])
    expect(chips.priorities).toEqual(['High'])
    expect(chips.labels).toEqual(['lbl-1'])
    expect(chips.operators).toEqual({})
  })

  it('drops unknown values and operators a field does not support', () => {
    const chips = parseChips(query({ status: 'Open,Bogus', status_op: 'empty', priority: 'Urgent', assignee_op: 'empty', label_op: 'contains' }))
    expect(chips.statuses).toEqual(['Open'])
    expect(chips.priorities).toEqual([])
    expect(chips.operators).toEqual({ assignee: 'empty' })
  })

  it('writes short links: no "is", no values for "is empty"', () => {
    expect(chipQuery('status', 'is', ['Open'])).toEqual({ status: 'Open', status_op: null })
    expect(chipQuery('assignee', 'empty', ['a@x.qa'])).toEqual({ assignee: null, assignee_op: 'empty' })
    expect(chipQuery('space', 'is', [])).toEqual({ spaces: null, spaces_op: null })
  })

  it('treats a chip as active once it narrows the list', () => {
    expect(chipIsActive(base, 'assignee')).toBe(false)
    expect(chipIsActive({ ...base, operators: { assignee: 'not' } }, 'assignee')).toBe(false)
    expect(chipIsActive({ ...base, operators: { assignee: 'empty' } }, 'assignee')).toBe(true)
    expect(chipIsActive({ ...base, statuses: ['Open'] }, 'status')).toBe(true)
  })

  it('builds the API query with operators', () => {
    expect(chipApiQuery({
      ...base,
      statuses: ['Completed'],
      priorities: ['High', 'Highest'],
      assignees: ['ignored@x.qa'],
      operators: { status: 'not', assignee: 'empty' }
    })).toEqual({ statuses: 'Completed', statuses_op: 'not', priority: 'High,Highest', assignees_op: 'empty' })
    expect(chipApiQuery(base)).toEqual({})
  })

  it('knows whether a new open, unassigned, Medium Task would match', () => {
    expect(chipsAdmitNewTask(base)).toBe(true)
    expect(chipsAdmitNewTask({ ...base, operators: { assignee: 'empty' } })).toBe(true)
    expect(chipsAdmitNewTask({ ...base, operators: { assignee: 'set' } })).toBe(false)
    expect(chipsAdmitNewTask({ ...base, assignees: ['a@x.qa'] })).toBe(false)
    expect(chipsAdmitNewTask({ ...base, statuses: ['Completed'], operators: { status: 'not' } })).toBe(true)
    expect(chipsAdmitNewTask({ ...base, priorities: ['Medium'], operators: { priority: 'not' } })).toBe(false)
    expect(chipsAdmitNewTask({ ...base, labels: ['l'], operators: { label: 'not' } })).toBe(true)
    expect(chipsAdmitNewTask({ ...base, owners: ['a@x.qa'] })).toBe(false)
  })
})
