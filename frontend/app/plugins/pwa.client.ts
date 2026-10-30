import { PWA_COLORS } from '../../pwa'

// The Workspace as an installed app (client revision 5):
// - registers the service worker (/masar/sw.js: push notifications only, no offline cache);
// - a tapped push notification opens its page here without a reload (message from the worker), and
//   `?notification=<name>` marks that notification read;
// - the status bar colour follows the chosen appearance, not only the device's.
export default defineNuxtPlugin(() => {
  const router = useRouter()
  const colorMode = useColorMode()
  const { user } = useSession()
  const notifications = useNotifications()

  if ('serviceWorker' in navigator) {
    const scope = router.resolve('/').href
    navigator.serviceWorker.register(`${scope}sw.js`, { scope }).catch(() => undefined)
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent<{ type?: string, url?: string }>) => {
      if (event.data?.type !== 'masar:open' || typeof event.data.url !== 'string') return
      const path = event.data.url.startsWith(scope) ? `/${event.data.url.slice(scope.length)}` : event.data.url
      void router.push(path)
    })
  }

  watch(() => [router.currentRoute.value.query.notification, user.value?.isMasarUser] as const, ([name, ready]) => {
    if (typeof name !== 'string' || !ready) return
    void notifications.markRead([name])
    const query = { ...router.currentRoute.value.query }
    delete query.notification
    void router.replace({ query })
  }, { immediate: true })

  watch(() => colorMode.value, (mode) => {
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = mode === 'dark' ? PWA_COLORS.barDark : PWA_COLORS.bar
    }
  }, { immediate: true })
})
