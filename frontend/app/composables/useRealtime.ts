import { io, type Socket } from 'socket.io-client'
import type { RealtimeEvents } from '~/types/api'

type Handler = (payload: unknown) => void

// One connection for the whole Workspace (ssr: false, so module state is per browser tab).
let socket: Socket | null = null
const handlers = new Map<string, Set<Handler>>()
// Document rooms in use, counted, so two components showing the same Task share one subscription.
const rooms = new Map<string, { doctype: string, name: string, count: number }>()
// Who has each document open, as Frappe's socket server reports it (`doc_viewers`).
const viewers = ref<Record<string, string[]>>({})

const roomKey = (doctype: string, name: string) => `${doctype}/${name}`

// Frappe's protocol (realtime/handlers.js): doc_subscribe joins the document room for its events,
// doc_open the "who is viewing" room. Both check read permission through Masar's has_permission hooks.
// Only on a live connection: socket.io would buffer them, and `connect` joins every room anyway.
function enter(doctype: string, name: string) {
  if (!socket?.connected) return
  socket.emit('doc_subscribe', doctype, name)
  socket.emit('doc_open', doctype, name)
}
function exit(doctype: string, name: string) {
  if (!socket?.connected) return
  socket.emit('doc_close', doctype, name)
  socket.emit('doc_unsubscribe', doctype, name)
}

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
 * Joins a document's rooms while `name` is set and the component lives: its live events (for a Task,
 * `masar_timeline`, typing and editing) arrive, and `viewers` lists the other people who have it open.
 */
export function useDocumentRoom(doctype: string, name: MaybeRefOrGetter<string | null | undefined>) {
  const { user } = useSession()
  let current: string | null = null

  function join(value: string) {
    const key = roomKey(doctype, value)
    const room = rooms.get(key)
    if (room) room.count++
    else {
      rooms.set(key, { doctype, name: value, count: 1 })
      enter(doctype, value)
    }
  }
  function leave(value: string) {
    const key = roomKey(doctype, value)
    const room = rooms.get(key)
    if (!room || --room.count > 0) return
    rooms.delete(key)
    exit(doctype, value)
    const { [key]: _gone, ...rest } = viewers.value
    viewers.value = rest
  }

  watch(() => toValue(name) || null, (value) => {
    if (current) leave(current)
    current = value
    if (value) join(value)
  }, { immediate: true })
  onScopeDispose(() => { if (current) leave(current) })

  const others = computed(() => {
    const value = toValue(name)
    const me = user.value?.user
    return value ? (viewers.value[roomKey(doctype, value)] ?? []).filter(viewer => viewer !== me) : []
  })
  return { viewers: others }
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
    viewers.value = {}
  }

  watch(target, (value) => {
    disconnect()
    if (!value || !user.value) return
    socket = io(`${window.location.origin}/${user.value.sitename}`, { withCredentials: true, reconnectionDelayMax: 30_000 })
    socket.on('connect', () => {
      connected.value = true
      // Rooms are per connection: join them again after every (re)connect.
      rooms.forEach(room => enter(room.doctype, room.name))
    })
    socket.on('disconnect', () => {
      connected.value = false
      viewers.value = {}
    })
    socket.on('doc_viewers', (payload: RealtimeEvents['doc_viewers']) => {
      const key = roomKey(payload.doctype, payload.docname)
      if (rooms.has(key)) viewers.value = { ...viewers.value, [key]: payload.users }
    })
    socket.onAny((event: string, payload: unknown) => handlers.get(event)?.forEach(handler => handler(payload)))
  }, { immediate: true })

  onScopeDispose(disconnect)
}
