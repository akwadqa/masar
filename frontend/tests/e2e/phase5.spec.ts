import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import type { BatchDetail, BatchHistoryRow, BatchList, SpaceSummary, TaskDetail, TaskListRow } from '../../app/types/api'
import { ALPHA, GAMMA, USERS, pageApi, signIn, uniqueTitle } from './helpers'

// Phase 5 acceptance: cross-Space Batches (docs/phases/phase-5.md §2). One Batch spans Alpha and
// Gamma, both managed by e2e.manager; e2e.member sees only Alpha, e2e.outsider only Gamma.
test.describe.configure({ mode: 'serial' })

let alpha = ''
let gamma = ''
let batch = ''
let nextBatch = ''
const run = uniqueTitle('P5').replace(/\s+/g, '-')
const titles = { a1: `${run} alpha one`, a2: `${run} alpha two`, g1: `${run} gamma one` }
const tasks: Record<string, string> = {}

async function asUser(browser: Browser, email: string, viewport?: { width: number, height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage()
  await signIn(page, email)
  return page
}
async function api<T>(page: Page, method: string, body?: Record<string, unknown>, params?: Record<string, string>) {
  return pageApi<{ data: T }>(page, method, { body, params })
}
const batchState = async (page: Page, name = batch) => (await api<BatchDetail>(page, 'masar.api.batches.get', undefined, { batch: name })).body.data
const pageText = (page: Page) => page.locator('body').innerText()

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  return results.violations
    .filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)
}

test.beforeAll(async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const spaces = (await api<SpaceSummary[]>(manager, 'masar.api.spaces.list')).body.data
  alpha = spaces.find(s => s.title === ALPHA())!.name
  gamma = spaces.find(s => s.title === GAMMA())!.name
  for (const [key, space] of [['a1', alpha], ['a2', alpha], ['g1', gamma]] as const) {
    const created = await api<{ task: TaskDetail }>(manager, 'masar.api.tasks.create', { space, title: titles[key], client_request_id: crypto.randomUUID() })
    tasks[key] = created.body.data.task.name
  }
  // e2e.member works on the Alpha tasks.
  for (const key of ['a1', 'a2'] as const) await api(manager, 'masar.api.tasks.add_assignee', { task: tasks[key], user: USERS.member })
  await manager.context().close()
})

test('Planning: a Manager creates a one-week Sprint and adds tasks from two Spaces', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.getByRole('link', { name: 'Sprints' }).click()
  await manager.getByRole('button', { name: 'New Sprint' }).first().click()
  await manager.getByRole('dialog').getByRole('textbox').first().fill(`${run} sprint`)
  await manager.getByRole('radio', { name: /One Week/ }).check()
  await expect(manager.getByRole('dialog')).toContainText('7 days')
  await manager.getByRole('button', { name: 'Create Sprint' }).click()
  await expect(manager).toHaveURL(/\/sprints\/[a-z0-9]+/)
  batch = manager.url().split('/sprints/')[1]!.split('?')[0]!
  const created = await batchState(manager)
  expect(created.status).toBe('Planned')
  expect(created.durationDays).toBe(7)

  await manager.getByRole('tab', { name: 'Add tasks' }).click()
  await manager.getByRole('combobox', { name: 'Space', exact: true }).click()
  await manager.getByRole('option', { name: ALPHA() }).click()
  await manager.getByLabel('Search open tasks').fill(run)
  for (const key of ['a1', 'a2'] as const) await manager.getByRole('checkbox', { name: `Select ${titles[key]}` }).click()
  await manager.getByRole('combobox', { name: 'Space', exact: true }).click()
  await manager.getByRole('option', { name: GAMMA() }).click()
  await manager.getByRole('checkbox', { name: `Select ${titles.g1}` }).click()
  await expect(manager.getByText('3 selected from 2 Spaces')).toBeVisible()
  await manager.getByRole('button', { name: /Add 3 to Sprint/ }).click()
  await expect(manager.getByText(`3 tasks added to ${run} sprint`, { exact: true })).toBeVisible()

  await manager.getByRole('tab', { name: 'Tasks', exact: true }).click()
  const list = manager.getByRole('list', { name: 'Tasks' })
  for (const key of ['a1', 'a2', 'g1'] as const) await expect(list.getByRole('listitem', { name: titles[key] })).toBeVisible()
  expect((await batchState(manager)).progress.total).toBe(3)
  // Each task keeps its own Space.
  const g1 = (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.g1 })).body.data
  expect([g1.space, g1.batch?.name]).toEqual([gamma, batch])
  await manager.context().close()
})

