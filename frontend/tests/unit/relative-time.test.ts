import { describe, expect, it } from 'vitest'
import { formatRelative } from '~/utils/format'

// Business time is Asia/Qatar (UTC+3), the default before boot sets it.
const now = new Date('2026-10-31T12:00:00+03:00')
const at = (iso: string) => formatRelative(iso, now)

describe('relative comment times', () => {
  it('words recent times in minutes and hours', () => {
    expect(at('2026-10-31T11:59:30+03:00')).toBe('just now')
    expect(at('2026-10-31T11:59:00+03:00')).toBe('1 minute ago')
    expect(at('2026-10-31T11:15:00+03:00')).toBe('45 minutes ago')
    expect(at('2026-10-31T11:00:00+03:00')).toBe('1 hour ago')
    expect(at('2026-10-30T13:00:00+03:00')).toBe('23 hours ago')
  })

  it('counts days by the business calendar, then shows the date', () => {
    expect(at('2026-10-30T09:00:00+03:00')).toBe('yesterday')
    expect(at('2026-10-29T23:00:00+03:00')).toBe('2 days ago')
    expect(at('2026-10-25T12:00:00+03:00')).toBe('6 days ago')
    expect(at('2026-10-24T12:00:00+03:00')).toBe('Oct 24')
    expect(at('2025-12-30T12:00:00+03:00')).toBe('Dec 30, 2025')
  })

  it('never shows a future time as ago', () => {
    expect(at('2026-10-31T12:05:00+03:00')).toBe('just now')
  })
})
