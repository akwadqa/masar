import type { Feature, RoadmapColumn } from '~/types/api'

// Pure roadmap ordering helpers (ADR-038), shared by the board and its cache updates.

/** The Features directly above and below `name` in a column order, as sent to the move API. */
export function moveNeighbours(order: string[], name: string): { before?: string, after?: string } {
  const index = order.indexOf(name)
  if (index < 0) return {}
  return { before: index > 0 ? order[index - 1] : undefined, after: index < order.length - 1 ? order[index + 1] : undefined }
}

/** Column order after moving `name` one step up (-1) or down (+1); null at the edges. */
export function stepOrder(order: string[], name: string, delta: -1 | 1): string[] | null {
  const index = order.indexOf(name)
  const target = index + delta
  if (index < 0 || target < 0 || target >= order.length) return null
  const next = order.filter(n => n !== name)
  next.splice(target, 0, name)
  return next
}

/** Optimistic list: `name` takes `roadmap` and the target column follows `columnOrder`. */
export function placeFeature(items: Feature[], name: string, roadmap: RoadmapColumn, columnOrder: string[]): Feature[] {
  const moved = items.find(item => item.name === name)
  if (!moved) return items
  const byName = new Map(items.map(item => [item.name, item]))
  byName.set(name, { ...moved, roadmap })
  const column = columnOrder.map(n => byName.get(n)).filter((item): item is Feature => !!item && item.roadmap === roadmap)
  const rest = items.filter(item => item.name !== name && !columnOrder.includes(item.name))
  return [...rest, ...column]
}