test('Start: the Sprint becomes Active and appears in each Space\'s Active Sprints', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/sprints/${batch}`)
  await manager.getByRole('button', { name: 'Start Sprint' }).click()
  await manager.getByRole('dialog').getByRole('button', { name: 'Start Sprint' }).click()
  await expect(manager.getByRole('button', { name: 'Finish Sprint' })).toBeVisible()
  const started = await batchState(manager)
  expect(started.status).toBe('Active')
  expect(started.startedBy?.name).toBe(USERS.manager)
  await manager.goto(`/masar/spaces/${gamma}/sprints`)
  await expect(manager.getByRole('link', { name: new RegExp(`${run} sprint, active, 0 of 1`) })).toBeVisible()
  await manager.context().close()
})

test('Execution and progress: each Member sees and completes only their own Space\'s tasks', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  await member.goto(`/masar/sprints/${batch}`)
  const list = member.getByRole('list', { name: 'Tasks' })
  await expect(list.getByRole('listitem', { name: titles.a1 })).toBeVisible()
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(member.getByRole('button', { name: 'Start Sprint' })).toHaveCount(0)
  await list.getByRole('listitem', { name: titles.a1 }).getByRole('button', { name: /^Status: Open\. Change status/ }).click()
  await member.getByRole('menuitem', { name: 'Completed' }).click()
  await expect.poll(async () => (await batchState(member)).progress.completed).toBe(1)
  const mine = await batchState(member)
  expect([mine.progress.completed, mine.progress.total]).toEqual([1, 2])
  expect(await pageText(member)).not.toContain(titles.g1)
  await member.context().close()

  const outsider = await asUser(browser, USERS.outsider)
  const theirs = await batchState(outsider)
  expect([theirs.progress.completed, theirs.progress.total]).toEqual([0, 1])
  await outsider.goto(`/masar/sprints/${batch}`)
  await expect(outsider.getByRole('list', { name: 'Tasks' }).getByRole('listitem', { name: titles.g1 })).toBeVisible()
  const text = await pageText(outsider)
  for (const hidden of [titles.a1, titles.a2, ALPHA()]) expect(text).not.toContain(hidden)
  await outsider.context().close()
})

test('Planning board: Batch boxes collapse and expand, and a task opens from its box', async ({ browser }) => {
  // Client revision 3: Batch grouping lives on All Tasks (Group by Batch) and the Batches page.
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/tasks?q=${encodeURIComponent(run)}&show=all&group=batch`)
  const box = manager.locator(`[data-batch-target="${batch}"]`)
  await expect(box.getByRole('listitem', { name: new RegExp(titles.a2) })).toBeVisible()
  await box.getByRole('button', { name: `Collapse ${run} sprint` }).click()
  await expect(box.getByRole('listitem', { name: new RegExp(titles.a2) })).toHaveCount(0)
  await box.getByRole('button', { name: `Expand ${run} sprint` }).click()
  await box.getByRole('listitem', { name: new RegExp(titles.a1) }).getByText(titles.a1, { exact: true }).click()
  await expect(manager.getByTestId('task-title')).toHaveValue(titles.a1)
  await expect(manager.getByTestId('task-batch')).toContainText(`${run} sprint`)
  await manager.context().close()
})

