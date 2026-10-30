// Masar service worker (client revision 5): push notifications only. It caches nothing and does not
// handle fetches, so every request reaches the network exactly as without a worker.
// Served at /masar/sw.js by the Frappe app (backend/masar/pwa.py) so that it controls /masar/.
//
// Pushes carry no payload (backend/masar/services/push_service.py): on a push the worker reads the
// person's newest unread notifications with their own session and shows them.

const ICON = '/assets/masar/frontend/icons/icon-192.png'
const BADGE = '/assets/masar/frontend/icons/badge-96.png'
const WORKSPACE = '/masar'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

async function latest() {
  try {
    const response = await fetch('/api/v2/method/masar.api.notifications.latest', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    })
    if (response.ok) return (await response.json()).data ?? []
  } catch { /* offline or signed out: show the generic notice below */ }
  return []
}

async function showLatest() {
  const items = await latest()
  // Browsers (Safari in particular) require a visible notification for every push.
  if (!items.length) {
    return self.registration.showNotification('Masar', {
      body: 'You have new notifications.',
      icon: ICON,
      badge: BADGE,
      tag: 'masar',
      data: { link: '/my-day?notifications=1' }
    })
  }
  if (self.navigator.setAppBadge) self.navigator.setAppBadge(items.length).catch(() => {})
  await Promise.all(items.slice(0, 3).map(item => self.registration.showNotification(item.subject, {
    body: item.detail || '',
    icon: ICON,
    badge: BADGE,
    // The same notification shown twice (two pushes close together) replaces itself.
    tag: item.name,
    timestamp: Date.parse(item.at),
    data: { link: item.link, name: item.name }
  })))
}

self.addEventListener('push', event => event.waitUntil(showLatest()))

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const { link, name } = event.notification.data ?? {}
  const target = new URL(`${WORKSPACE}${link || '/my-day'}`, self.location.origin)
  // The Workspace marks the notification read when it opens with ?notification=<name>.
  if (name) target.searchParams.set('notification', name)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find(client => new URL(client.url).pathname.startsWith(WORKSPACE))
    if (open) {
      // The open Workspace navigates in place (plugins/pwa.client.ts), without reloading.
      open.postMessage({ type: 'masar:open', url: target.pathname + target.search })
      return open.focus()
    }
    return self.clients.openWindow(target.href)
  })())
})
