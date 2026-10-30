// Phase 7 performance measurement against a PRODUCTION build (never the dev server).
// Usage: node tests/perf/time-tracking.mjs <base-url> <password-file> [entries=500] [space-title='E2E Alpha']
// Seeds one Task with <entries> time entries from three people (plus corrections and voids), then measures
// logging, summary totals, Worklog paging, Task detail, parallel logging and the Task page with its Worklog.
// Local runs use development data only; on AWS run it with a small count inside a per-run E2E Space.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const [B, passwordFile, count = '500', spaceTitle = 'E2E Alpha'] = process.argv.slice(2)
const N = Number(count)
const pwd = readFileSync(passwordFile, 'utf8').trim()
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) }
const stats = a => ({ n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), max: Math.max(...a) })

async function session(email) {
  const login = await fetch(`${B}/api/method/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usr: email, pwd }) })
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const csrf = (await (await fetch(`${B}/api/v2/method/masar.api.session.boot`, { headers: { cookie } })).json()).data.csrfToken
  const call = async (method, body, params) => {
    const t = performance.now()
    const r = await fetch(`${B}/api/v2/method/${method}${params ? `?${new URLSearchParams(params)}` : ''}`, {
      method: body ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': csrf }, body: body ? JSON.stringify(body) : undefined
    })
    const json = await r.json().catch(() => null)
    return { status: r.status, ms: +(performance.now() - t).toFixed(0), data: json?.data }
  }
  return { call }
}

const manager = await session('qa.manager@masar-qa.invalid')
const member = await session('qa.member@masar-qa.invalid')
const space = (await manager.call('masar.api.spaces.list')).data.find(s => s.title === spaceTitle).name
const task = (await manager.call('masar.api.tasks.create', { space, title: `Perf worklog ${Date.now()}`, client_request_id: crypto.randomUUID() })).data.task.name
const people = [manager, member, manager]

// Seed: N entries over the last 60 days, every 10th with an estimate update.
const logMs = []
const entries = []
for (let i = 0; i < N; i++) {
  const day = new Date(Date.now() - (i % 60) * 86_400_000).toISOString().slice(0, 10)
  const body = { task, duration: 15 + (i % 8) * 15, work_date: day, description: `Entry ${i}`, client_request_id: crypto.randomUUID() }
  if (i % 10 === 0) Object.assign(body, { set_remaining: true, remaining: 600, base_remaining: i === 0 ? '' : 600 })
  const r = await people[i % 3].call('masar.api.time.log', body)
  if (r.status !== 200) throw new Error(`log ${i}: ${r.status}`)
  logMs.push(r.ms); entries.push({ name: r.data.entry.name, who: i % 3, minutes: body.duration })
}
// Corrections (author) and voids (author) on a sample.
const updateMs = []
for (let i = 0; i < Math.min(N, 50); i++) {
  const e = entries[i * 3 % N]
  const r = await people[e.who].call('masar.api.time.update', { entry: e.name, changes: { duration: e.minutes + 5 } })
  updateMs.push(r.ms); e.minutes += 5
}
const voidMs = []
for (let i = 0; i < Math.min(N, 20); i++) {
  const e = entries[(i * 7 + 1) % N]
  if (e.voided) continue
  voidMs.push((await people[e.who].call('masar.api.time.void', { entry: e.name, reason: 'perf' })).ms); e.voided = true
}

const out = { dataset: { entries: N, corrections: updateMs.length, voids: voidMs.length } }
out.log_api_ms = stats(logMs)
out.update_api_ms = stats(updateMs)
out.void_api_ms = stats(voidMs)
const summary = []; for (let i = 0; i < 10; i++) summary.push((await member.call('masar.api.time.summary', null, { task })).ms)
out.summary_api_ms = stats(summary)
const detail = []; for (let i = 0; i < 10; i++) detail.push((await member.call('masar.api.tasks.get', null, { task })).ms)
out.taskDetail_api_ms = stats(detail)
const first = []; for (let i = 0; i < 10; i++) first.push((await member.call('masar.api.comments.timeline', null, { task, view: 'worklog', limit: 30 })).ms)
out.worklogFirstPage_api_ms = stats(first)
let page = (await member.call('masar.api.comments.timeline', null, { task, view: 'worklog', limit: 30 })).data
const older = []; let pages = 1
while (page.earlierCursor && pages < 20) { const r = await member.call('masar.api.comments.timeline', null, { task, view: 'worklog', limit: 30, before: page.earlierCursor }); older.push(r.ms); page = r.data; pages++ }
if (older.length) out.worklogOlderPages_api_ms = { ...stats(older), pages }
const all = []; for (let i = 0; i < 5; i++) all.push((await member.call('masar.api.comments.timeline', null, { task, view: 'all', limit: 30 })).ms)
out.allViewFirstPage_api_ms = stats(all)

// Consistency: the stored total equals the sum of non-voided entries, before and after parallel logging.
const expected = entries.filter(e => !e.voided).reduce((s, e) => s + e.minutes, 0)
out.totalMatches = (await member.call('masar.api.tasks.get', null, { task })).data.loggedMinutes === expected
let t0 = performance.now()
const parallel = await Promise.all(Array.from({ length: 10 }, (_, i) => [manager, member][i % 2].call('masar.api.time.log', { task, duration: 10, client_request_id: crypto.randomUUID() })))
const key = crypto.randomUUID()
const sameKey = await Promise.all(Array.from({ length: 5 }, () => manager.call('masar.api.time.log', { task, duration: 10, client_request_id: key })))
out.concurrent = {
  ms: +(performance.now() - t0).toFixed(0),
  distinctStatuses: [...new Set(parallel.map(r => r.status))],
  sameKeyStatuses: [...new Set(sameKey.map(r => r.status))],
  sameKeyEntries: new Set(sameKey.map(r => r.data?.entry?.name)).size,
  totalAfter: (await member.call('masar.api.tasks.get', null, { task })).data.loggedMinutes,
  totalExpected: expected + 10 * 10 + 10
}

// UI: the Task page (production build) until the Time row shows, then the Worklog tab with entries.
const browser = await chromium.launch()
const ui = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await ui.goto(B + '/login'); await ui.getByLabel('Email').fill('qa.member@masar-qa.invalid'); await ui.getByLabel('Password').fill(pwd)
await ui.getByRole('button', { name: 'Sign in' }).click(); await ui.waitForURL(u => !u.pathname.startsWith('/login'))
t0 = Date.now(); await ui.goto(`${B}/tasks/${task}`); await ui.getByTestId('logged-total').waitFor(); await ui.locator('[data-time-entry]').last().waitFor(); out.taskPageWithTimeline_ms = Date.now() - t0
t0 = Date.now(); await ui.getByRole('tab', { name: 'Worklog' }).click(); await ui.locator('[data-time-entry]').nth(Math.min(N, 30) - 1).waitFor(); out.worklogTab_ms = Date.now() - t0
await browser.close()
out.task = task
console.log(JSON.stringify(out, null, 2))
