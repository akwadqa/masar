import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import type { MasarNotification, NotificationPage } from '~/types/api'

const POLL_MS = 60_000
export type PushState = 'unsupported' | 'blocked' | 'off' | 'on'

/** The bell (client revision 5): the signed-in person's notifications, newest first, with read state.
 *  One shared list for the whole Workspace. The unread count refreshes every minute and whenever the
 *  window comes back, so it stays current without a reload; an installed app also gets pushes. */
export function useNotifications() {
  const api = useMasarApi()
  const items = useState<MasarNotification[]>('masar:notifications', () => [])
  const unread = useState<number>('masar:notifications-unread', () => 0)
  const nextBefore = useState<string | null>('masar:notifications-next', () => null)
  const loaded = useState<boolean>('masar:notifications-loaded', () => false)
  const loading = ref(false)

  async function load(more = false) {
    loading.value = true
    try {
      const page = await api.get<NotificationPage>('masar.api.notifications.list', more && nextBefore.value ? { before: nextBefore.value } : {})
      items.value = more ? [...items.value, ...page.items] : page.items
      nextBefore.value = page.nextBefore
      unread.value = page.unread
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  async function refreshCount() {
    const result = await api.get<{ unread: number }>('masar.api.notifications.unread_count').catch(() => null)
    if (!result) return
    // Something new arrived: the open list should show it too.
    if (result.unread !== unread.value && loaded.value) void load().catch(() => undefined)
    unread.value = result.unread
    setAppBadge(result.unread)
  }

  async function markRead(names: string[], read = true) {
    const before = items.value
    items.value = items.value.map(item => (names.includes(item.name) ? { ...item, isRead: read } : item))
    try {
      const result = await api.post<{ unread: number }>('masar.api.notifications.mark_read', { names: JSON.stringify(names), read })
      unread.value = result.unread
      setAppBadge(result.unread)
    } catch {
      items.value = before
    }
  }

  async function markAllRead() {
    items.value = items.value.map(item => ({ ...item, isRead: true }))
    const result = await api.post<{ unread: number }>('masar.api.notifications.mark_read', { all_unread: true })
    unread.value = result.unread
    setAppBadge(result.unread)
  }

  return { items, unread, nextBefore, loaded, loading, load, refreshCount, markRead, markAllRead }
}

/** Keeps the unread count current while the Workspace is open; call once (default layout). */
export function useNotificationPolling() {
  const { refreshCount } = useNotifications()
  const visibility = useDocumentVisibility()
  const { user } = useSession()
  const active = computed(() => !!user.value?.isMasarUser)
  const { pause, resume } = useIntervalFn(() => { if (visibility.value === 'visible') void refreshCount() }, POLL_MS, { immediate: false })
  watch([active, visibility], ([isActive, state]) => {
    if (isActive && state === 'visible') {
      void refreshCount()
      resume()
    } else {
      pause()
    }
  }, { immediate: true })
}

function setAppBadge(count: number) {
  if (!import.meta.client) return
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>, clearAppBadge?: () => Promise<void> }
  if (count > 0) nav.setAppBadge?.(count).catch(() => undefined)
  else nav.clearAppBadge?.().catch(() => undefined)
}

// --------------------------------------------------------------------------- push

function base64UrlToBytes(value: string) {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0))
}

/** Push notifications on this device. iPhones allow them only for the app added to the home screen. */
export function usePushNotifications() {
  const api = useMasarApi()
  const state = useState<PushState>('masar:push-state', () => 'unsupported')
  const busy = ref(false)
  const scope = useRouter().resolve('/').href

  function supported() {
    return import.meta.client && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  }

  async function registration() {
    return navigator.serviceWorker.getRegistration(scope)
  }

  async function check() {
    if (!supported()) {
      state.value = 'unsupported'
      return
    }
    if (Notification.permission === 'denied') {
      state.value = 'blocked'
      return
    }
    const subscription = await (await registration())?.pushManager.getSubscription()
    state.value = subscription && Notification.permission === 'granted' ? 'on' : 'off'
  }

  async function enable() {
    busy.value = true
    try {
      if (await Notification.requestPermission() !== 'granted') {
        state.value = Notification.permission === 'denied' ? 'blocked' : 'off'
        return
      }
      const worker = await registration() ?? await navigator.serviceWorker.ready
      const { publicKey } = await api.get<{ publicKey: string }>('masar.api.notifications.push_key')
      const subscription = await worker.pushManager.getSubscription()
        ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) })
      await api.post('masar.api.notifications.subscribe_push', { endpoint: subscription.endpoint, user_agent: navigator.userAgent })
      state.value = 'on'
    } finally {
      busy.value = false
    }
  }

  async function disable() {
    busy.value = true
    try {
      const subscription = await (await registration())?.pushManager.getSubscription()
      if (subscription) {
        await api.post('masar.api.notifications.unsubscribe_push', { endpoint: subscription.endpoint }).catch(() => undefined)
        await subscription.unsubscribe()
      }
      state.value = 'off'
    } finally {
      busy.value = false
    }
  }

  return { state, busy, check, enable, disable }
}
