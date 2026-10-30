// Read-only walkthrough of the demonstration dataset (scenarios A-J in docs/demo/client-walkthrough.md).
// Signs in as the fictional personas, checks what each one can see and do, and captures screenshots of
// fictional data only. It performs no writes, so the demo fingerprint stays unchanged.
// Usage: node tests/demo/walkthrough.mjs <base-url> <credentials.json> <out-dir>
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const [BASE, credentialsFile, OUT] = process.argv.slice(2)
const credentials = JSON.parse(readFileSync(credentialsFile, 'utf8'))
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const results = []
const errors = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`)

async function signIn(key, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, timezoneId: 'Asia/Qatar' })
  const page = await context.newPage()
  page.on('console', m => { if (m.type() === 'error') errors.push(`${key}: ${m.text().slice(0, 140)}`) })
  page.on('response', r => { if (r.status() >= 500) errors.push(`${key}: ${r.status()} ${r.url()}`) })
  const email = `${key}@masar-demo.invalid`
  await page.goto(`${BASE}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(credentials[email])
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'))
  return page
}
const api = (page, method, params = {}) => page.evaluate(async ([m, p]) => {
  const r = await fetch(`/api/v2/method/masar.api.${m}?${new URLSearchParams(p)}`)
  return { status: r.status, data: r.ok ? (await r.json()).data : null }
}, [method, params])
async function shot(page, name, path, wait) {
  if (path) await page.goto(`${BASE}${path}`)
  await page.waitForLoadState('networkidle')
  if (wait) await page.locator(wait).first().waitFor({ timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/${name}.png` })
}

// A. Company administrator in the Workspace (Masar Admin: sees and creates Spaces; no Desk).
const omar = await signIn('omar')
const all = (await api(omar, 'spaces.list', { scope: 'all' })).data
check('A: Masar Admin sees all 8 Spaces', all.length === 8, `${all.length}`)
const boot = await omar.evaluate(async () => (await fetch('/api/v2/method/masar.api.session.boot').then(r => r.json())).data)
check('A: Masar Admin can create Spaces but has no Frappe Desk access', boot.canCreateSpaces === true && boot.hasDeskAccess === false)
const space = Object.fromEntries(all.map(s => [s.title, s.name]))
await shot(omar, 'a-spaces-admin', '/spaces?scope=all', 'a[aria-label*="Doha Customer Services Portal"]')

// B. Space Manager: planning surfaces of the Customer Portal.
const portal = space['Doha Customer Services Portal']
const portalTasks = (await api(omar, 'tasks.list', { space: portal, show: 'all' })).data
check('B: Manager lists the Portal Task List', portalTasks?.items?.length >= 30, `${portalTasks?.items?.length}`)
await shot(omar, 'b-portal-tasks', `/spaces/${portal}/tasks`, '[role="listitem"]')
await shot(omar, 'b-portal-roadmap', `/spaces/${portal}/roadmap`, 'text=Now')
await shot(omar, 'b-portal-releases', `/spaces/${portal}/releases`, 'text=v1.2')
const batches = (await api(omar, 'batches.list', {})).data.items
const sprint = batches.find(b => b.batchName === 'Platform Delivery — Sprint 05')
check('B: Manager owns the active cross-Space Batch', sprint?.status === 'Active' && sprint?.isOwner === true)
await shot(omar, 'b-sprint05-manager', `/batches/${sprint.name}`, 'text=Sprint 05')
const omarSprintTasks = (await api(omar, 'batches.tasks', { batch: sprint.name })).data.items

// C. Member: My Work, a Task with Actions, comments and Worklog.
const khalid = await signIn('khalid')
const work = (await api(khalid, 'tasks.my_work', { assigned_to_me: 1, completed: 'open' })).data
check('C: Member My Work lists their assigned open Tasks', work.items.length >= 5, `${work.items.length}`)
await shot(khalid, 'c-my-work-khalid', '/my-work', '[role="listitem"]')
const rich = work.items.find(t => t.actionCount >= 3 && t.commentCount >= 1) ?? work.items[0]
await shot(khalid, 'c-task-panel', `/my-work?task=${rich.name}`, '[data-testid="task-title"]')
check('C: Task details open for an assigned Task', (await khalid.getByTestId('task-title').count()) === 1, rich.title)

// D. Partial visibility in the cross-Space Batch.
const hessa = await signIn('hessa')
const hessaSprint = await api(hessa, 'batches.tasks', { batch: sprint.name })
const hessaSpaces = new Set((hessaSprint.data?.items ?? []).map(t => t.space))
const supplier = space['Supplier Onboarding System']
check('D: Hessa sees the Batch but only her Spaces\' Tasks', hessaSprint.status === 200 && !hessaSpaces.has(supplier) && hessaSprint.data.items.length < omarSprintTasks.length,
  `${hessaSprint.data?.items.length} of ${omarSprintTasks.length}`)
check('D: Hessa cannot open Supplier Onboarding', (await api(hessa, 'spaces.get', { space: supplier })).status === 404)
await shot(hessa, 'd-sprint05-partial', `/batches/${sprint.name}`, 'text=Sprint 05')
const lina = await signIn('lina')
const linaSpaces = (await api(lina, 'spaces.list', {})).data
check('D: Lina sees only IT Service Desk Improvement', linaSpaces.length === 1 && linaSpaces[0].title === 'IT Service Desk Improvement')
const portalTask = portalTasks.items[0].name
check('D: Lina cannot read a Portal Task', (await api(lina, 'tasks.get', { task: portalTask })).status === 404)

// E. Roadmap distribution and progress from real Tasks.
const features = (await api(omar, 'features.list', { space: portal })).data.items
const columns = new Set(features.map(f => f.roadmap))
check('E: Portal roadmap uses Now, Next, Later and Done', ['Now', 'Next', 'Later', 'Done'].every(c => columns.has(c)))
check('E: Feature progress comes from linked Tasks', features.some(f => f.progress.total > 0 && f.progress.completed > 0))

// F. Releases in all three states (Pearl Commerce has Planned, Released and Archived).
const pearl = space['Pearl Commerce Platform']
const pearlReleases = (await api(omar, 'releases.list', { space: pearl })).data.items
check('F: Planned, Released and Archived Releases exist', ['Planned', 'Released', 'Archived'].every(s => pearlReleases.some(r => r.status === s)))
await shot(omar, 'f-pearl-releases', `/spaces/${pearl}/releases`, 'text=v1.0')

// G. Collaboration and private files.
const withFiles = []
for (const t of portalTasks.items.slice(0, 40)) {
  const files = await api(omar, 'attachments.list', { task: t.name })
  if (files.data?.length) withFiles.push({ task: t, file: files.data[0] })
}
check('G: Portal Tasks have private attachments', withFiles.length >= 1, `${withFiles.length}`)
if (withFiles.length) {
  const url = withFiles[0].file.url
  const own = await omar.evaluate(async u => (await fetch(u)).status, url)
  const outsider = await lina.evaluate(async u => (await fetch(u)).status, url)
  check('G: a member downloads the private file; a non-member cannot', own === 200 && outsider !== 200, `${own} / ${outsider}`)
  await shot(omar, 'g-task-collaboration', `/tasks/${withFiles[0].task.name}`, '[data-testid="task-title"]')
}

// H. Worklog totals equal the sum of valid entries.
let exact = 0
let checked = 0
for (const t of portalTasks.items.slice(0, 25)) {
  const detail = (await api(omar, 'tasks.get', { task: t.name })).data
  if (!detail.loggedMinutes) continue
  const timeline = (await api(omar, 'comments.timeline', { task: t.name, view: 'worklog', limit: 100 })).data
  const sum = timeline.items.filter(i => i.kind === 'time' && !i.entry.isVoided).reduce((a, i) => a + i.entry.minutes, 0)
  checked += 1
  if (sum === detail.loggedMinutes) exact += 1
}
check('H: logged totals equal valid Worklog entries', checked > 0 && exact === checked, `${exact}/${checked} Tasks`)

// I. Different workloads.
const hessaWork = (await api(hessa, 'tasks.my_work', { assigned_to_me: 1, completed: 'open' })).data.items.length
check('I: workloads differ between people', work.items.length > hessaWork, `Khalid ${work.items.length}, Hessa ${hessaWork}`)

// J. Persistence across a reload.
await khalid.reload(); await khalid.waitForLoadState('networkidle')
const again = (await api(khalid, 'tasks.my_work', { assigned_to_me: 1, completed: 'open' })).data.items.length
check('J: data is unchanged after reload', again === work.items.length)

// Phone view for the Member.
const phone = await signIn('khalid', { width: 390, height: 844 })
await shot(phone, 'j-phone-my-work', '/my-work', '[role="listitem"]')

console.log(results.join('\n'))
console.log(errors.length ? `CONSOLE/SERVER ERRORS:\n${errors.join('\n')}` : 'No console errors or server errors.')
await browser.close()
if (results.some(r => r.startsWith('FAIL'))) process.exit(1)
