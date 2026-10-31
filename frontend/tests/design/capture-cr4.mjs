// Client revision 4 evidence: All Tasks filters on one row with coloured icons, the "Plan your Batch"
// area, a Space task list's filter icons, the Time section of the Task panel and the softer avatars,
// in light and dark. Signs in on Frappe's own login page. Read-only.
// Usage: node tests/design/capture-cr4.mjs <origin> <email> <password-file> <out> [width]
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const [ORIGIN, EMAIL, passwordFile, OUT, WIDTH = '1440'] = process.argv.slice(2)
const APP = `${ORIGIN}/masar`
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: Number(WIDTH), height: 900 }, colorScheme: scheme, timezoneId: 'Asia/Qatar' })
  const page = await context.newPage()
  await page.goto(`${APP}/tasks`)
  await page.waitForURL(url => url.pathname === '/login')
  await page.locator('#login_email').fill(EMAIL)
  await page.locator('#login_password').fill(readFileSync(passwordFile, 'utf8').trim())
  await page.locator('#login_password').press('Enter')
  await page.waitForURL(url => url.pathname.startsWith('/masar/tasks'))
  const api = method => page.evaluate(async m => (await fetch(`/api/v2/method/masar.api.${m}`).then(r => r.json())).data, method)
  // Appearance is shown by toggling the page's dark class: the account's own preference is not changed.
  const paint = () => page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), scheme === 'dark')
  const settle = async () => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(800); await paint(); await page.waitForTimeout(200) }

  await page.goto(`${APP}/tasks`); await settle()
  await page.screenshot({ path: `${OUT}/${scheme}-all-tasks-${WIDTH}.png`, clip: { x: 0, y: 0, width: Number(WIDTH), height: 360 } })
  await page.goto(`${APP}/tasks?group=batch`); await settle()
  await page.screenshot({ path: `${OUT}/${scheme}-group-by-batch-${WIDTH}.png`, clip: { x: 0, y: 0, width: Number(WIDTH), height: 620 } })

  const spaces = await api('spaces.list')
  const busy = [...spaces].filter(s => s.role).sort((a, b) => (b.openTaskCount ?? 0) - (a.openTaskCount ?? 0))[0]
  if (busy) {
    await page.goto(`${APP}/spaces/${busy.name}/tasks`); await settle()
    await page.screenshot({ path: `${OUT}/${scheme}-space-filters-${WIDTH}.png`, clip: { x: 0, y: 0, width: Number(WIDTH), height: 420 } })
    const task = (await api(`tasks.list?space=${busy.name}&limit=1`)).items[0]
    if (task) {
      await page.goto(`${APP}/spaces/${busy.name}/tasks?task=${task.name}`); await settle()
      await page.getByRole('region', { name: 'Time', exact: true }).scrollIntoViewIfNeeded()
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${OUT}/${scheme}-task-panel-${WIDTH}.png` })
    }
  }
  await context.close()
}
await browser.close()
