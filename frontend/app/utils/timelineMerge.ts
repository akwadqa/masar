/**
 * Merge a fresh "newest page" into a fully loaded timeline (client revision 6, R2/R3).
 *
 * Both lists are oldest first, in the server's order (creation, source, name). The page is the tail of
 * the server's timeline, so everything from the page's first item onwards is replaced by the page: new
 * items land at the end in server order and changed items are refreshed. Earlier versions appended any
 * unknown page item at the end, which moved older items after newer ones and made a deep-linked comment
 * "disappear" to the bottom of the newest-first display.
 *
 * Returns null when the page does not overlap the known list (more new items than one page holds, or the
 * overlap item is gone): the caller then reloads the whole timeline.
 */
export function mergeNewestPage<T extends { id: string }>(known: T[], page: T[], pageHasEarlier: boolean): T[] | null {
  if (!pageHasEarlier) return [...page]
  const first = page[0]
  if (!first) return null
  const start = known.findIndex(item => item.id === first.id)
  if (start < 0) return null
  return [...known.slice(0, start), ...page]
}