test('Reassignment: tasks move between Sprint boxes on the Sprints page (Add selected)', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  nextBatch = (await api<{ batch: BatchDetail }>(manager, 'masar.api.batches.create', {
    batch_name: `${run} next`, start_date: '2026-11-09', preset: 'two_weeks', client_request_id: crypto.randomUUID()
  })).body.data.batch.name
  // A cross-Space selection moves into another Batch box in one request.
  await manager.goto('/masar/sprints')
  const sprint = manager.locator(`[data-batch-target="${batch}"]`)
  const next = manager.locator(`[data-batch-target="${nextBatch}"]`)
  for (const key of ['a2', 'g1'] as const) await sprint.getByRole('checkbox', { name: `Select ${titles[key]}` }).click()
  await next.getByRole('button', { name: new RegExp(`^Add 2 selected tasks to ${run} next`) }).click()
  await expect(manager.getByText('2 of 2 tasks moved.', { exact: true })).toBeVisible()
  await expect(sprint.getByRole('listitem')).toHaveCount(1)
  // Back again (an Active Batch accepts tasks; recorded as a scope change).
  await next.getByRole('checkbox', { name: `Select ${titles.g1}` }).click()
  await sprint.getByRole('button', { name: new RegExp(`^Add 1 selected task to ${run} sprint`) }).click()
  await expect.poll(async () => (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.g1 })).body.data.batch?.name).toBe(batch)
  const state = await batchState(manager)
  // Two departures are recorded (a2 left; g1 left and came back as a scope change after start).
  expect([state.progress.total, state.progress.addedAfterStart, state.progress.removed]).toEqual([2, 1, 2])
  await manager.context().close()
})

