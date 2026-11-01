import type { AttachmentRef, ReactionKey, TaskAttachment, TaskComment, TimeEntry, TimelineItem, TimelinePage, TimelineView, TimeResult, UserRef } from '~/types/api'
import { MasarApiError, toApiError } from '~/utils/apiError'
import { mergeNewestPage } from '~/utils/timelineMerge'

const POLL_MS = 20_000
// The server's page maximum; the poll only needs the newest few items to find its overlap.
const PAGE_SIZE = 100
const POLL_SIZE = 30
// Safety stop for very long timelines (10,000 items).
const MAX_PAGES = 100

/**
 * A Task's whole timeline for one view, oldest first in server order (client revision 6, R3: nothing is
 * hidden behind "show earlier", superseding ADR-057's windowing). Pages are read until the start. While
 * visible it refreshes the newest page every 20 s and on focus (permission-checked HTTP, no websocket —
 * ADR-058) and merges it by position, so other people's comments appear in order (R2).
 */
export function useTimeline(task: MaybeRefOrGetter<string>, view: MaybeRefOrGetter<TimelineView>) {
  const api = useMasarApi()
  const items = ref<TimelineItem[]>([])
  const status = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
  const error = ref<MasarApiError | null>(null)
  // A load answer is used only if no newer load started; a refresh answer only if nothing changed the
  // list meanwhile (a load, or a comment or time entry added here), so it never hides a newer item.
  let generation = 0
  let version = 0

  async function fetchPage(params: Record<string, string | number | undefined>) {
    return api.get<TimelinePage>('masar.api.comments.timeline', { task: toValue(task), view: toValue(view), ...params })
  }

  async function load() {
    const current = ++generation
    version++
    status.value = 'pending'
    error.value = null
    try {
      let page = await fetchPage({ limit: PAGE_SIZE })
      let all = page.items
      for (let pages = 1; page.earlierCursor && pages < MAX_PAGES; pages++) {
        page = await fetchPage({ limit: PAGE_SIZE, before: page.earlierCursor })
        all = [...page.items, ...all]
      }
      if (current !== generation) return
      items.value = all
      status.value = 'success'
    } catch (caught) {
      if (current !== generation) return
      error.value = caught instanceof MasarApiError ? caught : toApiError(500, null)
      status.value = 'error'
    }
  }

  async function refreshNewest() {
    if (status.value !== 'success') return
    const seen = version
    try {
      const page = await fetchPage({ limit: POLL_SIZE })
      if (seen !== version) return
      const merged = mergeNewestPage(items.value, page.items, !!page.earlierCursor)
      if (merged) items.value = merged
      else void load()
    } catch { /* the next poll retries; errors on explicit actions are shown there */ }
  }

  function upsertComment(comment: TaskComment) {
    const id = `comment:${comment.name}`
    const item: TimelineItem = { kind: 'comment', id, at: comment.createdAt, comment }
    version++
    const index = items.value.findIndex(i => i.id === id)
    if (index >= 0) items.value.splice(index, 1, item)
    else if (toValue(view) !== 'history' && toValue(view) !== 'worklog') items.value = [...items.value, item]
  }

  function upsertEntry(entry: TimeEntry) {
    const id = `time:${entry.name}`
    const item: TimelineItem = { kind: 'time', id, at: entry.loggedAt, entry }
    version++
    const index = items.value.findIndex(i => i.id === id)
    if (index >= 0) items.value.splice(index, 1, item)
    else if (['all', 'worklog'].includes(toValue(view))) items.value = [...items.value, item]
  }

  watch(() => [toValue(task), toValue(view)], () => void load(), { immediate: true })

  if (import.meta.client) {
    let timer: ReturnType<typeof setInterval> | undefined
    const tick = () => { if (document.visibilityState === 'visible') void refreshNewest() }
    onMounted(() => {
      timer = setInterval(tick, POLL_MS)
      window.addEventListener('focus', tick)
    })
    onBeforeUnmount(() => {
      clearInterval(timer)
      window.removeEventListener('focus', tick)
    })
  }

  return { items, status, error, load, refreshNewest, upsertComment, upsertEntry }
}

export function useTaskAttachments(task: MaybeRefOrGetter<string>) {
  const api = useMasarApi()
  return useMasarQuery<TaskAttachment[]>(
    () => `attachments:${toValue(task)}`,
    signal => api.get('masar.api.attachments.list', { task: toValue(task) }, signal),
    { default: () => [] }
  )
}

export function fetchMentionCandidates(task: string, query: string) {
  return useMasarApi().get<UserRef[]>('masar.api.comments.mention_candidates', { task, query })
}

