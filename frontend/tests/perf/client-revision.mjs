// Client revision performance against a PRODUCTION build (never the dev server).
// Usage: node tests/perf/client-revision.mjs <base-url> <password-file>
// Requires the "E2E Volume" Space (masar.utils.seed.seed_volume, 1,600 tasks) and the QA accounts.
// Creates five tasks in that Space per run.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const [B, passwordFile] = process.argv.slice(2)
const pwd = readFileSync(passwordFile, 'utf8').trim()
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) }
const out = {}

await page.goto(B + '/login'); await page.getByLabel('Email').fill('qa.manager@masar-qa.invalid'); await page.getByLabel('Password').fill(pwd)
await page.getByRole('button', { name: 'Sign in' }).click(); await page.waitForURL(u => !u.pathname.startsWith('/login'))
const space = await page.evaluate(async () => (await fetch('/api/v2/method/masar.api.spaces.list').then(r => r.json())).data.find(s => s.title === 'E2E Volume').name)
const list = page.getByRole('list', { name: 'Tasks' })
const composer = page.getByLabel('New task title')

// 1. 1,600-task list with the zebra grid, Status and Space columns
let t0 = Date.now(); await page.goto(`${B}/spaces/${space}/tasks?show=all`)
await list.getByRole('listitem', { name: /Volume task 0000/ }).waitFor()
out.spaceList1600_ms = Date.now() - t0
out.domRows = await list.locator('[role="listitem"]').count()

// 2. The composer stays in view at the bottom, also after scrolling to the end of the list
const inView = async () => { const box = await composer.boundingBox(); return !!box && box.y >= 0 && box.y + box.height <= 900 }
out.composerVisibleAtTop = await inView()
await page.evaluate(() => { const el = document.querySelector('[role="list"][aria-label="Tasks"]'); el.scrollTop = el.scrollHeight })
await page.waitForTimeout(300)
out.composerVisibleAtEnd = await inView()

// 3. Create five tasks from the bottom composer; each appears at the top and the list scrolls to it
const createTimes = []
for (let i = 0; i < 5; i++) {
  const title = `Perf composer ${Date.now()} ${i}`
  await composer.fill(title)
  t0 = Date.now(); await composer.press('Enter')
  await list.getByRole('listitem', { name: title }).waitFor()
  createTimes.push(Date.now() - t0)
}
out.composerCreate_ms = { p50: pct(createTimes, 0.5), p95: pct(createTimes, 0.95), max: Math.max(...createTimes) }
out.scrolledToNewTask = await page.evaluate(() => document.querySelector('[role="list"][aria-label="Tasks"]').scrollTop < 50)

// 4. Feature panel (F) open latency on the large list
await composer.blur()
t0 = Date.now(); await page.keyboard.press('f')
await page.getByRole('complementary', { name: 'Features filter' }).waitFor()
out.featurePanel_ms = Date.now() - t0

// 5. All Tasks across Spaces (includes the 1,600-task Space)
t0 = Date.now(); await page.goto(`${B}/tasks?show=all`)
await list.locator('[role="listitem"]').first().waitFor()
out.allTasks = { ms: Date.now() - t0, count: (await page.getByText(/^\d+ tasks$/).first().textContent()).trim() }

// 6. Theme switch: time until the new theme is applied
await page.getByRole('button', { name: 'Account menu' }).click()
await page.getByRole('menuitem', { name: 'Design theme' }).click()
t0 = Date.now(); await page.getByRole('menuitemcheckbox', { name: /^Violet Workspace/ }).click()
await page.waitForFunction(() => document.documentElement.dataset.theme === 'violet')
out.themeSwitch_ms = Date.now() - t0
await page.getByRole('menuitemcheckbox', { name: /^Ink & Signal/ }).click()

console.log(JSON.stringify(out, null, 1))
await browser.close()
