import { useIntervalFn } from '@vueuse/core'
import type { TimerSession, TimerStopResult } from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'

const MAX_TIMER_SECONDS = 24 * 60 * 60

/** The session user's active timer, shared by the sidebar indicator and Task details. The server owns
 *  the timestamps; the client only counts seconds since the last server reading. */
export function useTimer() {
  const api = useMasarApi()
  const toast = useToast()
  const session = useState<TimerSession | null>('masar:timer', () => null)
  const readAt = useState<number>('masar:timer-read-at', () => Date.now())
  const now = ref(Date.now())
  useIntervalFn(() => { now.value = Date.now() }, 1000)

  function accept(value: TimerSession | null) {
    session.value = value && (value.state === 'Running' || value.state === 'Paused') ? value : null
    readAt.value = Date.now()
  }

  const elapsedSeconds = computed(() => {
    if (!session.value) return 0
    const sinceRead = session.value.state === 'Running' ? Math.max(0, (now.value - readAt.value) / 1000) : 0
    return Math.floor(session.value.elapsedSeconds + sinceRead)
  })
  const overLimit = computed(() => elapsedSeconds.value > MAX_TIMER_SECONDS)

  async function load() {
    accept(await api.get<TimerSession | null>('masar.api.timer.active'))
  }

  async function call<T extends TimerSession>(method: string, body: Record<string, unknown>) {
    try {
      const result = await api.post<T>(method, body)
      accept(result)
      return result
    } catch (caught) {
      const apiError = caught as MasarApiError
      if (apiError.kind === 'conflict') await load()
      toast.add({ title: apiError.message, color: apiError.kind === 'conflict' ? 'warning' : 'error', icon: 'i-lucide-circle-alert' })
      throw apiError
    }
  }

  const start = (task: string) => call('masar.api.timer.start', { task })
  const pause = () => call('masar.api.timer.pause', { timer: session.value!.name })
  const resume = () => call('masar.api.timer.resume', { timer: session.value!.name })
  const discard = () => call('masar.api.timer.discard', { timer: session.value!.name })
  async function stop(options: { minutes?: number, description?: string } = {}) {
    const result = await call<TimerStopResult>('masar.api.timer.stop', { timer: session.value!.name, ...options })
    if (result.result) {
      applyServerTask(result.result.task)
      void invalidateQueries('tasks:')
    }
    return result
  }

  return { session, elapsedSeconds, overLimit, load, start, pause, resume, stop, discard }
}

