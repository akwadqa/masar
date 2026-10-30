import type { SpaceSummary } from '~/types/api'

/** Space identity (title, icon, colour) by name, from the session's own Space list: rows that only
 *  carry a Space identifier can still show its real name and chosen icon. */
export function useSpaceLookup() {
  const { user } = useSession()
  const byName = computed(() => new Map<string, SpaceSummary>((user.value?.spaces ?? []).map(space => [space.name, space])))
  return (name: string) => byName.value.get(name)
}
