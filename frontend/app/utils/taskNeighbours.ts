/** The Task to open after the panel's Task leaves the list (completed, closed, cancelled or deleted):
 *  the one below it in the visible order, or the one above when it was last (client request 2026-11-02).
 *  `null` when it was the only row, or is not in the list at all (opened from a link). */
export function nextTaskAfter(order: readonly string[], current: string): string | null {
  const index = order.indexOf(current)
  if (index < 0) return null
  return order[index + 1] ?? order[index - 1] ?? null
}
