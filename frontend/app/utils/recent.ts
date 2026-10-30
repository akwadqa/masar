// Recently opened tasks (names only, per browser). Titles are never stored: the command palette
// re-authorises names through masar.api.tasks.lookup before showing anything.
const KEY = 'masar:recent-tasks'
const LIMIT = 10

export function pushRecent(list: readonly string[], name: string, limit = LIMIT): string[] {
  return [name, ...list.filter(item => item !== name)].slice(0, limit)
}

export function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, LIMIT) : []
  } catch {
    return []
  }
}

export function rememberRecent(name: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(pushRecent(readRecent(), name)))
  } catch { /* storage unavailable */ }
}

export function clearRecent() {
  try { localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
}
