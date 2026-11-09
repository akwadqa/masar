/**
 * Short-lived "someone is doing something" signals from live events: typing a comment, editing a field
 * (specs/realtime.md, phase 5). Each lasts until a fixed time unless renewed, so a closed tab or a lost
 * "stopped" message can never leave a marker behind.
 */
export interface LiveSignal {
  user: string
  /** The field being edited; empty for typing. */
  field: string
  /** Epoch milliseconds after which the signal no longer counts. */
  until: number
}

/** Add, renew (active) or remove (not active) one person's signal for one field. */
export function updateSignals(signals: readonly LiveSignal[], user: string, field: string, active: boolean, until: number): LiveSignal[] {
  const others = signals.filter(signal => !(signal.user === user && signal.field === field))
  return active ? [...others, { user, field, until }] : others
}

/** The people whose signal for this field still counts at `now`, in arrival order, each once. */
export function activeUsers(signals: readonly LiveSignal[], now: number, field = ''): string[] {
  return [...new Set(signals.filter(signal => signal.field === field && signal.until > now).map(signal => signal.user))]
}

/** "Lina", "Lina and Omar", "Lina, Omar and 2 others" + the verb. */
export function describePeople(names: readonly string[], verb: string): string {
  if (!names.length) return ''
  if (names.length === 1) return `${names[0]} ${verb}`
  if (names.length === 2) return `${names[0]} and ${names[1]} ${verb}`
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length > 3 ? 's' : ''} ${verb}`
}
