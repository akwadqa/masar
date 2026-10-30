import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import type { SpaceSummary, TaskDetail, TimelinePage, TimeResult } from '../../app/types/api'
import { ALPHA, USERS, pageApi, signIn, uniqueTitle } from './helpers'

// Phase 7 acceptance (docs/phases/phase-7.md §2): manual time entry, estimates, corrections, Worklog.
test.describe.configure({ mode: 'serial' })

let alpha = ''
let task = ''
const run = uniqueTitle('P7').replace(/\s+/g, '-')
const taskTitle = `${run} effort`

async function asUser(browser: Browser, email: string, options: { viewport?: { width: number, height: number }, timezoneId?: string } = {}): Promise<Page> {
  const page = await (await browser.newContext(options)).newPage()
  await signIn(page, email)
  return page
}
async function api<T>(page: Page, method: string, body?: Record<string, unknown>, params?: Record<string, string>) {
  return pageApi<{ data: T }>(page, method, { body, params })
}
const detail = async (page: Page) => (await api<TaskDetail>(page, 'masar.api.tasks.get', undefined, { task })).body.data
const worklog = async (page: Page) => (await api<TimelinePage>(page, 'masar.api.comments.timeline', undefined, { task, view: 'worklog', limit: '100' })).body.data.items
async function logViaUi(page: Page, duration: string, note = '', estimate?: string) {
  await page.getByRole('button', { name: 'Log time' }).first().click()
  await page.getByTestId('log-duration').fill(duration)
  if (note) await page.getByLabel('Work note').fill(note)
  if (estimate !== undefined) {
    await page.getByLabel('Update remaining estimate').check()
    await page.getByTestId('log-remaining').fill(estimate)
  }
  await page.getByRole('button', { name: 'Log time', exact: true }).last().click()
}

test.beforeAll(async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  alpha = (await api<SpaceSummary[]>(manager, 'masar.api.spaces.list')).body.data.find(s => s.title === ALPHA())!.name
  task = (await api<{ task: TaskDetail }>(manager, 'masar.api.tasks.create', { space: alpha, title: taskTitle, client_request_id: crypto.randomUUID() })).body.data.task.name
  await manager.context().close()
})

test('A, B, D: log 1h 30m with a note and an estimate; both persist; the task stays open', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  await member.goto(`/masar/tasks/${task}`)
  await expect(member.getByTestId('remaining-estimate')).toContainText('not estimated')
  await logViaUi(member, '1h 30m', 'Built the importer', '4h')
  await expect(member.getByTestId('logged-total')).toContainText('1h 30m')
  await expect(member.getByTestId('remaining-estimate')).toContainText('4h')
  await member.reload()
  await member.getByRole('tab', { name: 'Worklog' }).click()
  const entry = member.locator('[data-time-entry]').first()
  await expect(entry).toContainText('E2E Member')
  await expect(entry).toContainText('1h 30m')
  await expect(entry).toContainText('Built the importer')
  const state = await detail(member)
  expect([state.loggedMinutes, state.remainingMinutes, state.isCompleted]).toEqual([90, 240, false])
  await member.context().close()
})

test('C: two people log time; the total is the exact sum', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/tasks/${task}`)
  await logViaUi(manager, '45m')
  await expect(manager.getByTestId('logged-total')).toContainText('2h 15m')
  expect((await detail(manager)).loggedMinutes).toBe(135)
  // Invalid input is refused before anything is sent.
  await manager.getByRole('button', { name: 'Log time' }).first().click()
  await manager.getByTestId('log-duration').fill('1.33h')
  await manager.getByRole('button', { name: 'Log time', exact: true }).last().click()
  await expect(manager.getByRole('alert')).toContainText('whole minutes')
  await manager.getByRole('button', { name: 'Cancel' }).click()
  await manager.context().close()
})

test('E, F: an author corrects their entry; a Manager voids another person\'s entry with a reason', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  await member.goto(`/masar/tasks/${task}`)
  await member.getByRole('tab', { name: 'Worklog' }).click()
  const mineId = await member.locator('[data-time-entry]').filter({ hasText: 'Built the importer' }).getAttribute('data-time-entry')
  const mine = member.locator(`[data-time-entry="${mineId}"]`) // the note is hidden while correcting
  await mine.getByRole('button', { name: /Actions for time entry/ }).click()
  await member.getByRole('menuitem', { name: 'Correct entry' }).click()
  await member.getByLabel('Corrected time spent').fill('2h')
  await mine.getByRole('button', { name: 'Save' }).click()
  await expect(mine).toContainText('(corrected)')
  await expect(member.getByTestId('logged-total')).toContainText('2h 45m')
  // Members cannot change someone else's time.
  const theirs = member.locator('[data-time-entry]').filter({ hasText: 'E2E Manager' })
  await expect(theirs.getByRole('button', { name: /Actions for time entry/ })).toHaveCount(0)
  await member.getByRole('tab', { name: 'History' }).click()
  await expect(member.getByText('E2E Member corrected a time entry (1h 30m → 2h)')).toBeVisible()
  await member.context().close()

  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/tasks/${task}`)
  await manager.getByRole('tab', { name: 'Worklog' }).click()
  const target = manager.locator('[data-time-entry]').filter({ hasText: 'E2E Member' })
  await target.getByRole('button', { name: /Actions for time entry/ }).click()
  await expect(manager.getByRole('menuitem', { name: 'Correct entry' })).toHaveCount(0) // never rewrites others' time
  await manager.getByRole('menuitem', { name: 'Void entry (moderation)' }).click()
  await expect(manager.getByRole('button', { name: 'Void entry' })).toBeDisabled() // reason required
  await manager.getByLabel('Void reason').fill('Logged on the wrong task')
  await manager.getByRole('button', { name: 'Void entry' }).click()
  await expect(target).toContainText('Voided by E2E Manager: Logged on the wrong task')
  await expect(manager.getByTestId('logged-total')).toContainText('45m')
  const voided = (await worklog(manager)).find(i => i.kind === 'time' && i.entry.isVoided)
  expect(voided && voided.kind === 'time' && voided.entry.worker?.name).toBe(USERS.member) // attribution kept
  await manager.context().close()
})

