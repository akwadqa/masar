// Each person keeps one avatar colour everywhere (client revision 2), derived from their user id so
// it never changes between pages or sessions. The palette reuses the Space colour tokens, which are
// tuned for contrast in light and dark appearances.
const PALETTE = ['blue', 'violet', 'teal', 'green', 'amber', 'rose', 'sky', 'slate'] as const

export function userColor(user: string | null | undefined): string {
  let hash = 0
  for (const char of user ?? '') hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `var(--masar-space-${PALETTE[hash % PALETTE.length]})`
}

/** Inline style for an avatar: the person's colour, rendered as a soft tint with deep initials by the
 *  `masar-avatar` class (assets/css/main.css; tokens in themes.css). */
export function avatarStyle(user: string | null | undefined): Record<string, string> {
  return { '--avatar-base': userColor(user) }
}
