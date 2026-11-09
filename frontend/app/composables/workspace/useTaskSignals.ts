import { useNow } from '@vueuse/core'
import type { EditMarkerField } from '~/types/api'
import { activeUsers, describePeople, updateSignals, type LiveSignal } from '~/utils/liveSignals'

const TYPING_SEND_MS = 3000
const TYPING_SHOWN_MS = 5000
const EDITING_HEARTBEAT_MS = 20_000
const EDITING_SHOWN_MS = 30_000

/** Signals other people send about one Task, kept until they expire (the Task room must be joined). */
function useIncomingSignals(task: MaybeRefOrGetter<string>, ttl: number) {
  const { user } = useSession()
  const signals = ref<LiveSignal[]>([])
  const now = useNow({ interval: 1000 })
  watch(() => toValue(task), () => { signals.value = [] })

  function receive(payload: { task: string, user: string }, field: string, active: boolean) {
    if (payload.task !== toValue(task) || payload.user === user.value?.user) return
    signals.value = updateSignals(signals.value, payload.user, field, active, Date.now() + ttl)
  }
  const usersFor = (field = '') => computed(() => activeUsers(signals.value, now.value.getTime(), field))
  const clear = () => { signals.value = [] }
  return { receive, usersFor, clear }
}

/** A sentence naming the people, resolved through usePeople. */
function useSentence(users: Ref<string[]>, one: string, many: string) {
  const people = usePeople(users)
  return computed(() => describePeople(people.value.map(person => person.fullName), people.value.length > 1 ? many : one))
}

/**
 * "Lina is typing…" under the comment composer (specs/realtime.md, phase 5). `typing()` is called on every
 * keystroke and sends at most every 3 s; the line disappears 5 s after the other person's last keystroke.
 */
export function useTypingSignal(task: MaybeRefOrGetter<string>) {
  const api = useMasarApi()
  const { on, connected } = useRealtime()
  const incoming = useIncomingSignals(task, TYPING_SHOWN_MS)
  on('masar_typing', payload => incoming.receive(payload, '', true))
  // A posted comment usually ends the typing; anyone still typing reappears within 3 s.
  on('masar_timeline', payload => { if (payload.task === toValue(task)) incoming.clear() })

  let lastSent = 0
  function typing() {
    if (!connected.value || Date.now() - lastSent < TYPING_SEND_MS) return
    lastSent = Date.now()
    void api.post('masar.api.comments.typing', { task: toValue(task) }).catch(() => undefined)
  }

  const sentence = useSentence(incoming.usersFor(), 'is typing…', 'are typing…')
  return { typing, sentence }
}

/**
 * "Ahmed is editing" on a Task field (specs/realtime.md, phase 5). A hint only: nothing is locked and
 * saving still checks for conflicts (ADR-018). `start` and `stop` follow the person's own editing; while a
 * field stays open a heartbeat renews it, and other people's markers expire after 30 s without one.
 */
export function useEditMarkers(task: MaybeRefOrGetter<string>) {
  const api = useMasarApi()
  const { on, connected } = useRealtime()
  const incoming = useIncomingSignals(task, EDITING_SHOWN_MS)
  on('masar_editing', payload => incoming.receive(payload, payload.field, payload.active))

  const beats = new Map<EditMarkerField, ReturnType<typeof setInterval>>()
  function send(field: EditMarkerField, active: boolean) {
    if (!connected.value) return
    void api.post('masar.api.tasks.editing', { task: toValue(task), field, active }).catch(() => undefined)
  }
  function start(field: EditMarkerField) {
    if (beats.has(field)) return
    send(field, true)
    beats.set(field, setInterval(() => send(field, true), EDITING_HEARTBEAT_MS))
  }
  function stop(field: EditMarkerField) {
    const beat = beats.get(field)
    if (!beat) return
    clearInterval(beat)
    beats.delete(field)
    send(field, false)
  }
  onScopeDispose(() => [...beats.keys()].forEach(stop))

  const marker = (field: EditMarkerField) => useSentence(incoming.usersFor(field), 'is editing', 'are editing')
  return { start, stop, marker }
}
