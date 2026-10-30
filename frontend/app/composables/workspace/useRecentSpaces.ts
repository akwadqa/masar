const MAX_RECENT = 5

/** Spaces this person opened recently, newest first. Kept per account in this browser and always
 *  intersected with the Spaces they belong to now, so revoked access disappears at once. */
export function useRecentSpaces() {
  const { user } = useSession()
  const visited = useState<string[]>('masar:recent-spaces', () => [])

  const storageKey = computed(() => (user.value ? `masar:recent-spaces:${user.value.user}` : null))
  // A Space opened by a direct link is recorded before the session is known; once it is, those
  // visits join that account's list. Signing out clears the list, so accounts never share it.
  watch(storageKey, (key) => {
    if (!key) {
      visited.value = []
      return
    }
    visited.value = [...new Set([...visited.value, ...readList(key)])].slice(0, MAX_RECENT * 2)
    writeList(key, visited.value)
  }, { immediate: true })

  const recentSpaces = computed(() => {
    const authorised = new Set((user.value?.spaces ?? []).map(space => space.name))
    return visited.value.filter(name => authorised.has(name)).slice(0, MAX_RECENT)
  })

  function recordVisit(space: string) {
    visited.value = [space, ...visited.value.filter(name => name !== space)].slice(0, MAX_RECENT * 2)
    if (storageKey.value) writeList(storageKey.value, visited.value)
  }

  return { recentSpaces, recordVisit }
}

function readList(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeList(key: string, value: string[]) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
}
