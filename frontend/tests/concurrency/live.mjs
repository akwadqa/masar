// Live concurrency evidence for the Phase 5 retry audit (ADR-041, ADR-042) over real HTTP.
// Usage: node tests/concurrency/live.mjs <base-url> <password-file> [--lock-wait]
// Uses the E2E Volume Space (development only). --lock-wait expects another session to hold a row lock
// on the task printed by the script for longer than innodb_lock_wait_timeout (see phase-5.md).
import { readFileSync } from 'node:fs'

const [B, passwordFile, flag] = process.argv.slice(2)
const pwd = readFileSync(passwordFile, 'utf8').trim()

async function session(email) {
  const login = await fetch(`${B}/api/method/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usr: email, pwd }) })
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const boot = await (await fetch(`${B}/api/v2/method/masar.api.session.boot`, { headers: { cookie } })).json()
  const call = async (method, body, params) => {
    const r = await fetch(`${B}/api/v2/method/${method}${params ? `?${new URLSearchParams(params)}` : ''}`, {
      method: body ? 'POST' : 'GET',
      headers: { cookie, 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': boot.data.csrfToken },
      body: body ? JSON.stringify(body) : undefined
    })
    const json = await r.json().catch(() => null)
    return { status: r.status, data: json?.data, error: json?.errors?.[0]?.type }
  }
  return call
}
const tally = results => results.reduce((acc, r) => { const k = `${r.status}${r.error ? ` ${r.error}` : ''}`; acc[k] = (acc[k] ?? 0) + 1; return acc }, {})
const uid = () => crypto.randomUUID()
const out = {}
const m = await session('qa.manager@masar-qa.invalid')
const space = (await m('masar.api.spaces.list')).data.find(s => s.title === 'E2E Volume').name
const newTask = async title => (await m('masar.api.tasks.create', { space, title, client_request_id: uid() })).data.task

if (flag === '--lock-wait') {
  const task = process.argv[5]
  const t = Date.now()
  const r = await m('masar.api.tasks.update', { task, changes: { priority: 'High' } })
  console.log(JSON.stringify({ lockWait: { status: r.status, error: r.error, seconds: Math.round((Date.now() - t) / 1000) } }))
  process.exit(0)
}

// 1. Ten simultaneous edits of one Task, each based on the value it read (optimistic concurrency).
const t1 = await newTask(`concurrency edit ${uid().slice(0, 6)}`)
const edits = await Promise.all(['Low', 'High', 'Highest', 'Lowest', 'Low', 'High', 'Highest', 'Lowest', 'Low', 'High']
  .map(p => m('masar.api.tasks.update', { task: t1.name, changes: { priority: p }, base: { priority: 'Medium' } })))
out.sameTaskEdits = { results: tally(edits), finalPriority: (await m('masar.api.tasks.get', null, { task: t1.name })).data.priority }

// 2. Conflicting roadmap moves of one Feature into different columns from the same stale view.
const f = (await m('masar.api.features.create', { space, title: `concurrency feature ${uid().slice(0, 6)}`, roadmap: 'Later' })).data
const moves = await Promise.all(['Now', 'Next', 'Done', 'Now', 'Next'].map(roadmap => m('masar.api.features.move', { feature: f.name, roadmap, expected_roadmap: 'Later' })))
out.featureMoves = { results: tally(moves), final: (await m('masar.api.features.get', null, { feature: f.name })).data.roadmap }

// 3. One Task assigned to two different Batches at the same time (×5 pairs).
const b1 = (await m('masar.api.batches.create', { batch_name: `conc A ${uid().slice(0, 4)}`, start_date: '2026-11-02', preset: 'one_week' })).data.batch.name
const b2 = (await m('masar.api.batches.create', { batch_name: `conc B ${uid().slice(0, 4)}`, start_date: '2026-11-02', preset: 'one_week' })).data.batch.name
const assign = []
const assigned = []
for (let i = 0; i < 5; i++) {
  const t = await newTask(`concurrency assign ${i} ${uid().slice(0, 4)}`)
  assigned.push(t.name)
  assign.push(...await Promise.all([b1, b2].map(batch => m('masar.api.batches.move_tasks', { tasks: [t.name], batch }))))
}
const currents = await Promise.all(assigned.map(async name => (await m('masar.api.tasks.get', null, { task: name })).data.batch?.name ?? null))
out.concurrentAssignment = { results: tally(assign), everyTaskInExactlyOneBatch: currents.every(Boolean) }

// 4. Five simultaneous finish requests (two distinct request ids) for one Active Batch.
await m('masar.api.batches.start', { batch: b1, request_id: uid() })
const keyA = uid(); const keyB = uid()
const finishKeys = [keyA, keyA, keyB, keyA, keyB]
const finishes = await Promise.all(finishKeys.map(request_id => m('masar.api.batches.finish', { batch: b1, carry: 'Unbatched', request_id })))
const history = (await m('masar.api.batches.history', null, { batch: b1 })).data
out.concurrentFinish = {
  // Whichever request id wins: its repeats all return 200 with the same result; the other id gets 409.
  byKey: { A: tally(finishes.filter((_, i) => finishKeys[i] === keyA)), B: tally(finishes.filter((_, i) => finishKeys[i] === keyB)) },
  distinctOutcomes: [...new Set(finishes.filter(r => r.status === 200).map(r => JSON.stringify([r.data.completed, r.data.carriedOver, r.data.returned])))],
  participationRows: history.length
}
out.lockWaitProbeTask = t1.name
console.log(JSON.stringify(out, null, 2))
