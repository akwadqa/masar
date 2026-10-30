// Phase 6 performance measurement against a PRODUCTION build (never the dev server).
// Usage: node tests/perf/collaboration.mjs <base-url> <password-file>
// Seeds (local development data only) one Task with 400 comments from three authors, reactions and
// attachments, then measures timeline, pagination, writes, mentions, deep links, files and filters.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const [B, passwordFile] = process.argv.slice(2)
const pwd = readFileSync(passwordFile, 'utf8').trim()
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) }
const stats = a => ({ p50: pct(a, 0.5), p95: pct(a, 0.95), max: Math.max(...a) })
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

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
  const upload = async (task, i) => {
    const form = new FormData()
    form.append('task', task); form.append('purpose', 'Task')
    form.append('file', new Blob([PNG, Buffer.from(`perf-${Date.now()}-${i}`)], { type: 'image/png' }), `perf-${i}.png`)
    const t = performance.now()
    const r = await fetch(`${B}/api/v2/method/masar.api.attachments.upload`, { method: 'POST', headers: { cookie, 'X-Frappe-CSRF-Token': csrf }, body: form })
    return { status: r.status, ms: +(performance.now() - t).toFixed(0), data: (await r.json()).data }
  }
  return { cookie, call, upload }
}

const manager = await session('qa.manager@masar-qa.invalid')
const member = await session('qa.member@masar-qa.invalid')
const outsider = await session('qa.outsider@masar-qa.invalid')
const space = (await manager.call('masar.api.spaces.list')).data.find(s => s.title === 'E2E Alpha').name
const task = (await manager.call('masar.api.tasks.create', { space, title: `Perf discussion ${Date.now()}`, client_request_id: crypto.randomUUID() })).data.task.name
for (let i = 0; i < 20; i++) await manager.call('masar.api.tasks.update', { task, changes: { priority: ['High', 'Low'][i % 2] } })

// Seed: 400 comments (3 authors), reactions on every 4th, 10 attachments, 5 deletions.
const createMs = []
const names = []
for (let i = 0; i < 400; i++) {
  const author = [manager, member, manager][i % 3]
  const r = await author.call('masar.api.comments.create', { task, content: `<p>Comment ${i} with <strong>some</strong> text and a <a href="https://example.com">link</a>.</p>`, client_request_id: crypto.randomUUID() })
  createMs.push(r.ms); names.push(r.data.comment.name)
}
const reactMs = []
for (let i = 0; i < names.length; i += 4) {
  for (const who of [manager, member]) reactMs.push((await who.call('masar.api.comments.react', { comment: names[i], emoji: ['thumbs_up', 'heart', 'tada'][i % 3], active: true })).ms)
}
const uploadMs = []
const files = []
for (let i = 0; i < 10; i++) { const r = await manager.upload(task, i); uploadMs.push(r.ms); files.push(r.data) }
for (let i = 5; i < 30; i += 5) await manager.call('masar.api.comments.delete', { comment: names[i] })

const out = { dataset: { comments: 400, reactions: reactMs.length, attachments: 10, deleted: 5, historyEvents: 21 } }
out.commentCreate_api_ms = stats(createMs)
out.reaction_api_ms = stats(reactMs)
out.upload_api_ms = stats(uploadMs)
const first = []; for (let i = 0; i < 10; i++) first.push((await member.call('masar.api.comments.timeline', null, { task, limit: 30 })).ms)
out.timelineFirstPage_api_ms = stats(first)
let page = (await member.call('masar.api.comments.timeline', null, { task, limit: 30 })).data
const older = []; let pages = 1
while (page.earlierCursor && pages < 14) { const r = await member.call('masar.api.comments.timeline', null, { task, limit: 30, before: page.earlierCursor }); older.push(r.ms); page = r.data; pages++ }
out.timelineOlderPages_api_ms = { ...stats(older), pages }
const anchor = []; for (const i of [3, 100, 250, 399]) anchor.push((await member.call('masar.api.comments.timeline', null, { task, limit: 30, anchor: names[i] })).ms)
out.deepLinkAnchor_api_ms = stats(anchor)
const filters = {}
for (const view of ['comments', 'history', 'worklog']) { const ms = []; for (let i = 0; i < 5; i++) ms.push((await member.call('masar.api.comments.timeline', null, { task, view, limit: 30 })).ms); filters[view] = stats(ms) }
out.timelineFilters_api_ms = filters
const mention = []; for (const q of ['', 'E2E', 'Mem', 'Man', 'x']) mention.push((await member.call('masar.api.comments.mention_candidates', null, { task, query: q })).ms)
out.mentionSuggestions_api_ms = stats(mention)
const dl = []; for (const f of files) { const t = performance.now(); const r = await fetch(B + f.url, { headers: { cookie: member.cookie } }); await r.arrayBuffer(); dl.push(+(performance.now() - t).toFixed(0)) }
out.privateDownload_ms = stats(dl)
const denied = await fetch(B + files[0].url, { headers: { cookie: outsider.cookie } })
out.outsiderDownloadStatus = denied.status
// Concurrent activity: 10 parallel comments + 10 parallel reactions on one comment.
let t0 = performance.now()
const parallel = await Promise.all(Array.from({ length: 10 }, (_, i) => [manager, member][i % 2].call('masar.api.comments.create', { task, content: `<p>parallel ${i}</p>`, client_request_id: crypto.randomUUID() })))
const parallelReact = await Promise.all(Array.from({ length: 10 }, (_, i) => [manager, member][i % 2].call('masar.api.comments.react', { comment: names[1], emoji: 'eyes', active: true })))
out.concurrent = {
  ms: +(performance.now() - t0).toFixed(0),
  commentStatuses: [...new Set(parallel.map(r => r.status))],
  reactStatuses: [...new Set(parallelReact.map(r => r.status))],
  eyesCount: (await member.call('masar.api.comments.get', null, { comment: names[1] })).data.reactions.find(r => r.emoji === 'eyes')?.count
}

// UI: open the Task page (production build) and wait for the newest comment; then a deep link.
const browser = await chromium.launch()
const ui = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await ui.goto(B + '/login'); await ui.getByLabel('Email').fill('qa.member@masar-qa.invalid'); await ui.getByLabel('Password').fill(pwd)
await ui.getByRole('button', { name: 'Sign in' }).click(); await ui.waitForURL(u => !u.pathname.startsWith('/login'))
t0 = Date.now(); await ui.goto(`${B}/tasks/${task}`); await ui.locator('[data-comment]').last().waitFor(); out.taskPageWithTimeline_ms = Date.now() - t0
t0 = Date.now(); await ui.goto(`${B}/tasks/${task}?comment=${names[10]}`); await ui.locator(`[data-comment="${names[10]}"]`).waitFor(); out.deepLinkPage_ms = Date.now() - t0
await browser.close()
console.log(JSON.stringify(out, null, 2))
