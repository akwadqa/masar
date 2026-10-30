import { describe, expect, it } from 'vitest'
import { toApiError } from '~/utils/apiError'

describe('API error normalisation', () => {
  it('reads v2 envelopes and conflicts', () => {
    const error = toApiError(409, {
      conflicts: [{ field: 'title', current: 'Theirs', yours: 'Mine' }],
      errors: [{ type: 'MasarConflictError', message: 'This task was changed by someone else.' }]
    })
    expect(error.kind).toBe('conflict')
    expect(error.conflicts[0]!.field).toBe('title')
    expect(error.message).toBe('This task was changed by someone else.')
  })

  it('maps Frappe exception types and statuses', () => {
    expect(toApiError(400, { errors: [{ type: 'CSRFTokenError' }] }).kind).toBe('csrf')
    expect(toApiError(404, { errors: [{ type: 'DoesNotExistError' }] }).kind).toBe('not_found')
    expect(toApiError(403, { exc_type: 'PermissionError' }).kind).toBe('forbidden')
    expect(toApiError(417, { errors: [{ type: 'ValidationError' }] }).kind).toBe('validation')
    expect(toApiError(undefined, null).kind).toBe('network')
  })

  it('reads v1 _server_messages and strips HTML', () => {
    const body = { exc_type: 'ValidationError', _server_messages: JSON.stringify([JSON.stringify({ message: '<b>Title</b> is required' })]) }
    expect(toApiError(417, body).message).toBe('Title is required')
  })

  it('never shows raw server text for 5xx errors', () => {
    expect(toApiError(500, { exception: 'Traceback (most recent call last)…' }).message).not.toContain('Traceback')
  })
})
