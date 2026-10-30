import { MasarApiError, toApiError } from '~/utils/apiError'
import { frappeLoginUrl } from '~/utils/redirect'

type Params = Record<string, string | number | boolean | null | undefined>

interface FetchErrorLike {
  response?: { status: number, _data?: unknown }
}

function methodUrl(method: string) {
  return `/api/v2/method/${method}`
}
// Frappe's API is at the site root; Nuxt's $fetch would otherwise prefix the Workspace base (/masar/).
export const SITE_ROOT = '/'

/** Transport for whitelisted masar.api.* methods (v2 envelope {data}). */
export function useMasarApi() {
  const { user, loadBoot } = useSession()

  async function handleError(error: unknown): Promise<MasarApiError> {
    const response = (error as FetchErrorLike).response
    const apiError = toApiError(response?.status, response?._data)
    // Frappe answers 403 for both "signed out" and "forbidden": confirm via boot (Phase 0, R-26).
    if (apiError.kind === 'forbidden' || apiError.kind === 'auth') {
      const boot = await loadBoot(true).catch(() => null)
      if (boot && !boot.authenticated) {
        await onSessionLost()
        return toApiError(401, { exc_type: 'SessionExpired' })
      }
    }
    return apiError
  }

  async function get<T>(method: string, params: Params = {}, signal?: AbortSignal): Promise<T> {
    try {
      const response = await $fetch<{ data: T }>(methodUrl(method), {
        method: 'GET',
        baseURL: SITE_ROOT,
        query: params,
        credentials: 'same-origin',
        signal
      })
      return response.data
    } catch (error) {
      throw await handleError(error)
    }
  }

  async function post<T>(method: string, body: Record<string, unknown> = {}, retry = true): Promise<T> {
    const session = user.value ?? (await loadBoot().then(() => user.value))
    try {
      const response = await $fetch<{ data: T }>(methodUrl(method), {
        method: 'POST',
        baseURL: SITE_ROOT,
        body,
        credentials: 'same-origin',
        headers: { 'X-Frappe-CSRF-Token': session?.csrfToken ?? '' }
      })
      return response.data
    } catch (error) {
      const apiError = await handleError(error)
      if (apiError.kind === 'csrf' && retry) {
        await loadBoot(true)
        return post<T>(method, body, false)
      }
      throw apiError
    }
  }

  return { get, post }
}

export async function onSessionLost() {
  const route = useRoute()
  const { clear } = useSession()
  clear()
  clearNuxtData()
  useToast().add({ title: 'Your session has ended', description: 'Please sign in again.', color: 'warning' })
  await navigateTo(frappeLoginUrl(useRouter().resolve(route.fullPath).href), { external: true })
}
