import type { AuthenticatedBoot, Boot } from '~/types/api'
import { setBusinessTimeZone } from '~/utils/format'

const BOOT_URL = '/api/v2/method/masar.api.session.boot'

/** Session state from masar.api.session.boot — the single source of truth for who is signed in. */
export function useSession() {
  const boot = useState<Boot | null>('masar:boot', () => null)
  const pending = useState<Promise<Boot> | null>('masar:boot-pending', () => null)

  async function loadBoot(force = false): Promise<Boot> {
    if (boot.value && !force) return boot.value
    if (pending.value && !force) return pending.value
    const request = $fetch<{ data: Boot }>(BOOT_URL, { baseURL: SITE_ROOT, credentials: 'same-origin', cache: 'no-store' })
      .then((response) => {
        boot.value = response.data
        if (response.data.authenticated) setBusinessTimeZone(response.data.timezone)
        return response.data
      })
      .finally(() => {
        pending.value = null
      })
    pending.value = request
    return request
  }

  const user = computed<AuthenticatedBoot | null>(() =>
    boot.value && boot.value.authenticated ? boot.value : null
  )

  function clear() {
    boot.value = null
  }

  return { boot, user, loadBoot, clear }
}
