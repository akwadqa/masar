import type { SpaceSummary, UserRef } from '~/types/api'

/** The distinct owners of the listed Spaces, A–Z by name: the choices of the Spaces owner filter
 *  (client request 2026-11-10). Built from the list itself, so every choice matches some Space. */
export function spaceOwners(spaces: readonly SpaceSummary[]): UserRef[] {
  const owners = new Map(spaces.map(space => [space.owner.name, space.owner]))
  return [...owners.values()].sort((a, b) => a.fullName.localeCompare(b.fullName))
}
