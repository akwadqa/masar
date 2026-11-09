import type { UserRef } from '~/types/api'

/**
 * Names and avatars for the people live events mention by id (viewers, typing, editing; specs/realtime.md).
 * Looked up once per person through `masar.api.spaces.people`, which names only people who share a Space
 * with the viewer; anyone else is shown as "Someone".
 */
export function usePeople(users: MaybeRefOrGetter<string[]>) {
  const api = useMasarApi()
  const known = useState<Record<string, UserRef | null>>('masar:people', () => ({}))

  watch(() => toValue(users).filter(user => !(user in known.value)), async (missing) => {
    if (!missing.length) return
    const found = await api.get<UserRef[]>('masar.api.spaces.people', { users: JSON.stringify(missing) }).catch(() => null)
    if (!found) return
    const byName = Object.fromEntries(found.map(person => [person.name, person]))
    known.value = { ...known.value, ...Object.fromEntries(missing.map(user => [user, byName[user] ?? null])) }
  }, { immediate: true })

  return computed<UserRef[]>(() => toValue(users).map(user =>
    known.value[user] ?? { name: user, fullName: 'Someone', image: null }
  ))
}
