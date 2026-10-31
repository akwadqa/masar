import { expect, test, type Browser, type Page } from '@playwright/test'
import type { Batch, Label, SpaceSummary, TaskDetail } from '../../app/types/api'
import { USERS, addFilter, pageApi, signIn, uniqueTitle } from './helpers'

// Client revision 4 acceptance (docs/design/client-revision-4/README.md): personal My Day that updates
// without a refresh and drops finished tasks, softer avatars, Masar beside other Frappe apps (Frappe
// login, /masar), Time below Attachments, Batches instead of Batches with a "Plan your Batch" area,
// coloured filter icons, and All Tasks filters on one row without Versions and Features.
test.describe.configure({ mode: 'serial' })

let alpha = ''
let gamma = ''
const run = uniqueTitle('CR4').replace(/\s+/g, '-')
const tasks: Record<string, string> = {}

async function asUser(browser: Browser, email: string, path?: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await signIn(page, email, undefined, path)
  return page
}
async function api<T>(page: Page, method: string, body?: Record<string, unknown>, params?: Record<string, string>) {
  return pageApi<{ data: T }>(page, method, { body, params })
}

// The "+ Filter" menu offers no Label field (specs/dynamic-task-filters.md).
async function expectNoLabelField(page: Page) {
  await page.getByRole('button', { name: 'Add filter' }).click()
  await expect(page.getByRole('menuitem', { name: 'Status', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Label', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
}

async function createTask(page: Page, space: string, title: string) {
  return (await api<{ task: TaskDetail }>(page, 'masar.api.tasks.create', { space, title, client_request_id: crypto.randomUUID() })).body.data.task.name
}

test.beforeAll(async ({ browser }) => {
  const admin = await asUser(browser, USERS.admin)
  alpha = (await api<SpaceSummary>(admin, 'masar.api.spaces.create', { data: { title: `${run} Alpha`, owner: USERS.manager, category: 'Verification' } })).body.data.name
  gamma = (await api<SpaceSummary>(admin, 'masar.api.spaces.create', { data: { title: `${run} Gamma`, owner: USERS.manager, category: 'Verification' } })).body.data.name
  await api(admin, 'masar.api.spaces.add_member', { space: alpha, user: USERS.member, role: 'Member' })
  await admin.context().close()
  const manager = await asUser(browser, USERS.manager)
  for (const key of ['mine', 'shared', 'finish', 'labelled']) tasks[key] = await createTask(manager, alpha, `${run} ${key}`)
  tasks.gammaLabelled = await createTask(manager, gamma, `${run} gamma labelled`)
  await manager.context().close()
})

test('R1–R3: My Day is personal, updates without a refresh and drops finished tasks', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager, '/masar/my-day')
  // My Day is loaded (and cached) first; the task is then added from All Tasks without reloading.
  await expect(manager.getByRole('heading', { name: 'My Day' }).or(manager.getByText('My Day', { exact: true })).first()).toBeVisible()
  await expect(manager.locator(`[data-task="${tasks.mine}"]`)).toHaveCount(0)
  await manager.getByRole('link', { name: 'All Tasks', exact: true }).click()
  await manager.getByRole('textbox', { name: 'Search tasks' }).fill(`${run} mine`)
  await manager.getByRole('button', { name: `Add ${run} mine to My Day` }).click()
  await expect(manager.getByRole('button', { name: `Remove ${run} mine from My Day` })).toBeVisible()
  await manager.getByRole('link', { name: 'My Day', exact: true }).click()
  await expect(manager.locator(`[data-task="${tasks.mine}"]`)).toBeVisible()

  // Another member of the Space does not see it in their My Day.
  const member = await asUser(browser, USERS.member, '/masar/my-day')
  await member.waitForLoadState('networkidle')
  await expect(member.locator(`[data-task="${tasks.mine}"]`)).toHaveCount(0)
  const seen = await api<TaskDetail>(member, 'masar.api.tasks.get', undefined, { task: tasks.mine })
  expect(seen.body.data.isMyDay).toBe(false)
  await member.context().close()

  // Finishing a task removes it from My Day at once, and for good.
  expect((await api(manager, 'masar.api.tasks.set_my_day', { task: tasks.finish, value: true })).status).toBe(200)
  await manager.reload()
  const row = manager.locator(`[data-task="${tasks.finish}"]`)
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: /^Status: Open/ }).click()
  await manager.getByRole('menuitem', { name: 'Completed' }).click()
  await expect(row).toHaveCount(0)
  await expect.poll(async () => (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.finish })).body.data)
    .toMatchObject({ status: 'Completed', isMyDay: false })
  await manager.context().close()
})

