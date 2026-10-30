import { describe, expect, it } from 'vitest'
import { FINISHED_STATUSES, MANUAL_STATUSES, TASK_STATUSES } from '~/types/api'
import { statusStyle } from '~/utils/taskStatus'
import { readTaskDrop, TASK_DRAG_TYPE } from '~/utils/taskGrid'
import { userColor } from '~/utils/userColor'

describe('task statuses', () => {
  it('offers eight statuses; people choose every one except Overdue', () => {
    expect(TASK_STATUSES).toHaveLength(8)
    expect(MANUAL_STATUSES).not.toContain('Overdue')
    expect(FINISHED_STATUSES).toEqual(['Completed', 'Closed', 'Cancelled'])
  })
  it('gives every status its own icon and colour', () => {
    const icons = new Set(TASK_STATUSES.map(status => statusStyle(status).icon))
    expect(icons.size).toBe(TASK_STATUSES.length)
    expect(statusStyle('Overdue').text).toBe('text-overdue')
  })
})

describe('personal avatar colours', () => {
  it('keeps one colour per person', () => {
    expect(userColor('maryam@example.com')).toBe(userColor('maryam@example.com'))
    expect(userColor('a@example.com')).toMatch(/^var\(--masar-space-[a-z]+\)$/)
  })
})

describe('task drops', () => {
  it('reads only Masar task payloads', () => {
    const event = (data: string) => ({ dataTransfer: { getData: (type: string) => (type === TASK_DRAG_TYPE ? data : '') } }) as unknown as DragEvent
    expect(readTaskDrop(event('["T-1","T-2"]'))).toEqual(['T-1', 'T-2'])
    expect(readTaskDrop(event('not json'))).toBeNull()
    expect(readTaskDrop(event('[1, 2]'))).toBeNull()
  })
})
