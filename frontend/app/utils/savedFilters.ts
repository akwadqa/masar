// Remembered Task List filters, per list, in this browser (client revision 6, 2026-11-01: filters are
// kept when leaving a list and coming back). localStorage can be unavailable (private windows, blocked
// site data), so every access is guarded: the list then simply starts with its default filters.

const PREFIX = 'masar:task-filters:'

export function readSavedFilters(key: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return null
  }
}

export function saveFilters(key: string, query: Record<string, string>) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(query))
  } catch { /* storage unavailable or full: filters are just not remembered */ }
}
