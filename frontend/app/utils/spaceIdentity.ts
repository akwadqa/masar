import type { SpaceIconColor } from '~/types/api'
import { SPACE_ICON_COLORS } from '~/types/api'

// Curated Space icons (must match backend space_service.SPACE_ICONS).
export const SPACE_ICONS = [
  'folder-kanban', 'globe', 'shopping-bag', 'store', 'landmark', 'smartphone', 'truck', 'headset',
  'briefcase', 'building-2', 'server', 'code', 'database', 'rocket', 'layout-dashboard', 'file-text',
  'users', 'shield-check', 'package', 'wrench', 'chart-column', 'graduation-cap', 'heart-pulse', 'plane'
] as const

interface SpaceIdentitySource {
  name: string
  icon?: string | null
  iconColor?: SpaceIconColor | null
}

/** The icon a Space shows: its chosen icon, or the default Space icon. */
export function spaceIconName(space: SpaceIdentitySource): string {
  if (space.icon && (SPACE_ICONS as readonly string[]).includes(space.icon)) return space.icon
  return 'folder-kanban'
}

/** The colour a Space shows: its chosen colour, or a stable one derived from its identifier. */
export function spaceIconColor(space: SpaceIdentitySource): SpaceIconColor {
  if (space.iconColor) return space.iconColor
  let hash = 0
  for (const character of space.name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return SPACE_ICON_COLORS[hash % SPACE_ICON_COLORS.length]!
}
