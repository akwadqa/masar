// Durations are integer minutes (ADR-060). Same grammar as masar.services.time_service.parse_duration;
// the server stays authoritative, this gives instant feedback.
export const MAX_ENTRY_MINUTES = 24 * 60
export const MAX_ESTIMATE_MINUTES = 10_000 * 60

export type DurationResult = { ok: true, minutes: number } | { ok: false, error: string }

export function parseDuration(input: string | number, maximum = MAX_ENTRY_MINUTES): DurationResult {
  const invalid = { ok: false as const, error: 'Enter a duration such as 30m, 1h or 1h 30m.' }
  let minutes: number
  if (typeof input === 'number') {
    if (!Number.isInteger(input)) return invalid
    minutes = input
  } else {
    const text = input.toLowerCase().trim().replace(/\s+/g, ' ')
    const clock = /^(\d+):([0-5]\d)$/.exec(text)
    const units = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(text)
    if (/^\d+$/.test(text)) minutes = Number(text)
    else if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2])
    else if (text && units && (units[1] || units[2])) {
      const hours = Number(units[1] ?? 0) * 60
      if (Math.abs(hours - Math.round(hours)) > 1e-9) return { ok: false, error: 'Hours must convert to whole minutes (for example 1.5h, not 1.33h).' }
      minutes = Math.round(hours) + Number(units[2] ?? 0)
    } else return invalid
  }
  if (!Number.isFinite(minutes) || minutes < 1) return { ok: false, error: 'A duration must be at least 1 minute.' }
  if (minutes > maximum) {
    return { ok: false, error: maximum === MAX_ENTRY_MINUTES ? 'One entry can record at most 24 hours (one day\'s work).' : 'Enter a realistic duration.' }
  }
  return { ok: true, minutes }
}

/** Remaining estimate: empty = no estimate (null), "0" = nothing left. */
export function parseEstimate(input: string): { ok: true, minutes: number | null } | { ok: false, error: string } {
  const text = input.trim().toLowerCase()
  if (!text) return { ok: true, minutes: null }
  if (['0', '0m', '0h'].includes(text)) return { ok: true, minutes: 0 }
  return parseDuration(text, MAX_ESTIMATE_MINUTES)
}

/** 45 → "45m", 90 → "1h 30m", 120 → "2h", 0 → "0m". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return ''
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest}m`
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

/** 0:05:09 style clock for an elapsed number of seconds. */
export function formatClock(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
