// Generates the installable Workspace's images from the Masar brand kit (client revision 5):
//   public/icons/   manifest and home-screen icons, and the monochrome notification badge
//   public/splash/  iOS launch screens (light and dark) for every device in pwa.ts
// Usage (from frontend/): node scripts/generate-pwa-assets.mjs [path to masar-brand-kit]
// The results are committed; run again only when the brand kit or the device list changes.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { PWA_COLORS, splashImages } from '../pwa.ts'

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..')
const KIT = process.argv[2] ?? join(FRONTEND, '..', 'client_file', 'masar-brand-kit')
const PUBLIC = join(FRONTEND, 'public')

rmSync(join(PUBLIC, 'icons'), { recursive: true, force: true })
rmSync(join(PUBLIC, 'splash'), { recursive: true, force: true })
mkdirSync(join(PUBLIC, 'icons'), { recursive: true })
mkdirSync(join(PUBLIC, 'splash'), { recursive: true })

copyFileSync(join(KIT, 'pwa', 'icon-192.png'), join(PUBLIC, 'icons', 'icon-192.png'))
copyFileSync(join(KIT, 'pwa', 'icon-512.png'), join(PUBLIC, 'icons', 'icon-512.png'))
copyFileSync(join(KIT, 'pwa', 'maskable-512.png'), join(PUBLIC, 'icons', 'maskable-512.png'))
copyFileSync(join(KIT, 'web', 'apple-touch-icon.png'), join(PUBLIC, 'icons', 'apple-touch-icon.png'))
// Android draws the badge from the alpha channel only: the white symbol on transparency.
execFileSync('sips', ['-Z', '96', join(KIT, 'symbol', 'png', 'masar-symbol-white.png'), '--out', join(PUBLIC, 'icons', 'badge-96.png')], { stdio: 'ignore' })

const logo = dark => `data:image/svg+xml;base64,${readFileSync(join(KIT, 'logo', dark ? 'masar-logo-on-dark.svg' : 'masar-logo.svg')).toString('base64')}`
const browser = await chromium.launch()
try {
  for (const image of splashImages()) {
    const context = await browser.newContext({ viewport: { width: image.width, height: image.height }, deviceScaleFactor: image.ratio })
    const page = await context.newPage()
    await page.setContent(`<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:${image.dark ? PWA_COLORS.backgroundDark : PWA_COLORS.background}">
      <img src="${logo(image.dark)}" style="width:min(52vw,240px)" alt=""></body></html>`)
    await page.screenshot({ path: join(PUBLIC, image.file) })
    await context.close()
  }
} finally {
  await browser.close()
}
console.log(`Generated ${splashImages().length} launch screens and 5 icons.`)