test('Finish and history: unfinished work moves on, results stay frozen', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/sprints/${batch}`)
  await manager.getByRole('button', { name: 'Finish Sprint' }).click()
  const dialog = manager.getByRole('dialog')
  await expect(dialog).toContainText('1completed')
  await expect(dialog).toContainText('1unfinished')
  await dialog.getByRole('radio', { name: /Move them to a planned Sprint/ }).check()
  await dialog.getByRole('combobox').click()
  await manager.getByRole('option', { name: new RegExp(`${run} next`) }).click()
  await dialog.getByRole('button', { name: 'Finish Sprint' }).click()
  await expect(manager.getByText('1 completed · 1 moved to the next Sprint.', { exact: true })).toBeVisible()
  await expect(manager.getByRole('tab', { name: 'Results' })).toHaveCount(0) // single view, no tab strip
  const finished = await batchState(manager)
  expect(finished.status).toBe('Finished')
  expect(finished.finishDestination?.name).toBe(nextBatch)
  // The unfinished Gamma task is now in the next Batch, exactly once; nothing was completed.
  const g1 = (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.g1 })).body.data
  expect([g1.batch?.name, g1.isCompleted]).toEqual([nextBatch, false])
  // Reopening a task completed in the Batch never changes the frozen result.
  await api(manager, 'masar.api.tasks.set_completed', { task: tasks.a1, completed: false })
  await manager.reload()
  const history = (await api<BatchHistoryRow[]>(manager, 'masar.api.batches.history', undefined, { batch })).body.data
  const byTask = Object.fromEntries(history.filter(h => h.task).map(h => [h.task!.name, h]))
  expect(byTask[tasks.a1]!.outcome).toBe('Completed')
  expect(byTask[tasks.a1]!.completedAtFinish).toBe(true)
  expect(byTask[tasks.g1]!.outcome).toBe('Carried Over')
  expect(byTask[tasks.a2]!.outcome).toBe('Removed')
  expect((await batchState(manager)).progress.completed).toBe(1)
  await expect(manager.getByRole('table')).toContainText('Carried Over')
  await expect(manager.getByRole('table')).toContainText('Completed')
  // Finished Batches are read-only.
  expect((await api(manager, 'masar.api.batches.move_tasks', { tasks: [tasks.a2], batch })).status).toBe(403)
  await manager.context().close()
})

test('Isolation: partial and unrelated users get nothing beyond their own Spaces', async ({ browser }) => {
  const outsider = await asUser(browser, USERS.outsider)
  const tasksSeen = (await api<{ items: TaskListRow[] }>(outsider, 'masar.api.batches.tasks', undefined, { batch: nextBatch })).body.data.items
  expect(tasksSeen.map(t => t.space)).toEqual([gamma])
  const history = (await api<BatchHistoryRow[]>(outsider, 'masar.api.batches.history', undefined, { batch })).body.data
  expect(history.every(h => h.task?.space === gamma)).toBe(true)
  expect(JSON.stringify(await batchState(outsider))).not.toContain(alpha)
  // Generic Frappe APIs: Batch Items are filtered to the caller's Spaces; direct reads are refused.
  const items = await outsider.evaluate(async b => (await fetch(`/api/resource/Masar Batch Item?fields=["name","space"]&filters=[["batch","=","${b}"]]&limit_page_length=100`)).json(), batch)
  expect((items.data as Array<{ space: string }>).every(i => i.space === gamma)).toBe(true)
  // Unbatched filter in another Space and lifecycle actions are refused for a non-owner.
  expect((await api(outsider, 'masar.api.batches.finish', { batch: nextBatch, carry: 'Unbatched', request_id: crypto.randomUUID() })).status).toBe(403)
  expect((await api(outsider, 'masar.api.batches.move_tasks', { tasks: [tasks.a1], batch: nextBatch })).status).toBe(404)
  await outsider.context().close()

  const spare = await asUser(browser, USERS.spare)
  expect((await pageApi(spare, 'masar.api.batches.get', { params: { batch } })).status).toBe(404)
  const list = (await api<BatchList>(spare, 'masar.api.batches.list')).body.data
  expect(list.items.map(b => b.name)).not.toContain(batch)
  await spare.goto(`/masar/sprints/${batch}`)
  await expect(spare.getByText('Sprint not found')).toBeVisible()
  await spare.context().close()
})

test('Mobile and keyboard: Batch pages work at 360 px; All Tasks filters by Batch', async ({ browser }) => {
  const member = await asUser(browser, USERS.member, { width: 360, height: 740 })
  // a1 left its finished Batch (unbatched again); a2 is in the next Batch.
  await member.goto(`/masar/tasks?batch=none&q=${encodeURIComponent(run)}`)
  const work = member.getByRole('list', { name: 'Tasks' })
  await expect(work.getByRole('listitem', { name: titles.a1 })).toBeVisible()
  await expect(work.getByRole('listitem', { name: titles.a2 })).toHaveCount(0)
  await member.goto(`/masar/tasks?batch=${nextBatch}&q=${encodeURIComponent(run)}`)
  await expect(work.getByRole('listitem', { name: titles.a2 })).toBeVisible()
  await member.goto('/masar/sprints')
  await expect(member.getByRole('link', { name: `${run} sprint` })).toBeVisible()
  const overflow = await member.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await member.getByRole('link', { name: `${run} sprint` }).click()
  await expect(member.getByRole('table')).toBeVisible()
  await member.context().close()
})

test('accessibility: no serious or critical axe violations on Sprint screens', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  for (const path of ['/masar/sprints', `/masar/sprints/${batch}`, `/masar/sprints/${nextBatch}`, `/masar/sprints/${nextBatch}?tab=add`, `/masar/spaces/${gamma}/sprints`, `/masar/tasks?group=sprint&show=all`]) {
    await manager.goto(path)
    await manager.waitForLoadState('networkidle')
    expect(await seriousViolations(manager), path).toEqual([])
  }
  await manager.context().close()
})