test('G: outsiders cannot list, read, create, correct or void time', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const entry = (await worklog(manager)).find(i => i.kind === 'time')!
  const entryName = entry.kind === 'time' ? entry.entry.name : ''
  await manager.context().close()
  const outsider = await asUser(browser, USERS.outsider)
  const calls: Array<[string, Record<string, unknown> | undefined, Record<string, string> | undefined]> = [
    ['masar.api.comments.timeline', undefined, { task, view: 'worklog' }],
    ['masar.api.time.summary', undefined, { task }],
    ['masar.api.time.get', undefined, { entry: entryName }],
    ['masar.api.time.log', { task, duration: 60, client_request_id: crypto.randomUUID() }, undefined],
    ['masar.api.time.update', { entry: entryName, changes: { duration: 600 } }, undefined],
    ['masar.api.time.void', { entry: entryName, reason: 'x' }, undefined]
  ]
  for (const [method, body, params] of calls) expect((await pageApi(outsider, method, { body, params })).status, method).toBe(404)
  const generic = await outsider.evaluate(async e => (await fetch(`/api/resource/Masar Time Entry/${e}`)).status, entryName)
  expect(generic).toBe(403)
  const listed = await outsider.evaluate(async () => (await fetch('/api/resource/Masar Time Entry?limit_page_length=500').then(r => r.json())))
  expect(JSON.stringify(listed)).not.toContain(entryName)
  await outsider.context().close()
})

test('H: a removed member keeps attribution but loses access', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await api(manager, 'masar.api.spaces.add_member', { space: alpha, user: USERS.spare, role: 'Member' })
  const spare = await asUser(browser, USERS.spare)
  const logged = (await api<TimeResult>(spare, 'masar.api.time.log', { task, duration: 30, client_request_id: crypto.randomUUID(), description: `${run} spare work` })).body.data
  await api(manager, 'masar.api.spaces.remove_member', { space: alpha, user: USERS.spare })
  expect((await pageApi(spare, 'masar.api.time.get', { params: { entry: logged.entry.name } })).status).toBe(404)
  expect((await pageApi(spare, 'masar.api.time.update', { body: { entry: logged.entry.name, changes: { duration: 5 } } })).status).toBe(404)
  expect((await pageApi(spare, 'masar.api.time.log', { body: { task, duration: 30, client_request_id: crypto.randomUUID() } })).status).toBe(404)
  const kept = (await worklog(manager)).find(i => i.kind === 'time' && i.entry.name === logged.entry.name)
  expect(kept && kept.kind === 'time' && [kept.entry.worker?.name, kept.entry.minutes]).toEqual([USERS.spare, 30])
  for (const page of [manager, spare]) await page.context().close()
})

test('I, J: duplicate submissions log once; conflicting estimates never overwrite silently', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const member = await asUser(browser, USERS.member)
  const before = (await detail(manager)).loggedMinutes
  const key = crypto.randomUUID()
  const results = await Promise.all([1, 2, 3].map(() => api<TimeResult>(manager, 'masar.api.time.log', { task, duration: 20, client_request_id: key })))
  expect(results.map(r => r.status)).toEqual([200, 200, 200])
  expect(new Set(results.map(r => r.body.data.entry.name)).size).toBe(1)
  expect((await detail(manager)).loggedMinutes).toBe(before + 20)

  const seen = (await detail(member)).remainingMinutes
  expect((await api(manager, 'masar.api.tasks.update', { task, changes: { remainingMinutes: 180 }, base: { remainingMinutes: seen } })).status).toBe(200)
  const stale = await api(member, 'masar.api.time.log', { task, duration: 15, client_request_id: crypto.randomUUID(), set_remaining: true, remaining: 60, base_remaining: seen ?? '' })
  expect(stale.status).toBe(409)
  const after = await detail(member)
  expect([after.remainingMinutes, after.loggedMinutes]).toEqual([180, before + 20]) // nothing logged
  for (const page of [manager, member]) await page.context().close()
})

