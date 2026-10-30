// Task selection by record name (stable across filtering, sorting and virtual scrolling).

/** Toggle one task; with `range`, select every visible task between the anchor and this one. */
export function toggleSelection(
  selected: ReadonlySet<string>,
  visible: readonly string[],
  name: string,
  anchor: string | null,
  range: boolean
): { selected: Set<string>, anchor: string } {
  const next = new Set(selected)
  if (range && anchor && anchor !== name) {
    const from = visible.indexOf(anchor)
    const to = visible.indexOf(name)
    if (from >= 0 && to >= 0) {
      const [start, end] = from < to ? [from, to] : [to, from]
      for (const item of visible.slice(start, end + 1)) next.add(item)
      return { selected: next, anchor: name }
    }
  }
  if (next.has(name)) next.delete(name)
  else next.add(name)
  return { selected: next, anchor: name }
}

/** Keep only selected tasks that are still in the current result (after filtering or refresh). */
export function pruneSelection(selected: ReadonlySet<string>, visible: readonly string[]): Set<string> {
  const allowed = new Set(visible)
  return new Set([...selected].filter(name => allowed.has(name)))
}

export function selectAll(visible: readonly string[]): Set<string> {
  return new Set(visible)
}