test('R4: avatar initials are regular weight and smaller than the avatar text', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const initials = manager.locator('.masar-avatar [data-slot="fallback"], [data-slot="root"] [data-slot="fallback"]').first()
  await expect(initials).toBeVisible()
  const style = await initials.evaluate((node) => {
    const own = getComputedStyle(node)
    const parent = getComputedStyle(node.parentElement!)
    return { weight: own.fontWeight, size: Number.parseFloat(own.fontSize), parent: Number.parseFloat(parent.fontSize) }
  })
  expect(style.weight).toBe('400')
  expect(style.parent - style.size).toBeGreaterThanOrEqual(1)
  expect(style.parent - style.size).toBeLessThanOrEqual(2)
  await manager.context().close()
})

test('R5: Masar opens at /masar with Frappe login, and old Sprint links lead to Batches', async ({ browser }) => {
  const guest = await (await browser.newContext()).newPage()
  await guest.goto(`/masar/tasks?spaces=${alpha}`)
  // Frappe (server) keeps the slashes; the Workspace (client) encodes them: both return to the same page.
  await expect(guest).toHaveURL(/\/login\?redirect-to=(%2F|\/)masar(%2F|\/)tasks%3Fspaces%3D/)
  await guest.context().close()

  const manager = await asUser(browser, USERS.manager)
  // Batches were called Sprints in client revision 4 (reverted 2026-10-31): old links still arrive.
  await manager.goto('/masar/sprints')
  await expect(manager).toHaveURL(/\/masar\/batches$/)
  await expect(manager.getByRole('link', { name: 'Batches' })).toBeVisible()
  await expect(manager.getByRole('link', { name: 'Sprints' })).toHaveCount(0)
  await manager.goto(`/masar/spaces/${alpha}/sprints`)
  await expect(manager).toHaveURL(new RegExp(`/masar/spaces/${alpha}/batches$`))
  await manager.context().close()
})

test('R13: a selected Version or Feature shows its whole border, also on a phone', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
  await signIn(page, USERS.manager, undefined, `/masar/spaces/${alpha}/tasks`)
  const release = (await api<{ name: string }>(page, 'masar.api.releases.create', { space: alpha, release_name: `${run} MVP` })).body.data.name
  await page.reload()
  await page.getByRole('button', { name: 'Versions panel' }).click()
  const option = page.getByRole('option', { name: new RegExp(`${run} MVP`) })
  await option.click()
  await expect(page).toHaveURL(new RegExp(`release=${release}`))
  // The ring is inset, so the scrolling list cannot crop it.
  const shadow = await option.evaluate(node => getComputedStyle(node).boxShadow)
  expect(shadow).toContain('inset')
  await page.context().close()
})