test('K, L, M: Worklog lives in the timeline; time never changes completion or planning', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/tasks/${task}`)
  await manager.getByRole('tab', { name: 'All' }).click()
  await expect(manager.locator('[data-time-entry]').first()).toBeVisible()
  await manager.getByRole('tab', { name: 'Comments' }).click()
  await expect(manager.locator('[data-time-entry]')).toHaveCount(0)
  await manager.getByRole('tab', { name: 'History' }).click()
  await expect(manager.getByText(/set the remaining estimate to 3h/)).toBeVisible()
  // Each logged entry appears once in All (no duplicate "logged" history line).
  const all = (await api<TimelinePage>(manager, 'masar.api.comments.timeline', undefined, { task, view: 'all', limit: '100' })).body.data.items
  const ids = all.map(i => i.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(all.some(i => i.kind === 'history' && i.history.event === 'time_logged')).toBe(false)
  // Finished Batch snapshot and completion are untouched by later time corrections.
  const batch = (await api<{ batch: { name: string } }>(manager, 'masar.api.batches.create', { batch_name: `${run} batch`, start_date: '2026-10-26', preset: 'one_week', client_request_id: crypto.randomUUID() })).body.data.batch.name
  await api(manager, 'masar.api.batches.move_tasks', { tasks: [task], batch })
  await api(manager, 'masar.api.batches.start', { batch, request_id: crypto.randomUUID() })
  await api(manager, 'masar.api.batches.finish', { batch, carry: 'Unbatched', request_id: crypto.randomUUID() })
  const snapshot = (await api<{ progress: unknown }>(manager, 'masar.api.batches.get', undefined, { batch })).body.data.progress
  const added = (await api<TimeResult>(manager, 'masar.api.time.log', { task, duration: 60, client_request_id: crypto.randomUUID() })).body.data
  await api(manager, 'masar.api.time.update', { entry: added.entry.name, changes: { duration: 120 } })
  expect((await api<{ progress: unknown }>(manager, 'masar.api.batches.get', undefined, { batch })).body.data.progress).toEqual(snapshot)
  const state = await detail(manager)
  expect([state.isCompleted, state.priority]).toEqual([false, 'Medium'])
  await manager.context().close()
})

test('N: the work date is the Qatar business date in any browser timezone', async ({ browser }) => {
  const qatarToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar' }).format(new Date())
  for (const timezoneId of ['America/Los_Angeles', 'Pacific/Kiritimati']) {
    const member = await asUser(browser, USERS.member, { timezoneId })
    await member.goto(`/masar/tasks/${task}`)
    await logViaUi(member, '10m', `${run} tz ${timezoneId}`)
    await expect(member.getByText('10m logged', { exact: true })).toBeVisible()
    const entry = (await worklog(member)).find(i => i.kind === 'time' && i.entry.description?.includes(timezoneId))
    expect(entry && entry.kind === 'time' && entry.entry.workDate).toBe(qatarToday)
    await member.getByRole('tab', { name: 'Worklog' }).click()
    const label = new Intl.DateTimeFormat('en', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(`${qatarToday}T00:00:00Z`))
    await expect(member.locator('[data-time-entry]').filter({ hasText: timezoneId }).first()).toContainText(`for ${label}`)
    await member.context().close()
  }
})

test('O: phone layout, keyboard and accessibility', async ({ browser }) => {
  const member = await asUser(browser, USERS.member, { viewport: { width: 360, height: 740 } })
  await member.goto(`/masar/spaces/${alpha}/tasks?task=${task}&q=${encodeURIComponent(taskTitle)}`)
  await member.getByRole('button', { name: 'Log time' }).first().click()
  await member.getByTestId('log-duration').fill('25m')
  await member.keyboard.press('Enter') // submits from the keyboard
  await expect(member.getByText('25m logged', { exact: true })).toBeVisible()
  const overflow = await member.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await member.context().close()
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/tasks/${task}`)
  await manager.getByRole('tab', { name: 'Worklog' }).click()
  await manager.getByRole('button', { name: 'Log time' }).first().click()
  await manager.waitForLoadState('networkidle')
  await manager.waitForTimeout(400) // let the tab colour transition settle before measuring contrast
  const results = await new AxeBuilder({ page: manager }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)
  expect(serious).toEqual([])
  await manager.context().close()
})
