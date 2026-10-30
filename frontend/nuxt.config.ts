// Masar Workspace: statically generated SPA served from the same origin as Frappe (ADR-016). Since
// client revision 4 it is part of the Frappe app and runs beside the site's other apps: the page is
// /masar (backend/masar/www/masar.html) and its files are Frappe assets (/assets/masar/frontend/);
// scripts/install-into-app.mjs copies the build there. Sign-in is Frappe's own /login page.
import { PWA_COLORS, splashImages } from './pwa'

const FRAPPE_DEV_TARGET = process.env.MASAR_FRAPPE_URL ?? 'http://localhost:8000'
const frappePaths = ['/api', '/assets', '/files', '/private/files', '/socket.io', '/desk', '/app', '/apps', '/login', '/update-password', '/website_script.js']
const BASE_URL = '/masar/'
const ASSETS_URL = '/assets/masar/frontend/'
const production = process.env.NODE_ENV === 'production'
// Static files (public/) are Frappe assets in production and served by the dev server under /masar/.
const STATIC_URL = production ? ASSETS_URL : BASE_URL

export default defineNuxtConfig({
  compatibilityDate: '2026-10-27',
  ssr: false,
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  // Component names are unique across folders; folders only organise files.
  components: [{ path: '~/components', pathPrefix: false }],
  // Composables are grouped in sub-folders (fewer than 15 files per folder).
  imports: { dirs: ['composables/**'] },
  devtools: { enabled: false },
  app: {
    baseURL: BASE_URL,
    // Built files are served by Frappe as app assets; the dev server serves them itself.
    cdnURL: production ? ASSETS_URL : undefined,
    head: {
      title: 'Masar',
      htmlAttrs: { lang: 'en' },
      // Installed on a phone's home screen it behaves like an app (client revision 5): no pinch or
      // input-focus zoom; pages pad by the safe areas (home indicator, landscape notch).
      viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
      meta: [
        { name: 'robots', content: 'noindex, nofollow' },
        { name: 'application-name', content: 'Masar' },
        { name: 'apple-mobile-web-app-title', content: 'Masar' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        // iOS draws its own solid status bar and the app starts below it (2026-10-30). With
        // black-translucent the installed app was drawn under a frosted status bar, which also blurred the
        // header, and its full-height layers ended one status-bar height above the screen bottom.
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
        { name: 'format-detection', content: 'telephone=no, email=no, address=no' },
        { name: 'theme-color', media: '(prefers-color-scheme: light)', content: PWA_COLORS.bar },
        { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: PWA_COLORS.barDark }
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: `${STATIC_URL}favicon.svg` },
        { rel: 'manifest', href: `${STATIC_URL}manifest.json` },
        { rel: 'apple-touch-icon', href: `${STATIC_URL}icons/apple-touch-icon.png` },
        ...splashImages().map(image => ({ rel: 'apple-touch-startup-image' as const, media: image.media, href: `${STATIC_URL}${image.file}` }))
      ],
      // Paint the last-used design theme before the app starts (no flash); the signed-in account's
      // own preference is applied right after the session loads (plugins/preferences.client.ts).
      script: [{ innerHTML: "try{document.documentElement.dataset.theme=localStorage.getItem('masar:theme')||'violet'}catch(e){document.documentElement.dataset.theme='violet'}" }]
    }
  },
  // No icon server exists in a static deployment: bundle the icons the app uses.
  icon: {
    provider: 'none',
    clientBundle: {
      scan: true,
      sizeLimitKb: 512,
      // Space icons are chosen at runtime (utils/spaceIdentity.ts), so the scan cannot find them.
      // Filter panel options (composables/useFilterPanel.ts) and Task status icons (utils/taskStatus.ts)
      // are outside the scanned components.
      icons: [
        'lucide:circle', 'lucide:loader', 'lucide:eye', 'lucide:pencil-line', 'lucide:alarm-clock', 'lucide:circle-check', 'lucide:archive', 'lucide:ban',
        'lucide:calendar-check', 'lucide:circle-dashed', 'lucide:folder-kanban', 'lucide:globe', 'lucide:shopping-bag', 'lucide:store', 'lucide:landmark', 'lucide:smartphone', 'lucide:truck', 'lucide:headset', 'lucide:briefcase', 'lucide:building-2', 'lucide:server', 'lucide:code', 'lucide:database', 'lucide:rocket', 'lucide:layout-dashboard', 'lucide:file-text', 'lucide:users', 'lucide:shield-check', 'lucide:package', 'lucide:wrench', 'lucide:chart-column', 'lucide:graduation-cap', 'lucide:heart-pulse', 'lucide:plane']
    }
  },
  ui: {
    // Fonts are self-hosted from the build; no runtime requests to third-party font CDNs.
    fonts: true
  },
  // Theme fonts are reached through CSS variables, so they are declared explicitly to be bundled.
  fonts: {
    families: [
      { name: 'Rubik', provider: 'google', weights: [400, 500, 600, 700] },
      { name: 'JetBrains Mono', provider: 'google', weights: [500] }
    ]
  },
  // Light is the default appearance before the account's own choice loads (client revision 3).
  colorMode: { preference: 'light', fallback: 'light' },
  typescript: { strict: true },
  nitro: {
    devProxy: Object.fromEntries(
      frappePaths.map(path => [path, { target: `${FRAPPE_DEV_TARGET}${path}`, changeOrigin: false }])
    )
  }
})
