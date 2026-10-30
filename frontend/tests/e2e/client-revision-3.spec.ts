import { expect, test, type Browser, type Page } from '@playwright/test'
import type { Batch, Label, SpaceSummary, TaskDetail } from '../../app/types/api'
import { USERS, pageApi, pickDate, signIn, uniqueTitle } from './helpers'

// Client revision 3 acceptance (docs/design/client-revision-3/README.md): Spaces panel, Batch boxes on
// the Batches page and in All Tasks, Space lists without Batch tools, Batch deletion, Task header icons
// for Feature and Release, no Batch selector, labels, date pickers, no Department, defaults.
test.describe.configure({ mode: 'serial' })

let alpha = ''
const run = uniqueTitle('CR3').replace(/\s+/g, '-')
const tasks: Record<string, string> = {}
let batch = ''

async function asUser(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await signIn(page, email)
  return page
}
async function api<T>(page: Page, method: string, body?: Record<string, unknown>, params?: Record<string, string>) {
  return pageApi<{ data: T }>(page, method, { body, params })
}
function isoDay(offset: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar' }).format(new Date(Date.now() + offset * 86_400_000))
}

test.beforeAll(async ({ browser }) => {
  const admin = await asUser(browser, USERS.admin)
  alpha = (await api<SpaceSummary>(admin, 'masar.api.spaces.create', { data: { title: `${run} Alpha`, owner: USERS.manager, category: 'Verification' } })).body.data.name
  await api(admin, 'masar.api.spaces.add_member', { space: alpha, user: USERS.member, role: 'Member' })
  await admin.context().close()
  const manager = await asUser(browser, USERS.manager)
  for (const key of ['planned', 'kept', 'loose']) {
    tasks[key] = (await api<{ task: TaskDetail }>(manager, 'masar.api.tasks.create', { space: alpha, title: `${run} ${key}`, client_request_id: crypto.randomUUID() })).body.data.task.name
  }
  batch = (await api<{ batch: Batch }>(manager, 'masar.api.batches.create', { batch_name: `${run} Sprint`, start_date: isoDay(2), end_date: isoDay(15), client_request_id: crypto.randomUUID() })).body.data.batch.name
  expect((await api(manager, 'masar.api.batches.move_tasks', { tasks: [tasks.planned], batch, expected: { [tasks.planned]: null } })).status).toBe(200)
  await manager.context().close()
})

test('R1: Browse all Spaces opens a Spaces panel with search, icons and View all Spaces', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto('/masar/my-day')
  await manager.getByRole('button', { name: /Browse all Spaces/ }).click()
  const panel = manager.getByRole('dialog', { name: 'Spaces' })
  await expect(panel.getByRole('heading', { name: 'Spaces' })).toBeVisible()
  await panel.getByRole('textbox', { name: 'Search all Spaces' }).fill(run)
  await expect(panel.getByRole('link', { name: `${run} Alpha` })).toBeVisible()
  await panel.getByRole('textbox', { name: 'Search all Spaces' }).press('Enter')
  await expect(manager).toHaveURL(new RegExp(`/spaces/${alpha}/tasks`))
  await manager.getByRole('button', { name: /Browse all Spaces/ }).click()
  await manager.getByRole('dialog', { name: 'Spaces' }).getByRole('button', { name: 'View all Spaces' }).click()
  await expect(manager).toHaveURL(/\/spaces$/)
  await manager.context().close()
})

test('R5–R8: Sprints page shows Sprints with their tasks; Space lists have no Sprint tools; All Tasks is a list with Group by Sprint', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto('/masar/sprints')
  const box = manager.locator(`[data-batch-target="${batch}"]`)
  await expect(box.locator(`[data-task="${tasks.planned}"]`)).toBeVisible()
  await manager.goto(`/masar/spaces/${alpha}/tasks`)
  await expect(manager.getByRole('button', { name: 'Sprints panel' })).toHaveCount(0)
  await expect(manager.getByRole('button', { name: 'Group by Sprint' })).toHaveCount(0)
  await expect(manager.getByRole('button', { name: 'Features panel' })).toBeVisible()
  await manager.goto(`/masar/tasks?spaces=${alpha}`)
  await expect(manager.locator('[data-batch-target]')).toHaveCount(0)
  await expect(manager.locator(`[data-task="${tasks.loose}"]`)).toBeVisible()
  await manager.getByRole('button', { name: 'Group by Sprint' }).click()
  await expect(manager.locator(`[data-batch-target="${batch}"]`)).toBeVisible()
  await manager.context().close()
})

