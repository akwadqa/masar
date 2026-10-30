import { expect, test, type Browser, type Page } from '@playwright/test'
import type { Batch, SpaceSummary, TaskDetail } from '../../app/types/api'
import { USERS, pageApi, signIn, uniqueTitle } from './helpers'

// Client revision 2 acceptance (docs/phases/phase-8a-client-revision-2.md): manual statuses with an
// automatic Overdue, no My Work, Task details layout, Markdown description, All Tasks backlog boxes,
// inline sidebar search, Browse all Spaces menu, full-width pages and own comments.
test.describe.configure({ mode: 'serial' })

let alpha = ''
let gamma = ''
const run = uniqueTitle('CR2').replace(/\s+/g, '-')
const tasks: Record<string, string> = {}
let batch = ''

async function asUser(browser: Browser, email: string, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const page = await (await browser.newContext({ viewport })).newPage()
  await signIn(page, email)
  return page
}
async function api<T>(page: Page, method: string, body?: Record<string, unknown>, params?: Record<string, string>) {
  return pageApi<{ data: T }>(page, method, { body, params })
}
async function createTask(page: Page, title: string, space = alpha) {
  const created = await api<{ task: TaskDetail }>(page, 'masar.api.tasks.create', { space, title, client_request_id: crypto.randomUUID() })
  expect(created.status).toBe(200)
  return created.body.data.task.name
}
/** HTML5 drag of a Task row onto a box: dragstart on the row, dragover and drop on the box. */
async function dragRow(page: Page, task: string, target: string) {
  await page.evaluate(([task, target]) => {
    const row = document.querySelector(`[data-batch-target] [data-task="${task}"]`)!
    const box = document.querySelector(`[data-batch-target="${target}"]`)!
    const transfer = new DataTransfer()
    row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true }))
    box.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    box.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, [task, target])
}
function isoDay(offset: number) {
  const day = new Date(Date.now() + offset * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar' }).format(day)
}

test.beforeAll(async ({ browser }) => {
  const admin = await asUser(browser, USERS.admin)
  const create = async (title: string) => (await api<SpaceSummary>(admin, 'masar.api.spaces.create', { data: { title, owner: USERS.manager, category: 'Verification' } })).body.data.name
  alpha = await create(`${run} Alpha`)
  gamma = await create(`${run} Gamma`)
  expect((await api(admin, 'masar.api.spaces.add_member', { space: alpha, user: USERS.member, role: 'Member' })).status).toBe(200)
  await admin.context().close()
  const manager = await asUser(browser, USERS.manager)
  tasks.status = await createTask(manager, `${run} status`)
  tasks.late = await createTask(manager, `${run} late`)
  tasks.drag = await createTask(manager, `${run} drag me`)
  tasks.pick = await createTask(manager, `${run} pick me`, gamma)
  tasks.owned = await createTask(manager, `${run} owned by member`)
  expect((await api(manager, 'masar.api.tasks.add_assignee', { task: tasks.owned, user: USERS.member })).status).toBe(200)
  // The creator owns a new Task (client revision 5): hand it over to the member.
  expect((await api(manager, 'masar.api.tasks.set_owner', { task: tasks.owned, user: USERS.member })).status).toBe(200)
  const created = await api<{ batch: Batch }>(manager, 'masar.api.batches.create', { batch_name: `${run} Sprint`, start_date: isoDay(1), end_date: isoDay(14), client_request_id: crypto.randomUUID() })
  expect(created.status).toBe(200)
  batch = created.body.data.batch.name
  await manager.context().close()
})

test.afterAll(async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await api(manager, 'masar.api.session.set_preferences', { full_width: false })
  await manager.context().close()
})

