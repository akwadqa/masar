import type { FieldConflict } from '~/types/api'

export type ApiErrorKind =
  | 'csrf'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'auth'
  | 'rate_limited'
  | 'network'
  | 'server'

/** Normalised error for both Frappe v1 ({exc_type, _server_messages}) and v2 ({errors}) envelopes. */
export class MasarApiError extends Error {
  readonly status: number
  readonly kind: ApiErrorKind
  readonly type: string | null
  readonly conflicts: FieldConflict[]

  constructor(options: { status: number, kind: ApiErrorKind, type: string | null, message: string, conflicts?: FieldConflict[] }) {
    super(options.message)
    this.name = 'MasarApiError'
    this.status = options.status
    this.kind = options.kind
    this.type = options.type
    this.conflicts = options.conflicts ?? []
  }
}

const DEFAULT_MESSAGES: Record<ApiErrorKind, string> = {
  csrf: 'Your session security token expired. Please try again.',
  forbidden: 'You do not have permission to do that.',
  not_found: 'This item does not exist or you do not have access to it.',
  conflict: 'Someone else changed this item. Review the latest values.',
  validation: 'The request could not be completed.',
  auth: 'Your session has ended. Please sign in again.',
  rate_limited: 'Too many requests. Please wait a moment.',
  network: 'Cannot reach Masar. Check your connection and try again.',
  server: 'Something went wrong on the server. Please try again.'
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const data = body as Record<string, unknown>
  if (Array.isArray(data.errors)) {
    for (const error of data.errors as Array<Record<string, unknown>>) {
      if (typeof error.message === 'string' && error.message) return stripHtml(error.message)
    }
  }
  if (typeof data._server_messages === 'string') {
    try {
      const messages = JSON.parse(data._server_messages) as string[]
      for (const raw of messages) {
        const parsed = JSON.parse(raw) as { message?: string }
        if (parsed.message) return stripHtml(parsed.message)
      }
    } catch {
      // Malformed server messages fall back to the default text.
    }
  }
  if (typeof data.message === 'string' && data.message) return stripHtml(data.message)
  return null
}

function extractType(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const data = body as Record<string, unknown>
  if (Array.isArray(data.errors) && data.errors.length) {
    const type = (data.errors[0] as Record<string, unknown>).type
    if (typeof type === 'string') return type
  }
  return typeof data.exc_type === 'string' ? data.exc_type : null
}

export function toApiError(status: number | undefined, body: unknown): MasarApiError {
  if (!status) {
    return new MasarApiError({ status: 0, kind: 'network', type: null, message: DEFAULT_MESSAGES.network })
  }
  const type = extractType(body)
  let kind: ApiErrorKind
  if (type === 'CSRFTokenError') kind = 'csrf'
  else if (status === 409 || type === 'MasarConflictError') kind = 'conflict'
  else if (status === 404 || type === 'DoesNotExistError') kind = 'not_found'
  else if (status === 401 || type === 'AuthenticationError' || type === 'SessionExpired') kind = 'auth'
  else if (status === 403) kind = 'forbidden'
  else if (status === 417 || status === 400) kind = 'validation'
  else if (status === 429) kind = 'rate_limited'
  else kind = 'server'

  const conflicts = body && typeof body === 'object' && Array.isArray((body as { conflicts?: unknown }).conflicts)
    ? (body as { conflicts: FieldConflict[] }).conflicts
    : []
  const message = kind === 'server' ? DEFAULT_MESSAGES.server : extractMessage(body) ?? DEFAULT_MESSAGES[kind]
  return new MasarApiError({ status, kind, type, message, conflicts })
}

export function errorMessage(error: unknown): string {
  if (error instanceof MasarApiError) return error.message
  return DEFAULT_MESSAGES.server
}
