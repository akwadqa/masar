// Phase 5 performance measurement against a PRODUCTION build (never the dev server).
// Usage: node tests/perf/batches.mjs <base-url> <password-file>
// Requires seed_volume + seed_batch_volume (development only). Creates and finishes one extra Batch
// per run (planned from unbatched tasks), so it can be repeated.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const [B, passwordFile] = process.argv.slice(2)
const pwd = readFileSync(passwordFile, 'utf8').trim()
const browser = await chromium.launch()
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) }
const stats = a => ({ p50: pct(a, 0.5), p95: pct(a, 0.95), max: Math.max(...a) })
const out = {}

async function session(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await page.goto(B + '/login'); await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(pwd)
  await page.getByRole('button', { name: 'Sign in' }).click(); await page.waitForURL(u => !u.pathname.startsWith('/login'))
  const call = (method, params, body) => page.evaluate(async ({ method, params, body }) => {
    const headers = { 'Content-Type': 'application/json' }
    if (body) headers['X-Frappe-CSRF-Token'] = (await fetch('/api/v2/method/masar.api.session.boot').then(r => r.json())).data.csrfToken
    const t = performance.now()
    const r = await fetch(`/api/v2/method/${method}${params ? `?${new URLSearchParams(params)}` : ''}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined })
    const json = await r.json()
    return { status: r.status, ms: +(performance.now() - t).toFixed(0), data: json.data }
  }, { method, params, body })
  return { page, call }
}
const timed = async (call, n, ...args) => { const ms = []; let last; for (let i = 0; i < n; i++) { last = await call(...args); ms.push(last.ms) } return { ...stats(ms), last } }

const { page, call } = await session('qa.manager@masar-qa.invalid')
const all = (await call('masar.api.batches.list')).data.items
const active = all.filter(b => b.status === 'Active' && b.batchName.startsWith('Volume active'))[0]
const finished = all.filter(b => b.status === 'Finished' && b.batchName.startsWith('Volume history'))[0]
const volume = (await call('masar.api.spaces.list')).data.find(s => s.title === 'E2E Volume').name
out.dataset = { batchesVisible: all.length, activeTasks: active.progress.total, finishedParticipation: finished.progress.total }

// 1. Batch list (viewer-scoped progress aggregated server-side)
const list = await timed(call, 10, 'masar.api.batches.list')
out.batchList_api_ms = { p50: list.p50, p95: list.p95 }
let t0 = Date.now(); await page.goto(`${B}/batches`); await page.getByRole('link', { name: active.batchName }).waitFor(); out.batchListPage_ms = Date.now() - t0

// 2. Batch detail with 150 cross-Space tasks
const detail = await timed(call, 10, 'masar.api.batches.get', { batch: active.name })
out.batchDetail_api_ms = { p50: detail.p50, p95: detail.p95 }
const tasks = await timed(call, 5, 'masar.api.batches.tasks', { batch: active.name, completed: 'all', limit: 500 })
out.batchTasks_api_ms = { p50: tasks.p50, p95: tasks.p95, rows: tasks.last.data.items.length }
t0 = Date.now(); await page.goto(`${B}/batches/${active.name}`); await page.getByRole('list', { name: 'Tasks' }).getByRole('listitem').first().waitFor(); out.batchPage_ms = Date.now() - t0

// 3. Finished history (frozen results)
const history = await timed(call, 5, 'masar.api.batches.history', { batch: finished.name })
out.history_api_ms = { p50: history.p50, p95: history.p95, rows: history.last.data.length }

// 4. Grouped Task List (1,600 tasks, grouped by Batch)
t0 = Date.now(); await page.goto(`${B}/spaces/${volume}/tasks?show=all&group=batch`)
await page.getByRole('list', { name: 'Tasks' }).getByRole('listitem', { name: /^Batch / }).first().waitFor(); out.groupedList1600_ms = Date.now() - t0
const filtered = await timed(call, 5, 'masar.api.tasks.list', { space: volume, completed: 'all', batch: active.name, priority: 'High', limit: 500 })
out.batchFilter_api_ms = { p50: filtered.p50, p95: filtered.p95 }
const unbatched = await timed(call, 5, 'masar.api.tasks.list', { space: volume, completed: 'open', batch: 'none', q: 'login', limit: 20 })
out.plannerSearch_api_ms = { p50: unbatched.p50, p95: unbatched.p95 }

// 5. Bulk assignment of 100 tasks (two Spaces) into a new Batch, start, finish with carry-over
const fresh = (await call('masar.api.batches.create', null, { batch_name: `Perf ${Date.now()}`, start_date: '2026-11-16', preset: 'one_week', client_request_id: crypto.randomUUID() })).data.batch.name
const dest = (await call('masar.api.batches.create', null, { batch_name: `Perf dest ${Date.now()}`, start_date: '2026-11-23', preset: 'one_week', client_request_id: crypto.randomUUID() })).data.batch.name
const spaces = (await call('masar.api.spaces.list')).data.filter(s => s.title.startsWith('E2E Volume')).map(s => s.name)
const candidates = []
for (const space of spaces) candidates.push(...(await call('masar.api.tasks.list', { space, completed: 'open', batch: 'none', limit: 50 })).data.items.map(t => t.name))
const bulk = await call('masar.api.tasks.bulk_update', null, { tasks: candidates.slice(0, 100), operation: 'set_batch', value: fresh })
out.bulkAssign100 = { status: bulk.status, ms: bulk.ms, changed: bulk.data?.changed.length, spaces: spaces.length }
const start = await call('masar.api.batches.start', null, { batch: fresh, request_id: crypto.randomUUID() })
out.start = { status: start.status, ms: start.ms }
const finish = await call('masar.api.batches.finish', null, { batch: fresh, carry: 'Batch', destination: dest, request_id: crypto.randomUUID() })
out.finish100WithCarryOver = { status: finish.status, ms: finish.ms, carriedOver: finish.data?.carriedOver }
const back = await call('masar.api.batches.move_tasks', null, { tasks: candidates.slice(0, 100), batch: null })
out.returnToUnbatched100 = { status: back.status, ms: back.ms }

// 6. Partial viewer (member of Volume B only): same Batch, scoped counts
const partial = await session('qa.outsider@masar-qa.invalid')
const scoped = await timed(partial.call, 10, 'masar.api.batches.get', { batch: active.name })
out.partialViewer = { p50: scoped.p50, p95: scoped.p95, total: scoped.last.data.progress.total, ownerTotal: active.progress.total }

console.log(JSON.stringify(out, null, 2))
await browser.close()
