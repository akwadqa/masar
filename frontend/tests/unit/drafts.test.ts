import { describe, expect, it } from 'vitest'
import { commitInput, emptyDraftState, markFailed, markSaving, removeDraft, restoreDraftState } from '~/utils/drafts'

let counter = 0
const id = () => `draft-${++counter}`

describe('inline drafts', () => {
  it('never creates a draft from empty or whitespace input', () => {
    expect(commitInput({ input: '   \n ', drafts: [] }, id)).toBeNull()
  })

  it('normalises the title, clears the input and records one saving draft', () => {
    const result = commitInput({ input: '  Fix   login  timeout ', drafts: [] }, id)!
    expect(result.draft.title).toBe('Fix login timeout')
    expect(result.draft.status).toBe('saving')
    expect(result.state.input).toBe('')
    expect(result.state.drafts).toHaveLength(1)
  })

  it('assigns a fresh idempotency key per commit (rapid Enter creates distinct drafts)', () => {
    let state = { input: 'One', drafts: [] as ReturnType<typeof emptyDraftState>['drafts'] }
    const first = commitInput(state, id)!
    state = { ...first.state, input: 'Two' }
    const second = commitInput(state, id)!
    expect(first.draft.id).not.toBe(second.draft.id)
    expect(second.state.drafts.map(d => d.title)).toEqual(['One', 'Two'])
  })

  it('keeps the text of failed drafts and supports retry/discard', () => {
    const { state, draft } = commitInput({ input: 'Keep me', drafts: [] }, id)!
    const failed = markFailed(state, draft.id, 'Network down')
    expect(failed.drafts[0]).toMatchObject({ title: 'Keep me', status: 'failed', error: 'Network down' })
    expect(markSaving(failed, draft.id).drafts[0]!.status).toBe('saving')
    expect(removeDraft(failed, draft.id).drafts).toEqual([])
  })

  it('restores persisted drafts as failed so the user explicitly retries them', () => {
    const raw = JSON.stringify({ input: 'half typed', drafts: [{ id: 'a', title: 'Saved?', status: 'saving' }] })
    const restored = restoreDraftState(raw)
    expect(restored.input).toBe('half typed')
    expect(restored.drafts[0]).toMatchObject({ id: 'a', status: 'failed' })
    expect(restoreDraftState('{not json')).toEqual(emptyDraftState())
    expect(restoreDraftState(null)).toEqual(emptyDraftState())
  })
})
