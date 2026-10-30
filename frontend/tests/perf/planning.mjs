// Phase 4 performance measurement against a PRODUCTION build (never the dev server).
// Usage: node tests/perf/planning.mjs <base-url> <password-file>
// Requires the "E2E Volume" Space with seed_volume + seed_planning_volume (development only).
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const [B, passwordFile] = process.argv.slice(2)
const pwd = readFileSync(passwordFile, 'utf8').trim()
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) }
const stats = a => ({ p50: pct(a, 0.5), p95: pct(a, 0.95), max: Math.max(...a) })
const apiTimes = re => page.evaluate(src => performance.getEntriesByType('resource').filter(e => new RegExp(src).test(e.name)).map(e => +e.duration.toFixed(0)), re.source)
const clearTimings = () => page.evaluate(() => performance.clearResourceTimings())
const out = {}

await page.goto(B + '/login'); await page.getByLabel('Email').fill('qa.manager@masar-qa.invalid'); await page.getByLabel('Password').fill(pwd)
await page.getByRole('button', { name: 'Sign in' }).click(); await page.waitForURL(u => !u.pathname.startsWith('/login'))
const call = (method, params, body) => page.evaluate(async ({ method, params, body }) => {
  const headers = { 'Content-Type': 'application/json' }
  if (body) headers['X-Frappe-CSRF-Token'] = (await fetch('/api/v2/method/masar.api.session.boot').then(r => r.json())).data.csrfToken
  const t = performance.now()
  const r = await fetch(`/api/v2/method/${method}${params ? `?${new URLSearchParams(params)}` : ''}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, ms: +(performance.now() - t).toFixed(0), data: (await r.json()).data }
}, { method, params, body })
const space = (await call('masar.api.spaces.list')).data.find(s => s.title === 'E2E Volume').name
// Repeatable runs: put every Feature back in its seeded column ("Volume feature NNN" → NNN % 4).
const seeded = ['Now', 'Next', 'Later', 'Done']
for (const f of (await call('masar.api.features.list', { space })).data.items) {
  const column = seeded[Number(f.title.slice(-3)) % 4]
  if (f.roadmap !== column) await call('masar.api.features.move', null, { feature: f.name, roadmap: column })
}
const features = (await call('masar.api.features.list', { space })).data.items
const releases = (await call('masar.api.releases.list', { space })).data.items
out.dataset = {
  tasks: (await call('masar.api.tasks.list', { space, completed: 'all', limit: 1 })).status === 200 ? 'see seed_volume (1,600)' : '?',
  features: features.length,
  releases: releases.length,
  linkedToFeatures: features.reduce((n, f) => n + f.progress.total, 0),
  linkedToReleases: releases.reduce((n, r) => n + r.progress.total, 0)
}

// 1. Roadmap board (80 Features, progress aggregated server-side)
await clearTimings()
let t0 = Date.now(); await page.goto(`${B}/spaces/${space}/roadmap`)
await page.getByRole('listitem', { name: /^Volume feature 000,/ }).waitFor()
out.board_ms = Date.now() - t0
out.board_api_ms = await apiTimes(/masar\.api\.features\.list/)

// 2. Moves between columns through the card menu (UI until the server confirmed)
const moveTimes = []; const moveApi = []
const later = features.filter(f => f.roadmap === 'Later')
for (let i = 0; i < 6; i++) {
  const f = later[i]
  await clearTimings()
  const t = Date.now()
  await page.getByRole('button', { name: `Move ${f.title}` }).click()
  const response = page.waitForResponse(r => r.url().includes('masar.api.features.move'))
  await page.getByRole('menuitem', { name: 'Move to Next' }).click()
  await response; moveTimes.push(Date.now() - t)
  moveApi.push(...await apiTimes(/masar\.api\.features\.move/))
}
out.moveViaMenu_ms = stats(moveTimes); out.move_api_ms = stats(moveApi)

// 3. Feature detail panel (description + linked tasks)
const detailTimes = []
for (let i = 0; i < 5; i++) {
  const f = features.filter(x => x.roadmap === 'Now')[i]
  const t = Date.now()
  await page.getByRole('listitem', { name: new RegExp(`^${f.title},`) }).click()
  await page.getByRole('heading', { name: 'Tasks' }).waitFor()
  await page.getByRole('link', { name: /Volume task/ }).first().waitFor()
  detailTimes.push(Date.now() - t)
  await page.getByRole('button', { name: 'Close panel' }).click()
}
out.featureDetail_ms = stats(detailTimes)

// 4. Progress aggregation alone (API)
const agg = []; for (let i = 0; i < 10; i++) agg.push((await call('masar.api.features.list', { space })).ms)
out.featuresList_api_ms = stats(agg)
const relAgg = []; for (let i = 0; i < 10; i++) relAgg.push((await call('masar.api.releases.list', { space })).ms)
out.releasesList_api_ms = stats(relAgg)

// 5. Releases workspace and detail
t0 = Date.now(); await page.goto(`${B}/spaces/${space}/releases`)
await page.getByRole('button', { name: '2027.29', exact: true }).waitFor(); out.releasesPage_ms = Date.now() - t0
t0 = Date.now(); await page.getByRole('button', { name: '2027.29', exact: true }).click()
await page.getByRole('link', { name: /Volume task/ }).first().waitFor(); out.releaseDetail_ms = Date.now() - t0

// 6. Feature and Release filters on the Task List (server-side, combined with another filter)
const filterTimes = {}
for (const [key, value] of [['feature', features[0].name], ['release', releases[29].name], ['feature', 'none']]) {
  await clearTimings()
  const t = Date.now()
  await page.goto(`${B}/spaces/${space}/tasks?show=all&${key}=${value}&priority=High`)
  await page.getByRole('list', { name: 'Tasks' }).getByRole('listitem').first().waitFor()
  filterTimes[`${key}=${value === 'none' ? 'none' : 'name'}+priority`] = { ui: Date.now() - t, api: await apiTimes(/masar\.api\.tasks\.list/) }
}
out.taskFilters_ms = filterTimes

// 7. Bulk assignment: 50 tasks to a Planned Release (all-or-nothing, one request)
const fifty = (await call('masar.api.tasks.list', { space, completed: 'all', release: 'none', limit: 50 })).data.items.map(t => t.name)
const planned = releases.find(r => r.status === 'Planned').name
const bulk = await call('masar.api.tasks.bulk_update', null, { tasks: fifty, operation: 'set_release', value: planned })
out.bulkSetRelease50 = { status: bulk.status, ms: bulk.ms, changed: bulk.data?.changed.length }
const undo = await call('masar.api.tasks.bulk_update', null, { tasks: fifty, operation: 'set_release', value: null })
out.bulkClearRelease50 = { status: undo.status, ms: undo.ms }

// 8. "Add an existing task" search (tasks without a Feature, title search)
const searchTimes = []; for (const q of ['login', 'invoice', 'report', 'sync', 'search']) searchTimes.push((await call('masar.api.tasks.list', { space, completed: 'open', feature: 'none', q, limit: 20, sort: 'recently_updated' })).ms)
out.linkSearch_api_ms = stats(searchTimes)

// 9. Concurrent roadmap moves: 10 parallel moves into the same gap of one column
const now = (await call('masar.api.features.list', { space })).data.items.filter(f => f.roadmap === 'Now')
const [upper, lower] = now
const movers = (await call('masar.api.features.list', { space })).data.items.filter(f => f.roadmap === 'Later').slice(0, 10)
const concurrent = await page.evaluate(async ({ movers, upper, lower }) => {
  const token = (await fetch('/api/v2/method/masar.api.session.boot').then(r => r.json())).data.csrfToken
  const t = performance.now()
  const results = await Promise.all(movers.map(name => fetch('/api/v2/method/masar.api.features.move', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': token },
    body: JSON.stringify({ feature: name, roadmap: 'Now', before: upper, after: lower })
  }).then(r => r.status)))
  return { ms: +(performance.now() - t).toFixed(0), statuses: results }
}, { movers: movers.map(f => f.name), upper: upper.name, lower: lower.name })
const after = (await call('masar.api.features.list', { space })).data.items.filter(f => f.roadmap === 'Now')
out.concurrentMoves = {
  ...concurrent,
  duplicatePositions: after.length - new Set(after.map(f => f.sortOrder)).size,
  firstStillFirst: after[0]?.name === upper.name
}

console.log(JSON.stringify(out, null, 2))
await browser.close()
