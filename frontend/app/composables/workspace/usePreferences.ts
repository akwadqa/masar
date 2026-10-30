import type { Appearance, DesignTheme, Preferences } from '~/types/api'

export const DESIGN_THEMES: Array<{ value: DesignTheme, label: string, description: string }> = [
  { value: 'ink', label: 'Ink & Signal', description: 'Blue accent, neutral surfaces' },
  { value: 'violet', label: 'Violet Workspace', description: 'Violet accent, soft surfaces' },
  { value: 'teal', label: 'Masar Teal', description: 'Deep teal, calm neutrals' }
]
export const APPEARANCES: Array<{ value: Appearance, label: string, icon: string }> = [
  { value: 'light', label: 'Light', icon: 'i-lucide-sun' },
  { value: 'dark', label: 'Dark', icon: 'i-lucide-moon' },
  { value: 'system', label: 'System', icon: 'i-lucide-monitor' }
]
// Defaults (client revision 3): Violet Workspace, Light, full-width pages; the server sends the same.
const DEFAULT_THEME: DesignTheme = 'violet'
const DEFAULT_APPEARANCE: Appearance = 'light'
// Read by the inline script in nuxt.config before the app starts, so the right theme paints first.
const LAST_THEME_KEY = 'masar:theme'
// One queue for every caller of usePreferences in this tab (the Workspace renders only in the browser).
let saveQueue: Promise<unknown> = Promise.resolve()
let lastSave = 0

/** Workspace preferences of the signed-in user: design theme, appearance, full width and pinned Spaces.
 *  The server copy (Frappe user defaults) is the source of truth; changes apply immediately. */
export function usePreferences() {
  const { user } = useSession()
  const api = useMasarApi()
  const colorMode = useColorMode()
  const preferences = useState<Preferences | null>('masar:preferences', () => null)

  const theme = computed<DesignTheme>(() => preferences.value?.theme ?? DEFAULT_THEME)
  const appearance = computed<Appearance>(() => preferences.value?.appearance ?? DEFAULT_APPEARANCE)
  const pinnedSpaces = computed(() => preferences.value?.pinnedSpaces ?? [])
  const fullWidth = computed(() => preferences.value?.fullWidth ?? true)
  const emailNotifications = computed(() => preferences.value?.emailNotifications ?? true)

  function apply(next: Preferences) {
    preferences.value = next
    applyTheme(next.theme)
    colorMode.preference = next.appearance
  }

  // Saves go to the server one at a time (QA-D05): sent together they could be committed out of order,
  // and an earlier answer arriving last would put back a value the person had already changed. The
  // answer of the latest save carries every earlier change, so only that one replaces the local copy.
  async function save(changes: Partial<{ theme: DesignTheme, appearance: Appearance, pinned_spaces: string[], full_width: boolean, email_notifications: boolean }>) {
    const request = saveQueue.then(() => api.post<Preferences>('masar.api.session.set_preferences', changes))
    saveQueue = request.catch(() => undefined)
    const ticket = ++lastSave
    const saved = await request
    if (ticket === lastSave) preferences.value = saved
  }

  function setTheme(value: DesignTheme) {
    apply({ ...current(), theme: value })
    void save({ theme: value }).catch(() => undefined)
  }

  function setAppearance(value: Appearance) {
    apply({ ...current(), appearance: value })
    void save({ appearance: value }).catch(() => undefined)
  }

  function toggleFullWidth() {
    const value = !fullWidth.value
    preferences.value = { ...current(), fullWidth: value }
    void save({ full_width: value }).catch(() => undefined)
  }

  function setEmailNotifications(value: boolean) {
    preferences.value = { ...current(), emailNotifications: value }
    return save({ email_notifications: value })
  }

  function togglePin(space: string) {
    const pins = pinnedSpaces.value.includes(space)
      ? pinnedSpaces.value.filter(name => name !== space)
      : [...pinnedSpaces.value, space]
    preferences.value = { ...current(), pinnedSpaces: pins }
    void save({ pinned_spaces: pins }).catch(() => undefined)
  }

  function current(): Preferences {
    return preferences.value ?? { theme: DEFAULT_THEME, appearance: DEFAULT_APPEARANCE, fullWidth: true, pinnedSpaces: [], emailNotifications: true }
  }

  function reset() {
    preferences.value = null
    applyTheme(DEFAULT_THEME)
    colorMode.preference = DEFAULT_APPEARANCE
  }

  return { theme, appearance, fullWidth, pinnedSpaces, emailNotifications, user, apply, setTheme, setAppearance, toggleFullWidth, togglePin, setEmailNotifications, reset }
}

function applyTheme(value: DesignTheme) {
  if (!import.meta.client) return
  document.documentElement.dataset.theme = value
  try { localStorage.setItem(LAST_THEME_KEY, value) } catch { /* storage unavailable */ }
}