test('R6: the Time section sits below Attachments and above the activity', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/tasks/${tasks.shared}`)
  const top = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!.y
  const attachments = await top(manager.getByRole('heading', { name: 'Attachments' }))
  const time = await top(manager.getByRole('region', { name: 'Time', exact: true }))
  const activity = await top(manager.getByRole('heading', { name: 'Activity' }))
  expect(attachments).toBeLessThan(time)
  expect(time).toBeLessThan(activity)
  await manager.context().close()
})

test('R9–R12: All Tasks keeps its filters on one row with soft-coloured icons; the label filter needs one Space', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const inAlpha = (await api<{ label: Label }>(manager, 'masar.api.labels.create', { space: alpha, title: `${run} tag` })).body.data.label
  const inGamma = (await api<{ label: Label }>(manager, 'masar.api.labels.create', { space: gamma, title: `${run} tag` })).body.data.label
  await api(manager, 'masar.api.tasks.add_label', { task: tasks.labelled, label: inAlpha.name })
  await api(manager, 'masar.api.tasks.add_label', { task: tasks.gammaLabelled, label: inGamma.name })

  // Without active filters, every filter and toggle shares one row at 1440 px.
  await manager.goto('/masar/tasks')
  await expect(manager.getByRole('button', { name: 'Versions panel' })).toHaveCount(0)
  await expect(manager.getByRole('button', { name: 'Features panel' })).toHaveCount(0)
  const controls = [
    manager.getByRole('textbox', { name: 'Search tasks' }),
    manager.getByRole('button', { name: 'Add filter' }),
    manager.getByRole('button', { name: 'Assigned to me' }),
    // Exact and inside the filter bar: every Task row also has a "Mark … as important" button (QA-T10).
    manager.getByTestId('task-filters').getByRole('button', { name: 'Important', exact: true }),
    manager.getByRole('button', { name: 'Group by Batch' })
  ]
  const middles = await Promise.all(controls.map(async (control) => {
    const box = (await control.boundingBox())!
    return box.y + box.height / 2
  }))
  expect(Math.max(...middles) - Math.min(...middles)).toBeLessThan(4)

  // Icons carry colour: not the grey of the text and border.
  for (const name of ['Assigned to me', 'Important', 'Group by Batch']) {
    const color = await manager.getByRole('button', { name }).locator('[class*="text-filter-"]').evaluate(node => getComputedStyle(node).color)
    const [r, g, b] = color.match(/[\d.]+/g)!.map(Number)
    expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!), name).toBeGreaterThan(40)
  }

  // Labels belong to one Space: the Label field is offered once a single Space is chosen.
  await expectNoLabelField(manager)
  await manager.goto(`/masar/tasks?spaces=${alpha},${gamma}`)
  await expect(manager.locator(`[data-task="${tasks.labelled}"]`)).toBeVisible()
  await expectNoLabelField(manager)
  await manager.goto(`/masar/tasks?spaces=${alpha}`)
  await addFilter(manager, 'Label')
  await manager.getByRole('option', { name: `${run} tag` }).click()
  await expect(manager.locator(`[data-task="${tasks.labelled}"]`)).toBeVisible()
  await expect(manager.locator(`[data-task="${tasks.shared}"]`)).toHaveCount(0)
  await expect(manager.locator(`[data-task="${tasks.gammaLabelled}"]`)).toHaveCount(0)
  await manager.context().close()
})

test('R7–R8: with no current Batch, a "Plan your Batch" area takes dropped tasks into a new Batch', async ({ browser }) => {
  const admin = await asUser(browser, USERS.admin)
  const space = (await api<SpaceSummary>(admin, 'masar.api.spaces.create', { data: { title: `${run} Planning`, owner: USERS.spare, category: 'Verification' } })).body.data.name
  await admin.context().close()
  const spare = await asUser(browser, USERS.spare)
  const current = (await api<{ items: Batch[] }>(spare, 'masar.api.batches.list')).body.data.items.filter(b => b.status !== 'Finished')
  test.skip(current.length > 0, 'This account already sees a current Batch, so the planning area is not shown.')
  const task = await createTask(spare, space, `${run} plan me`)

  await spare.goto('/masar/tasks?group=batch')
  const zone = spare.getByTestId('batch-plan-zone')
  await expect(zone.getByRole('heading', { name: 'Plan your Batch' })).toBeVisible()
  await expect(zone).toContainText('Drag tasks from the Backlog section into this area')
  await spare.evaluate((name) => {
    const row = document.querySelector(`[data-batch-target="backlog"] [data-task="${name}"]`)!
    const target = document.querySelector('[data-testid="batch-plan-zone"]')!
    const transfer = new DataTransfer()
    row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true }))
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, task)
  const dialog = spare.getByRole('dialog', { name: 'New Batch' })
  await dialog.getByLabel('Name').fill(`${run} first batch`)
  await dialog.getByRole('button', { name: 'Create Batch' }).click()
  await expect(spare.getByText(`Added to ${run} first batch`).first()).toBeVisible()
  const stored = await api<TaskDetail>(spare, 'masar.api.tasks.get', undefined, { task })
  expect(stored.body.data.batch?.title).toBe(`${run} first batch`)
  await expect(zone).toHaveCount(0)

  // Leave no current Batch behind for this shared QA account.
  expect((await api(spare, 'masar.api.batches.delete', { batch: stored.body.data.batch!.name })).status).toBe(200)
  await spare.context().close()
})
