// Before/after evidence for the client-guided redesign: the same demo personas, data, routes and
// viewports every time. Read-only. Usage: node tests/design/capture-demo.mjs <base> <credentials.json> <out> [filter]
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const [BASE, credentialsFile, OUT, FILTER] = process.argv.slice(2)
const credentials = JSON.parse(readFileSync(credentialsFile, 'utf8'))
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()

async function signIn(key, viewport, colorScheme = 'light') {
  const context = await browser.newContext({ viewport, colorScheme, timezoneId: 'Asia/Qatar' })
  const page = await context.newPage()
  const email = `${key}@masar-demo.invalid`
  await page.goto(`${BASE}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(credentials[email])
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  return page
}
const api = (page, method, params = {}) => page.evaluate(async ([m, p]) =>
  (await fetch(`/api/v2/method/masar.api.${m}?${new URLSearchParams(p)}`).then(r => r.json())).data, [method, params])
async function shot(page, name, path, wait) {
  if (FILTER && !name.includes(FILTER)) return
  await page.goto(`${BASE}${path}`)
  await page.waitForLoadState('networkidle')
  if (wait) await page.locator(wait).first().waitFor({ timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('captured', name)
}

const desktop = { width: 1440, height: 900 }
const omar = await signIn('omar', desktop)
const spaces = Object.fromEntries((await api(omar, 'spaces.list', { scope: 'all' })).map(s => [s.title, s.name]))
const pearl = spaces['Pearl Commerce Platform']
const tasks = (await api(omar, 'tasks.list', { space: pearl })).items
const rich = tasks.find(t => t.actionCount >= 3 && t.commentCount >= 1) ?? tasks[0]
const sprint = (await api(omar, 'batches.list', {})).items.find(b => b.batchName === 'Platform Delivery — Sprint 05')
await shot(omar, 'd-spaces', '/spaces?scope=all&status=all', 'a[aria-label]')
await shot(omar, 'd-task-list', `/spaces/${pearl}/tasks`, '[role="listitem"]')
await shot(omar, 'd-task-panel', `/spaces/${pearl}/tasks?task=${rich.name}`, '[data-testid="task-title"]')
await shot(omar, 'd-roadmap', `/spaces/${pearl}/roadmap`, 'text=Now')
await shot(omar, 'd-batch', `/batches/${sprint.name}`, 'text=Sprint 05')
const khalid = await signIn('khalid', desktop)
await shot(khalid, 'd-my-day', '/my-day', '[role="listitem"]')
await shot(omar, 'd-all-tasks', '/tasks', '[role="listitem"]')
const phone = await signIn('khalid', { width: 390, height: 844 })
await shot(phone, 'p-my-day', '/my-day', '[role="listitem"]')
const dark = await signIn('omar', desktop, 'dark')
await shot(dark, 'dark-task-list', `/spaces/${pearl}/tasks`, '[role="listitem"]')
await browser.close()
