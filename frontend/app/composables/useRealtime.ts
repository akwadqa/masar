import { io, type Socket } from 'socket.io-client'
import type { RealtimeEvents } from '~/types/api'

type Handler = (payload: unknown) => void

// One connection for the whole Workspace (ssr: false, so module state is per browser tab).
let socket: Socket | null = null
const handlers = new Map<string, Set<Handler>>()

/**
 * The Workspace's link to Frappe's realtime server (specs/realtime.md). Transport only: it knows no Masar
 * data. Features subscribe with `on`; payloads carry ids, and features refetch through the API.
 */
export function useRealtime() {
  const connected = useState<boolean>('masar:realtime-connected', () => false)

  function on<E extends keyof RealtimeEvents>(event: E, handler: (payload: RealtimeEvents[E]) => void) {
    const set = handlers.get(event) ?? new Set<Handler>()
    set.add(handler as Handler)
    handlers.set(event, set)
    const off = () => set.delete(handler as Handler)
    if (getCurrentScope()) onScopeDispose(off)
    return off
  }

  return { connected, on }
}

/**
 * Keeps the connection open while a Masar user is signed in; call once (default layout).
 * Frappe's socket server authenticates the session cookie and serves one namespace per site, named
 * after it. With realtime disabled on the site, or the server unreachable, polling keeps working.
 */
export function useRealtimeConnection() {
  const { user } = useSession()
  const { connected } = useRealtime()
  const target = computed(() => {
    const boot = user.value
    return boot?.isMasarUser && boot.realtime ? `${boot.user}|${boot.sitename}` : null
  })

  function disconnect() {
    socket?.disconnect()
    socket = null
    connected.value = false
  }

  watch(target, (value) => {
    disconnect()
    if (!value || !user.value) return
    socket = io(`${window.location.origin}/${user.value.sitename}`, { withCredentials: true, reconnectionDelayMax: 30_000 })
    socket.on('connect', () => { connected.value = true })
    socket.on('disconnect', () => { connected.value = false })
    socket.onAny((event: string, payload: unknown) => handlers.get(event)?.forEach(handler => handler(payload)))
  }, { immediate: true })

  onScopeDispose(disconnect)
}
