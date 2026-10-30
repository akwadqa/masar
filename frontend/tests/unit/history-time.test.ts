import { describe, expect, it } from 'vitest'
import type { HistoryEntry, UserRef } from '~/types/api'
import { describeHistory } from '~/utils/history'

const user = (fullName: string): UserRef => ({ name: `${fullName}@x`, fullName, image: null })
const ana = user('Ana')
const entry = (e: Partial<HistoryEntry>): HistoryEntry => ({ event: 'field_changed', actor: ana, ...e })

describe('time and estimate history sentences', () => {
  it('describes corrections with only what changed', () => {
    const from = { minutes: 90, workDate: '2026-10-27' }
    expect(describeHistory(entry({ event: 'time_edited', from, to: { minutes: 120, workDate: '2026-10-27' } }))).toBe('Ana corrected a time entry (1h 30m → 2h)')
    expect(describeHistory(entry({ event: 'time_edited', from, to: { ...from }, noteChanged: true }))).toBe('Ana corrected a time entry (note updated)')
    expect(describeHistory(entry({ event: 'time_edited', from, to: { minutes: 90, workDate: '2026-10-26' } }))).toContain('→')
    expect(describeHistory(entry({ event: 'time_edited' }))).toBe('Ana corrected a time entry')
  })

  it('distinguishes own voids from moderation and keeps the reason', () => {
    expect(describeHistory(entry({ event: 'time_voided', minutes: 45 }))).toBe('Ana voided their 45m entry')
    expect(describeHistory(entry({ event: 'time_voided', minutes: 60, moderated: true, worker: user('Omar'), reason: 'Wrong task' })))
      .toBe('Ana voided 1h logged by Omar: Wrong task')
    expect(describeHistory(entry({ event: 'time_voided', minutes: 60, moderated: true, worker: null }))).toBe('Ana voided 1h logged by a member')
  })

  it('describes estimates set, changed, zeroed and cleared', () => {
    expect(describeHistory(entry({ field: 'remainingMinutes', from: null, to: 240 }))).toBe('Ana set the remaining estimate to 4h')
    expect(describeHistory(entry({ field: 'remainingMinutes', from: 240, to: 90 }))).toBe('Ana set the remaining estimate to 1h 30m (was 4h)')
    expect(describeHistory(entry({ field: 'remainingMinutes', from: 90, to: 0 }))).toBe('Ana set the remaining estimate to 0m (was 1h 30m)')
    expect(describeHistory(entry({ field: 'remainingMinutes', from: 90, to: null }))).toBe('Ana cleared the remaining estimate')
    expect(describeHistory(entry({ actor: null, field: 'remainingMinutes', from: null, to: 30 }))).toBe('Someone set the remaining estimate to 30m')
  })
})
