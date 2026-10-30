import { describe, expect, it } from 'vitest'
import { businessToday, formatDateTime, formatDueDate, isOverdue, setBusinessTimeZone, textToHtml } from '~/utils/format'
import { frappeLoginUrl } from '~/utils/redirect'

describe('Frappe login', () => {
  it('returns to the requested Masar page after signing in', () => {
    expect(frappeLoginUrl('/masar/spaces/a/tasks?task=1')).toBe('/login?redirect-to=%2Fmasar%2Fspaces%2Fa%2Ftasks%3Ftask%3D1')
  })
  it('never redirects to another origin', () => {
    for (const bad of ['//evil.example', 'https://evil.example', 'javascript:alert(1)']) {
      expect(frappeLoginUrl(bad)).toBe('/login?redirect-to=%2Fmasar')
    }
  })
})

describe('formatting in business time (Asia/Qatar)', () => {
  setBusinessTimeZone('Asia/Qatar')
  const today = '2026-10-27'
  it('formats date-only values without timezone shifts', () => {
    expect(formatDueDate('2026-11-01', today)).toBe('Nov 1')
    expect(formatDueDate('2027-01-05', today)).toBe('Jan 5, 2027')
    expect(formatDueDate('2026-01-01', today)).toBe('Jan 1')
  })
  it('detects overdue dates against the business calendar date', () => {
    expect(isOverdue('2026-10-26', today)).toBe(true)
    expect(isOverdue('2026-10-27', today)).toBe(false)
  })
  it('uses the Qatar calendar date, not UTC or the browser zone', () => {
    // 22:30 UTC on Oct 27 is already 01:30 on Oct 28 in Qatar (UTC+3, no DST).
    expect(businessToday(new Date('2026-10-27T22:30:00Z'))).toBe('2026-10-28')
    expect(businessToday(new Date('2026-10-27T20:59:00Z'))).toBe('2026-10-27')
  })
  it('renders timestamps in Qatar time regardless of their offset', () => {
    expect(formatDateTime('2026-10-28T04:36:37+05:30')).toBe('Oct 28, 2026, 2:06 AM')
    expect(formatDateTime('2026-10-28T02:06:37+03:00')).toBe('Oct 28, 2026, 2:06 AM')
    expect(formatDateTime('2026-07-01T09:00:00Z')).toBe('Jul 1, 2026, 12:00 PM') // no DST in summer
  })
  it('escapes plain text when converting to HTML', () => {
    expect(textToHtml('a <script>x</script>\n\nsecond')).toBe('<p>a &lt;script&gt;x&lt;/script&gt;</p><p>second</p>')
    expect(textToHtml('   ')).toBeNull()
  })
})