test('R9: a planned Sprint is deleted from its box and its tasks return to the Backlog', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/tasks?spaces=${alpha}&group=batch`)
  await manager.locator(`[data-batch-target="${batch}"]`).getByRole('button', { name: `More actions for ${run} Sprint` }).click()
  await manager.getByRole('menuitem', { name: 'Delete Sprint' }).click()
  await manager.getByRole('dialog').getByRole('button', { name: 'Delete Sprint' }).click()
  await expect(manager.locator(`[data-batch-target="${batch}"]`)).toHaveCount(0)
  await expect(manager.locator('[data-batch-target="backlog"]').locator(`[data-task="${tasks.planned}"]`)).toBeVisible()
  expect((await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.planned })).body.data.batch).toBeNull()
  await manager.context().close()
})

test('R12–R13, R17: Task header holds Feature, Release and people icons; no Sprint selector; wider panel', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await api(manager, 'masar.api.releases.create', { space: alpha, release_name: `${run} v1` })
  await manager.goto(`/masar/spaces/${alpha}/tasks?task=${tasks.kept}`)
  const panel = manager.getByRole('dialog').first()
  await expect(panel.getByText('No Feature')).toHaveCount(0)
  await expect(panel.getByText('No Release')).toHaveCount(0)
  await expect(panel.getByRole('combobox', { name: 'Sprint' })).toHaveCount(0)
  await panel.getByTestId('task-release').click()
  await manager.getByRole('button', { name: new RegExp(`^${run} v1 Planned$`) }).click()
  await expect(panel.getByTestId('task-release')).toHaveAttribute('aria-label', `Release: ${run} v1`)
  const width = (await panel.boundingBox())!.width
  expect(width).toBeGreaterThan(700)
  await manager.context().close()
})

test('R11: Managers create labels in Space settings; members create them from a task', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/spaces/${alpha}/settings`)
  await manager.getByRole('textbox', { name: 'New label name' }).fill(`${run} Client`)
  await manager.getByRole('button', { name: 'Create label' }).click()
  await expect(manager.getByRole('list', { name: 'Labels of this Space' })).toContainText(`${run} Client`)
  const labels = (await api<Label[]>(manager, 'masar.api.labels.list', undefined, { space: alpha })).body.data
  expect(labels.some(label => label.title === `${run} Client` && label.color === 'primary')).toBe(true)
  await manager.context().close()
})

test('R14–R15, R18: date pickers, no Department, and the Violet / Light / full-width defaults', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto('/masar/sprints')
  await manager.getByRole('button', { name: 'New Sprint' }).first().click()
  const dialog = manager.getByRole('dialog')
  await dialog.getByRole('textbox').first().fill(`${run} picked`)
  await pickDate(dialog, manager, 'Start date', isoDay(20))
  await expect(dialog.getByRole('button', { name: 'Start date' })).not.toContainText('Choose a date')
  await manager.keyboard.press('Escape')

  const admin = await asUser(browser, USERS.admin)
  await admin.goto('/masar/spaces')
  await expect(admin.getByRole('combobox', { name: 'Filter by department' })).toHaveCount(0)
  const space = (await api<Record<string, unknown>>(admin, 'masar.api.spaces.get', undefined, { space: alpha })).body.data
  expect(space).not.toHaveProperty('department')
  await admin.context().close()

  // An account without stored choices gets the defaults.
  const spare = await asUser(browser, USERS.spare)
  const prefs = (await api<{ preferences: { theme: string, appearance: string, fullWidth: boolean } }>(spare, 'masar.api.session.boot')).body.data.preferences
  expect(prefs).toMatchObject({ theme: 'violet', appearance: 'light', fullWidth: true })
  await expect(spare.locator('html')).toHaveAttribute('data-theme', 'violet')
  await expect(spare.locator('html')).toHaveAttribute('data-full-width', '')
  await spare.context().close()
  await manager.context().close()
})
