import { parseDate } from '@internationalized/date'
import type { BatchPreset } from '~/types/api'

// Batch presets use inclusive calendar days in the business calendar (ADR-047): One Week = 7 days
// (Monday → Sunday), Two Weeks = 14. Pure calendar arithmetic: no Date objects, no timezone shift.
export const PRESET_DAYS: Record<BatchPreset, number> = { one_week: 7, two_weeks: 14 }

export function endForPreset(startDate: string, preset: BatchPreset): string {
  return parseDate(startDate).add({ days: PRESET_DAYS[preset] - 1 }).toString()
}

/** Inclusive length in days, or null when the end is before the start. */
export function inclusiveDays(startDate: string, endDate: string): number | null {
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  if (end.compare(start) < 0) return null
  return end.compare(start) + 1
}

export function presetFor(startDate: string, endDate: string): BatchPreset | 'custom' {
  const days = inclusiveDays(startDate, endDate)
  return days === 7 ? 'one_week' : days === 14 ? 'two_weeks' : 'custom'
}