test('S1: statuses are chosen from the row menu, Overdue is not offered, and the status filter finds them', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/spaces/${alpha}/tasks`)
  const row = manager.locator(`[data-task="${tasks.status}"]`)
  // No completion circle in rows any more.
  await expect(row.getByRole('button', { name: /^Complete / })).toHaveCount(0)
  await row.getByRole('button', { name: /^Status: Open\. Change status/ }).click()
  await expect(manager.getByRole('menuitem', { name: 'Overdue' })).toHaveCount(0)
  for (const status of ['Working', 'Pending Review', 'Changes Required', 'Completed', 'Closed', 'Cancelled']) {
    await expect(manager.getByRole('menuitem', { name: status })).toBeVisible()
  }
  await manager.getByRole('menuitem', { name: 'Pending Review' }).click()
  await expect(row.getByRole('button', { name: /^Status: Pending Review/ })).toBeVisible()
  const stored = await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.status })
  expect(stored.body.data.status).toBe('Pending Review')

  await manager.goto(`/masar/spaces/${alpha}/tasks?status=Pending%20Review`)
  await expect(manager.locator(`[data-task="${tasks.status}"]`)).toBeVisible()
  await expect(manager.locator(`[data-task="${tasks.late}"]`)).toHaveCount(0)
  // Finished statuses leave the default (active) list.
  await api(manager, 'masar.api.tasks.update', { task: tasks.status, changes: { status: 'Closed' } })
  await manager.goto(`/masar/spaces/${alpha}/tasks`)
  await expect(manager.locator(`[data-task="${tasks.late}"]`)).toBeVisible()
  await expect(manager.locator(`[data-task="${tasks.status}"]`)).toHaveCount(0)
  await manager.context().close()
})

test('S2: a Task whose due date has passed becomes Overdue automatically, and the server refuses a manual Overdue', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const updated = await api<TaskDetail>(manager, 'masar.api.tasks.update', { task: tasks.late, changes: { dueDate: isoDay(-1) } })
  expect(updated.body.data.status).toBe('Overdue')
  const refused = await api(manager, 'masar.api.tasks.update', { task: tasks.status, changes: { status: 'Overdue' } })
  expect(refused.status).toBe(417)
  await manager.goto(`/masar/spaces/${alpha}/tasks?status=Overdue`)
  await expect(manager.locator(`[data-task="${tasks.late}"]`).getByRole('button', { name: /^Status: Overdue/ })).toBeVisible()
  await manager.context().close()
})

test('S3: My Work is gone; home and old links open My Day, which has no count bar', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto('/masar/')
  await expect(manager).toHaveURL(/\/my-day$/)
  await expect(manager.getByRole('link', { name: 'My Work' })).toHaveCount(0)
  await manager.goto('/masar/my-work')
  await expect(manager).toHaveURL(/\/my-day$/)
  await expect(manager.getByText(/^\d+ open$/)).toHaveCount(0)
  await manager.context().close()
})

test('S4: Task details: people behind an icon, status chip, no completion, Important or My Day, Markdown description, timer box, footer', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/spaces/${alpha}/tasks?task=${tasks.owned}`)
  const panel = manager.getByRole('dialog')
  await expect(panel.getByTestId('task-title')).toHaveValue(`${run} owned by member`)
  await panel.getByTestId('task-people').click()
  await expect(manager.getByTestId('task-people-summary')).toContainText('E2E Member')
  await manager.keyboard.press('Escape')
  await expect(panel.getByRole('button', { name: /Mark complete/ })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Important' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'My Day' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: /^Status: Open\. Change status/ })).toBeVisible()

  // Markdown description: typed shortcuts become formatting and are stored as Markdown.
  const description = panel.getByTestId('task-description')
  await description.click()
  await manager.keyboard.type('Plan **bold** step')
  await manager.keyboard.press('Enter')
  await manager.keyboard.type('- first item')
  await panel.getByTestId('task-title').click()
  await expect.poll(async () => (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.owned })).body.data.description ?? '').toContain('**bold**')
  const stored = (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.owned })).body.data.description ?? ''
  expect(stored).toMatch(/^- first item$/m)
  expect(stored).not.toContain('<')

  // Order: description, then the time box, then record details at the very bottom.
  const order = await panel.evaluate((root) => {
    const top = (el: Element | null) => el?.getBoundingClientRect().top ?? -1
    return {
      description: top(root.querySelector('[data-testid="task-description"]')),
      time: top(root.querySelector('section[aria-label="Time"]')),
      footer: top(root.querySelector('footer[aria-label="Task record"]')),
      timeline: top(root.querySelector('[data-testid="timeline"], section[aria-labelledby="activity-heading"]'))
    }
  })
  expect(order.time).toBeGreaterThan(order.description)
  expect(order.footer).toBeGreaterThan(order.time)
  await manager.context().close()
})

test('S5: All Tasks: Batch boxes hold their Task rows; drag a row into a Batch, or select and add, and back to the Backlog', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  // The planning board is All Tasks grouped by Batch (client revision 3: the list is the default).
  await manager.goto(`/masar/tasks?spaces=${alpha},${gamma}&group=batch`)
  await expect(manager.getByRole('button', { name: /All my Spaces/ })).toHaveCount(0)
  await expect(manager.getByRole('columnheader', { name: 'Due' })).toHaveCount(0)
  const box = manager.locator(`[data-batch-target="${batch}"]`)
  const backlog = manager.locator('[data-batch-target="backlog"]')
  await expect(box).toBeVisible()
  await expect(backlog.locator(`[data-task="${tasks.drag}"]`)).toBeVisible()

  // Drag: the row lands inside the Batch box. Dispatched drag events (the QA account may list many
  // Batches, so source and target can be far apart for a pointer drag).
  await dragRow(manager, tasks.drag, batch)
  await expect(box.locator(`[data-task="${tasks.drag}"]`)).toBeVisible()
  await expect(backlog.locator(`[data-task="${tasks.drag}"]`)).toHaveCount(0)

  // Without dragging: select a row of another Space and use "Add selected".
  await backlog.locator(`[data-task="${tasks.pick}"]`).getByRole('checkbox').click()
  await box.getByRole('button', { name: new RegExp(`^Add 1 selected task to ${run} Sprint`) }).click()
  await expect(box.locator(`[data-task="${tasks.pick}"]`)).toBeVisible()

  // The box header checkbox selects every Task of that box (as in the client's reference).
  await box.getByRole('checkbox', { name: `Select all tasks in ${run} Sprint` }).click()
  await expect(manager.getByText(/^2 selected$/)).toBeVisible()
  await box.getByRole('checkbox', { name: `Select all tasks in ${run} Sprint` }).click()
  await expect(backlog.getByRole('button', { name: 'Create Sprint' })).toBeVisible()

  // And back to the Backlog by dragging.
  await dragRow(manager, tasks.drag, 'backlog')
  await expect(backlog.locator(`[data-task="${tasks.drag}"]`)).toBeVisible()
  const stored = await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.pick })
  expect(stored.body.data.batch?.name).toBe(batch)
  await manager.context().close()
})

