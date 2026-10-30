// Six theme combinations (Ink & Signal, Violet Workspace, Masar Teal × Light, Dark) on the same demo
// screens. Read-only: the boot response is patched in the browser, so no stored preference changes.
// Usage: node tests/design/capture-themes.mjs <base> <credentials.json> <out> [filter]
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const [BASE, credentialsFile, OUT, FILTER] = process.argv.slice(2)
const credentials = JSON.parse(readFileSync(credentialsFile, 'utf8'))
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const THEMES = ['ink', 'violet', 'teal']
const APPEARANCES = ['light', 'dark']

async function signIn(key, theme, appearance, viewport) {
  const context = await browser.newContext({ viewport, colorScheme: appearance, timezoneId: 'Asia/Qatar' })
  await context.route('**/api/v2/method/masar.api.session.boot*', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    if (body.data?.preferences) body.data.preferences = { ...body.data.preferences, theme, appearance }
    await route.fulfill({ response, json: body })
  })
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
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('captured', name)
}

for (const theme of THEMES) {
  for (const appearance of APPEARANCES) {
    const prefix = `${theme}-${appearance}`
    const page = await signIn('omar', theme, appearance, { width: 1440, height: 900 })
    const spaces = Object.fromEntries((await api(page, 'spaces.list', { scope: 'all' })).map(s => [s.title, s.name]))
    const pearl = spaces['Pearl Commerce Platform']
    const tasks = (await api(page, 'tasks.list', { space: pearl })).items
    const rich = tasks.find(t => t.actionCount >= 3 && t.commentCount >= 1) ?? tasks[0]
    await shot(page, `${prefix}-task-list`, `/spaces/${pearl}/tasks`, '[role="listitem"]')
    await shot(page, `${prefix}-task-detail`, `/spaces/${pearl}/tasks?task=${rich.name}`, '[data-testid="task-title"]')
    await shot(page, `${prefix}-roadmap`, `/spaces/${pearl}/roadmap`, 'text=Now')
    await shot(page, `${prefix}-all-tasks`, '/tasks', '[role="listitem"]')
    await page.context().close()
    const phone = await signIn('khalid', theme, appearance, { width: 390, height: 844 })
    await shot(phone, `${prefix}-phone-my-day`, '/my-day', '[role="listitem"]')
    await phone.context().close()
  }
}
await browser.close()
