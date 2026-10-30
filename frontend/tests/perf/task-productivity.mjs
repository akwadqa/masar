// Phase 3 performance measurement against a PRODUCTION build (never the dev server).
// Usage: node tests/perf/task-productivity.mjs <base-url> <password-file>
// Requires the "E2E Volume" Space (masar.utils.seed.seed_volume) and the e2e.member account.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const [B, passwordFile] = process.argv.slice(2)
const pwd = readFileSync(passwordFile, 'utf8').trim()
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) }
const apiTimes = re => page.evaluate(src => performance.getEntriesByType('resource').filter(e => new RegExp(src).test(e.name)).map(e => +e.duration.toFixed(0)), re.source)
const out = {}

await page.goto(B + '/login'); await page.getByLabel('Email').fill('qa.member@masar-qa.invalid'); await page.getByLabel('Password').fill(pwd)
await page.getByRole('button', { name: 'Sign in' }).click(); await page.waitForURL(u => !u.pathname.startsWith('/login'))
const space = await page.evaluate(async () => (await fetch('/api/v2/method/masar.api.spaces.list').then(r => r.json())).data.find(s => s.title === 'E2E Volume').name)
const list = page.getByRole('list', { name: 'Tasks' })

// 1. Space Task List with 1,600 tasks: rows render only after all keyset pages have arrived
let t0 = Date.now(); await page.goto(`${B}/spaces/${space}/tasks?show=all`)
await list.getByRole('listitem', { name: /Volume task 0000/ }).waitFor()
out.spaceList1600_ms = Date.now() - t0
out.spaceList_api_ms = await apiTimes(/masar\.api\.tasks\.list/)
out.domRows = await list.locator('[role="listitem"]').count()

// 2. Scroll through the whole list, recording frame intervals
out.scroll = await page.evaluate(async () => {
  const el = document.querySelector('[role="list"][aria-label="Tasks"]'); const frames = []; let last = performance.now()
  await new Promise(resolve => { const step = () => { const now = performance.now(); frames.push(now - last); last = now; el.scrollTop += 120; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) resolve(); else requestAnimationFrame(step) }; requestAnimationFrame(step) })
  frames.shift(); const s = [...frames].sort((a, b) => a - b)
  return { frames: frames.length, p50: +s[Math.floor(s.length * 0.5)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), max: +s[s.length - 1].toFixed(1) }
})
await page.evaluate(() => { document.querySelector('[role="list"][aria-label="Tasks"]').scrollTop = 0 }); await page.waitForTimeout(300)

// 3. Expand Actions on 10 tasks (click until the first Action row is rendered)
const expandTimes = []
for (let i = 0; i < 10; i++) {
  const b = list.getByRole('button', { name: /^Show actions of/ }).first()
  const name = (await b.getAttribute('aria-label')).replace('Show actions of ', '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const t = Date.now(); await b.click(); await list.getByRole('listitem', { name: new RegExp(`^Action of ${name}`) }).first().waitFor(); expandTimes.push(Date.now() - t)
}
out.expandActions_ms = { p50: pct(expandTimes, 0.5), p95: pct(expandTimes, 0.95), max: Math.max(...expandTimes) }

// 4. Label filter (server-side)
t0 = Date.now(); await page.getByRole('combobox', { name: 'Filter by label' }).click(); await page.getByRole('option', { name: 'Bug', exact: true }).click()
await page.waitForURL(/label=/); await list.getByRole('listitem').first().waitFor(); await page.waitForTimeout(50)
out.labelFilter_ms = Date.now() - t0

// 5. Select all 1,600 visible tasks
await page.goto(`${B}/spaces/${space}/tasks?show=all`); await list.getByRole('listitem', { name: /Volume task 0000/ }).waitFor()
await list.getByRole('checkbox').first().click()
t0 = Date.now(); await page.getByRole('button', { name: /^Select all/ }).click()
await page.getByRole('toolbar', { name: 'Bulk actions for selected tasks' }).getByText(/^1[6-9]\d\d selected/).waitFor(); out.selectAll1600_ms = Date.now() - t0
await page.getByRole('button', { name: 'Clear', exact: true }).click()

// 6. Bulk priority on 50 tasks through the UI (Shift-range selection across scrolled rows)
await page.goto(`${B}/spaces/${space}/tasks?q=${encodeURIComponent('Volume task 00')}&sort=manual&show=all`)
await list.getByRole('listitem', { name: /Volume task 0000/ }).waitFor()
await list.getByRole('checkbox', { name: /^Select Volume task 0000/ }).click()
await list.evaluate(el => { el.scrollTop = 1600 }); await page.waitForTimeout(200)
await list.getByRole('checkbox', { name: /^Select Volume task 0049/ }).click({ modifiers: ['Shift'] })
const toolbar = await page.getByRole('toolbar', { name: 'Bulk actions for selected tasks' }).textContent()
t0 = Date.now(); await page.getByRole('button', { name: 'Priority' }).click(); await page.getByRole('menuitem', { name: 'Highest' }).click()
await page.getByText('Priority set to Highest', { exact: true }).waitFor()
out.bulkPriority = { selection: toolbar.match(/\d+ selected/)?.[0], ms: Date.now() - t0, api_ms: await apiTimes(/bulk_update/) }

// 7. All Tasks across Spaces (My Work was removed in client revision 2)
t0 = Date.now(); await page.goto(`${B}/tasks?show=all`)
const count = page.getByText(/^\d+ tasks$/); await count.waitFor()
out.allTasks = { ms: Date.now() - t0, tasks: (await count.textContent()).trim(), api_ms: await apiTimes(/my_work/) }

// 8. Sidebar task search (inline results, no dialog)
t0 = Date.now(); await page.getByRole('combobox', { name: 'Find tasks and Spaces' }).fill('invoice')
await page.getByRole('option', { name: /invoice/ }).first().waitFor()
out.sidebarSearch = { ms: Date.now() - t0, api_ms: await apiTimes(/tasks\.search/) }

console.log(JSON.stringify(out, null, 1))
await browser.close()