test('S6: owner filter on All Tasks; Versions and Features are Space boxes only (client revision 4)', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  // Versions and Features belong to one Space: All Tasks no longer offers their boxes.
  await manager.goto(`/masar/tasks?spaces=${alpha},${gamma}`)
  await expect(manager.locator(`[data-task="${tasks.late}"]`)).toBeVisible()
  await expect(manager.getByRole('button', { name: 'Versions panel' })).toHaveCount(0)
  await expect(manager.getByRole('button', { name: 'Features panel' })).toHaveCount(0)
  await manager.goto(`/masar/spaces/${alpha}/tasks`)
  await manager.getByRole('button', { name: 'Versions panel' }).click()
  await expect(manager.getByRole('complementary', { name: 'Versions filter' })).toBeVisible()

  await manager.goto(`/masar/tasks?spaces=${alpha}&owner=${encodeURIComponent(USERS.member)}`)
  await expect(manager.locator(`[data-task="${tasks.owned}"]`)).toBeVisible()
  await expect(manager.locator(`[data-task="${tasks.late}"]`)).toHaveCount(0)
  await manager.context().close()
})

test('S7: sidebar search shows results inline, and Browse all Spaces opens the Spaces panel', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto('/masar/my-day')
  const search = manager.getByRole('combobox', { name: 'Find tasks and Spaces' })
  await search.fill(run)
  const results = manager.getByRole('listbox', { name: 'Search results' })
  await expect(results.getByRole('option', { name: new RegExp(`${run} Alpha`) })).toBeVisible()
  await expect(results.getByRole('option', { name: new RegExp(`${run} late`) })).toBeVisible()
  await expect(manager.getByRole('dialog')).toHaveCount(0)
  await search.press('ArrowDown')
  await search.press('Enter')
  await expect(manager).toHaveURL(/\/(spaces|tasks)\//)

  await manager.goto('/masar/my-day')
  // Client revision 3: Browse all Spaces opens the Spaces panel (after the client's reference).
  await manager.getByRole('button', { name: /Browse all Spaces/ }).click()
  await manager.getByRole('dialog', { name: 'Spaces' }).getByRole('link', { name: `${run} Gamma` }).click()
  await expect(manager).toHaveURL(new RegExp(`/spaces/${gamma}/tasks`))
  await manager.context().close()
})

test('S8: full-width pages from the profile menu; own comments are set apart', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  // Starts from boxed pages whatever an earlier run left: a freshly created identity has the default
  // (full width on), and the fixture cleanup now removes stored preferences (QA-M01).
  expect((await api(manager, 'masar.api.session.set_preferences', { full_width: false })).status).toBe(200)
  await manager.goto(`/masar/tasks/${tasks.owned}`)
  const boxed = manager.locator('.masar-boxed').first()
  const narrow = (await boxed.boundingBox())!.width
  await manager.getByRole('button', { name: 'Account menu' }).click()
  await manager.getByRole('menuitemcheckbox', { name: 'Full-width pages' }).click()
  await manager.keyboard.press('Escape')
  await expect.poll(async () => (await boxed.boundingBox())!.width).toBeGreaterThan(narrow + 100)
  await manager.reload()
  await expect.poll(async () => (await manager.locator('.masar-boxed').first().boundingBox())!.width).toBeGreaterThan(narrow + 100)

  const member = await asUser(browser, USERS.member)
  await api(member, 'masar.api.comments.create', { task: tasks.owned, content: '<p>From the member</p>', client_request_id: crypto.randomUUID() })
  await api(manager, 'masar.api.comments.create', { task: tasks.owned, content: '<p>From me</p>', client_request_id: crypto.randomUUID() })
  await manager.reload()
  const mine = manager.getByRole('article', { name: /\(you\)$/ })
  await expect(mine).toContainText('From me')
  await expect(mine).toHaveClass(/flex-row-reverse/)
  await expect(manager.getByRole('article', { name: 'Comment by E2E Member' })).not.toHaveClass(/flex-row-reverse/)
  await member.context().close()
  await manager.context().close()
})