export function useCommentMutations() {
  const api = useMasarApi()
  const afterChange = (task: string) => void invalidateQueries(`attachments:${task}`, `task:${task}`, 'tasks:')

  const create = useMasarMutation(
    (vars: { task: string, content: string, clientRequestId: string, attachments: string[] }) =>
      api.post<{ comment: TaskComment, created: boolean }>('masar.api.comments.create', {
        task: vars.task, content: vars.content, client_request_id: vars.clientRequestId, attachments: vars.attachments
      }),
    { onSuccess: (_r, vars) => afterChange(vars.task), toastOnError: false }
  )

  const update = useMasarMutation(
    (vars: { comment: TaskComment, content: string }) =>
      api.post<TaskComment>('masar.api.comments.update', {
        comment: vars.comment.name, content: vars.content, base_modified: vars.comment.modified
      }),
    { toastOnError: false }
  )

  const remove = useMasarMutation(
    (vars: { comment: TaskComment }) => api.post<TaskComment>('masar.api.comments.delete', { comment: vars.comment.name }),
    { onSuccess: (_r, vars) => afterChange(vars.comment.task) }
  )

  const react = useMasarMutation(
    (vars: { comment: TaskComment, emoji: ReactionKey, active: boolean }) =>
      api.post<TaskComment>('masar.api.comments.react', { comment: vars.comment.name, emoji: vars.emoji, active: vars.active })
  )

  const removeAttachment = useMasarMutation(
    (vars: { task: string, attachment: string }) => api.post('masar.api.attachments.delete', { attachment: vars.attachment }),
    { invalidate: (_r, vars) => [`attachments:${vars.task}`, `task:${vars.task}`, 'tasks:'] }
  )

  return { create, update, remove, react, removeAttachment }
}

/** Multipart upload with progress (XHR: fetch has no upload progress). CSRF as for every Masar write. */
export async function uploadMultipart<T>(method: string, fields: Record<string, string>, file: File, onProgress?: (percent: number) => void) {
  const { user, loadBoot } = useSession()
  const session = user.value ?? (await loadBoot().then(() => user.value))
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) body.append(key, value)
  body.append('file', file, file.name)
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/v2/method/${method}`)
    xhr.withCredentials = true
    xhr.setRequestHeader('X-Frappe-CSRF-Token', session?.csrfToken ?? '')
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded * 100 / event.total)) }
    xhr.onload = () => {
      let data: unknown = null
      try { data = JSON.parse(xhr.responseText) } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve((data as { data: T }).data)
      else reject(toApiError(xhr.status, data))
    }
    xhr.onerror = () => reject(toApiError(undefined, null))
    xhr.send(body)
  })
}

export function uploadAttachment(task: string, file: File, purpose: 'Task' | 'Comment', onProgress?: (percent: number) => void) {
  return uploadMultipart<AttachmentRef>('masar.api.attachments.upload', { task, purpose }, file, onProgress)
}

// ----------------------------------------------------------------------------- time tracking

export function useTimeMutations() {
  const api = useMasarApi()
  const afterChange = (result: TimeResult) => {
    applyServerTask(result.task)
    void invalidateQueries('tasks:')
  }
  const log = useMasarMutation(
    (vars: { task: string, duration: number, workDate: string, description: string, clientRequestId: string, remaining?: { minutes: number | null, base: number | null } }) =>
      api.post<TimeResult>('masar.api.time.log', {
        task: vars.task,
        duration: vars.duration,
        client_request_id: vars.clientRequestId,
        work_date: vars.workDate,
        description: vars.description || undefined,
        set_remaining: !!vars.remaining,
        remaining: vars.remaining ? (vars.remaining.minutes ?? '') : undefined,
        // The estimate the user saw ("" = none): a different stored value is a conflict (nothing saved).
        base_remaining: vars.remaining ? (vars.remaining.base ?? '') : undefined
      }),
    { onSuccess: afterChange, toastOnError: false }
  )
  const update = useMasarMutation(
    (vars: { entry: TimeEntry, changes: { duration?: number, workDate?: string, description?: string } }) =>
      api.post<TimeResult>('masar.api.time.update', { entry: vars.entry.name, changes: vars.changes, base_modified: vars.entry.modified }),
    { onSuccess: afterChange, toastOnError: false }
  )
  const voidEntry = useMasarMutation(
    (vars: { entry: TimeEntry, reason?: string }) =>
      api.post<TimeResult>('masar.api.time.void', { entry: vars.entry.name, reason: vars.reason || undefined }),
    { onSuccess: afterChange, toastOnError: false }
  )
  return { log, update, voidEntry }
}
