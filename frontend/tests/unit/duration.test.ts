import { describe, expect, it } from 'vitest'
import { formatDuration, parseDuration, parseEstimate } from '~/utils/duration'
import { describeHistory } from '~/utils/history'

// Same cases as backend TestDurations.test_parsing_and_bounds: client and server must agree.
describe('duration parsing (integer minutes)', () => {
  const valid: Array<[string | number, number]> = [
    ['30m', 30], ['1h', 60], ['1h 30m', 90], ['1h30m', 90], ['90m', 90], ['90', 90], ['1.5h', 90],
    ['0.25h', 15], ['2:15', 135], [' 2H 5M ', 125], [45, 45], ['24h', 1440]
  ]
  it.each(valid)('%s → %i minutes', (input, minutes) => {
    expect(parseDuration(input)).toEqual({ ok: true, minutes })
  })
  const invalid: Array<string | number> = ['', '0', '0m', '-5m', '1.33h', 'abc', '1d', 'nan', '1e3m', '24h 1m', '99999999999', '1h 60x', 1.5]
  it.each(invalid)('rejects %s', (input) => {
    expect(parseDuration(input).ok).toBe(false)
  })
  it('estimates: empty = none, 0 = nothing left, longer than a day allowed', () => {
    expect(parseEstimate('')).toEqual({ ok: true, minutes: null })
    expect(parseEstimate('0')).toEqual({ ok: true, minutes: 0 })
    expect(parseEstimate('40h')).toEqual({ ok: true, minutes: 2400 })
  })
  it('formats without rounding', () => {
    expect([formatDuration(45), formatDuration(90), formatDuration(120), formatDuration(0), formatDuration(null)]).toEqual(['45m', '1h 30m', '2h', '0m', ''])
  })
})

describe('time history sentences', () => {
  const actor = { name: 'a@x', fullName: 'Lina', image: null }
  it('describes corrections and voids from recorded data only', () => {
    expect(describeHistory({ event: 'time_edited', actor, from: { minutes: 60, workDate: '2026-10-27' }, to: { minutes: 105, workDate: '2026-10-27' }, noteChanged: true }))
      .toBe('Lina corrected a time entry (1h → 1h 45m, note updated)')
    expect(describeHistory({ event: 'time_voided', actor, minutes: 90, moderated: true, worker: { name: 'b@x', fullName: 'Omar', image: null }, reason: 'Wrong task' }))
      .toBe('Lina voided 1h 30m logged by Omar: Wrong task')
    expect(describeHistory({ event: 'field_changed', actor, field: 'remainingMinutes', from: null, to: 150 })).toBe('Lina set the remaining estimate to 2h 30m')
    expect(describeHistory({ event: 'field_changed', actor, field: 'remainingMinutes', from: 150, to: null })).toBe('Lina cleared the remaining estimate')
  })
})
