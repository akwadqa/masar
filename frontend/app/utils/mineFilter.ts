// The Task Lists' "Assigned to me" and "Owned by me" toggles share one URL value, `mine`, which lists
// "assigned" and/or "owned". Both at once = Tasks I own AND am assigned to (client decision 2026-11-02).
// 'none' means no mine filter where a list defaults to "assigned".

export type MinePart = 'assigned' | 'owned'
const PARTS: MinePart[] = ['assigned', 'owned']

export function parseMine(raw: string | undefined, defaultAssigned = false) {
  const parts = (raw ?? (defaultAssigned ? 'assigned' : '')).split(',')
  return { assignedToMe: parts.includes('assigned'), ownedByMe: parts.includes('owned') }
}

/** The `mine` value after switching one toggle; null when neither is on. */
export function toggleMine(current: { assignedToMe: boolean, ownedByMe: boolean }, part: MinePart): string | null {
  const on = { assigned: current.assignedToMe, owned: current.ownedByMe }
  on[part] = !on[part]
  return PARTS.filter(p => on[p]).join(',') || null
}
