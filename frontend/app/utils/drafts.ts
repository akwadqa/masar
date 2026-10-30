// Inline task drafts (ADR-011): typed text is never lost and each commit carries an idempotency key.

export type DraftStatus = 'saving' | 'failed'

export interface TaskDraft {
  id: string // client_request_id
  title: string
  status: DraftStatus
  error?: string
}

export interface DraftState {
  input: string
  drafts: TaskDraft[]
}

export const emptyDraftState = (): DraftState => ({ input: '', drafts: [] })

export function normaliseTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Start a commit for the current input. Returns null when there is nothing to create. */
export function commitInput(state: DraftState, newId: () => string): { state: DraftState, draft: TaskDraft } | null {
  const title = normaliseTitle(state.input)
  if (!title) return null
  const draft: TaskDraft = { id: newId(), title, status: 'saving' }
  return { state: { input: '', drafts: [...state.drafts, draft] }, draft }
}

export function markFailed(state: DraftState, id: string, error: string): DraftState {
  return { ...state, drafts: state.drafts.map(d => (d.id === id ? { ...d, status: 'failed', error } : d)) }
}

export function markSaving(state: DraftState, id: string): DraftState {
  return { ...state, drafts: state.drafts.map(d => (d.id === id ? { ...d, status: 'saving', error: undefined } : d)) }
}

export function removeDraft(state: DraftState, id: string): DraftState {
  return { ...state, drafts: state.drafts.filter(d => d.id !== id) }
}

/** After a reload we cannot know whether in-flight saves reached the server: retry them (idempotent). */
export function restoreDraftState(raw: string | null): DraftState {
  if (!raw) return emptyDraftState()
  try {
    const parsed = JSON.parse(raw) as Partial<DraftState>
    const drafts = Array.isArray(parsed.drafts)
      ? parsed.drafts
          .filter((d): d is TaskDraft => typeof d?.id === 'string' && typeof d?.title === 'string')
          .map(d => ({ ...d, status: 'failed' as const, error: d.error ?? 'Not saved yet' }))
      : []
    return { input: typeof parsed.input === 'string' ? parsed.input : '', drafts }
  } catch {
    return emptyDraftState()
  }
}
