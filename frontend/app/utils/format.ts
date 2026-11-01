// Business time policy (ADR-026a / docs/03 §5): every timestamp is displayed in the business
// timezone delivered by boot (Asia/Qatar), never in the browser's timezone. Date-only values
// (due dates, completion dates) are calendar dates and are never shifted.

let businessTimeZone = 'Asia/Qatar'

export function setBusinessTimeZone(timeZone: string | null | undefined) {
  if (timeZone) businessTimeZone = timeZone
}

export function getBusinessTimeZone() {
  return businessTimeZone
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day))
}

/** Today's calendar date (YYYY-MM-DD) in the business timezone. */
export function businessToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: businessTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Format a date-only value without timezone shifts ("Nov 1", or "Jan 5, 2027" outside this year). */
export function formatDueDate(value: string | null, today = businessToday()): string {
  if (!value) return ''
  const sameYear = value.slice(0, 4) === today.slice(0, 4)
  return new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  }).format(parseDateOnly(value))
}

export function formatLongDate(value: string | null): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', dateStyle: 'medium' }).format(parseDateOnly(value))
}

export function isOverdue(value: string | null, today = businessToday()): boolean {
  return !!value && value < today
}

/** Format an ISO timestamp (with offset) in business time, 12-hour, e.g. "Oct 28, 2026, 2:05 AM" (client revision 6, R5). */
export function formatDateTime(value: string | null): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('en', { timeZone: businessTimeZone, dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h12' }).format(new Date(value))
}

/** Plain text ⇄ the sanitised HTML stored by the server (rich text arrives in Phase 6). */
export function textToHtml(text: string): string | null {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  return paragraphs.length ? paragraphs.map(p => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('') : null
}

export function htmlToText(html: string | null): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n'), 'text/html')
  return (doc.body.textContent ?? '').trim()
}

/** Clock time of a timestamp in the business timezone, 12-hour ("2:05 PM"; client revision 6, R5, 2026-11-01). */
export function formatTime(value: string | null): string {
  if (!value) return ''
  return new Intl.DateTimeFormat('en', { timeZone: businessTimeZone, hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).format(new Date(value))
}

/** Day heading of a timestamp for activity groups: "Today", "Yesterday" or "Mon, 26 Oct 2026". */
export function formatDayHeading(value: string, now = new Date()): string {
  const day = businessToday(new Date(value))
  const today = businessToday(now)
  if (day === today) return 'Today'
  if (day === businessToday(new Date(now.getTime() - 86_400_000))) return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(parseDateOnly(day))
}

/**
 * Relative age of a timestamp, worded like Frappe's comments: "just now", "5 minutes ago", "3 hours ago",
 * "yesterday", "4 days ago", then the calendar date. Days are counted in business time, not in 24-hour steps.
 */
export function formatRelative(value: string, now = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(value).getTime()) / 1000)
  const ago = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'} ago`
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return ago(Math.floor(seconds / 60), 'minute')
  if (seconds < 86_400) return ago(Math.floor(seconds / 3600), 'hour')
  const day = businessToday(new Date(value))
  const days = Math.round((parseDateOnly(businessToday(now)).getTime() - parseDateOnly(day).getTime()) / 86_400_000)
  if (days <= 1) return 'yesterday'
  if (days < 7) return ago(days, 'day')
  return formatDueDate(day, businessToday(now))
}

/** Short age of a timestamp for notification lists: "now", "5m", "3h", "2d", then the date ("26 Oct"). */
export function formatAge(value: string, now = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`
  return new Intl.DateTimeFormat('en-GB', { timeZone: businessTimeZone, day: 'numeric', month: 'short' }).format(new Date(value))
}
