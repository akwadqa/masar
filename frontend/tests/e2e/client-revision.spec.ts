import { expect, test, type Browser, type Page } from '@playwright/test'
import type { BatchDetail, FeatureDetail, SpaceSummary, TaskDetail, TimerSession } from '../../app/types/api'
import { USERS, addFilter, pageApi, signIn, uniqueTitle } from './helpers'

// Client revision acceptance (docs/phases/phase-8a-client-revision.md): themes, My Day in the sidebar,
// filter side panels, All Tasks planning, Task details, the work timer, file paste and drop, roadmap.
test.describe.configure({ mode: 'serial' })

// Own Spaces, so these scenarios never change what other specs assume about the shared run Spaces:
// "alpha" (E2E Manager owns it, E2E Member belongs) and "gamma" (E2E Manager only).
let alpha = ''
let gamma = ''
const run = uniqueTitle('CR').replace(/\s+/g, '-')
const ALPHA = () => `${run} Alpha`
const GAMMA = () => `${run} Gamma`
const tasks: Record<string, string> = {}

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
async function chooseInUserMenu(page: Page, section: 'Design theme' | 'Appearance', option: string) {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: section }).click()
  await page.getByRole('menuitemcheckbox', { name: new RegExp(`^${option}`) }).click()
  await page.keyboard.press('Escape')
}

test.beforeAll(async ({ browser }) => {
  const admin = await asUser(browser, USERS.admin)
  const create = async (title: string) => (await api<SpaceSummary>(admin, 'masar.api.spaces.create', { data: { title, owner: USERS.manager, category: 'Verification' } })).body.data.name
  alpha = await create(ALPHA())
  gamma = await create(GAMMA())
  expect((await api(admin, 'masar.api.spaces.add_member', { space: alpha, user: USERS.member, role: 'Member' })).status).toBe(200)
  await admin.context().close()
  const manager = await asUser(browser, USERS.manager)
  tasks.day = await createTask(manager, `${run} my day`)
  tasks.plain = await createTask(manager, `${run} plain`)
  tasks.timer = await createTask(manager, `${run} timed`)
  tasks.other = await createTask(manager, `${run} other timed`)
  tasks.gamma = await createTask(manager, `${run} gamma work`, gamma)
  expect((await api(manager, 'masar.api.tasks.update', { task: tasks.day, changes: { isMyDay: true } })).status).toBe(200)
  await manager.context().close()
})

test.afterAll(async ({ browser }) => {
  // Leave the QA identity on the default look and without timers for the next run.
  const manager = await asUser(browser, USERS.manager)
  await api(manager, 'masar.api.session.set_preferences', { theme: 'ink', appearance: 'system', pinned_spaces: [] })
  const active = (await api<TimerSession | null>(manager, 'masar.api.timer.active')).body.data
  if (active) await api(manager, 'masar.api.timer.discard', { timer: active.name })
  await manager.context().close()
})

test('A: three design themes and three appearances switch instantly, persist per account, and never flash', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const html = manager.locator('html')
  await chooseInUserMenu(manager, 'Design theme', 'Violet Workspace')
  await expect(html).toHaveAttribute('data-theme', 'violet')
  await chooseInUserMenu(manager, 'Appearance', 'Dark')
  await expect(html).toHaveClass(/dark/)
  // The inline head script restores the theme before the application starts (no flash).
  await manager.reload()
  expect(await manager.evaluate(() => document.documentElement.dataset.theme)).toBe('violet')
  await expect(html).toHaveClass(/dark/)
  await chooseInUserMenu(manager, 'Design theme', 'Masar Teal')
  await expect(html).toHaveAttribute('data-theme', 'teal')
  await chooseInUserMenu(manager, 'Appearance', 'Light')
  await expect(html).not.toHaveClass(/dark/)
  // Signing out and in as someone else on the same browser does not carry the theme over.
  await manager.getByRole('button', { name: 'Account menu' }).click()
  await manager.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(manager).toHaveURL(/\/login/)
  await signIn(manager, USERS.member)
  await expect(html).toHaveAttribute('data-theme', 'violet') // the default theme (client revision 3)
  await manager.context().close()
  // The setting is stored with the account: a fresh browser shows it too.
  const again = await asUser(browser, USERS.manager)
  await expect(again.locator('html')).toHaveAttribute('data-theme', 'teal')
  await again.context().close()
})

test('B: My Day is the first sidebar destination, not a Task List filter', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const day = await manager.getByRole('link', { name: 'My Day', exact: true }).boundingBox()
  const all = await manager.getByRole('link', { name: 'All Tasks', exact: true }).boundingBox()
  expect(day!.y).toBeLessThan(all!.y)
  await manager.getByRole('link', { name: 'My Day', exact: true }).click()
  await expect(manager).toHaveURL(/\/my-day$/)
  const list = manager.getByRole('list', { name: 'Tasks' })
  await expect(list.getByRole('listitem', { name: `${run} my day` })).toBeVisible()
  await expect(list.getByRole('listitem', { name: `${run} plain` })).toHaveCount(0)
  await manager.goto(`/masar/spaces/${alpha}/tasks`)
  await expect(manager.getByRole('button', { name: 'My Day', exact: true })).toHaveCount(0)
  // Tasks join My Day from the sun toggle on their row (client revision 2: not in Task details).
  await manager.getByRole('button', { name: `Add ${run} plain to My Day` }).click()
  await expect(manager.getByRole('button', { name: `Remove ${run} plain from My Day` })).toBeVisible()
  await manager.goto('/masar/my-day')
  await expect(list.getByRole('listitem', { name: `${run} plain` })).toBeVisible()
  await manager.context().close()
})

test('C: F and V open the Feature and Version panels, but not while typing', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const feature = (await api<FeatureDetail>(manager, 'masar.api.features.create', { space: alpha, title: `${run} panel feature`, roadmap: 'Now' })).body.data.name
  await api(manager, 'masar.api.tasks.update', { task: tasks.plain, changes: { feature } })
  await manager.goto(`/masar/spaces/${alpha}/tasks`)
  await manager.getByLabel('Search tasks').fill('f')
  await expect(manager.getByRole('complementary', { name: 'Features filter' })).toHaveCount(0)
  await manager.getByLabel('Search tasks').fill('')
  await manager.getByLabel('Search tasks').blur()
  await manager.keyboard.press('f')
  const panel = manager.getByRole('complementary', { name: 'Features filter' })
  await expect(panel).toBeVisible()
  await panel.getByRole('option', { name: new RegExp(`${run} panel feature`) }).click()
  await expect(manager).toHaveURL(new RegExp(`feature=${feature}`))
  await expect(manager.getByRole('list', { name: 'Tasks' }).getByRole('listitem')).toHaveCount(1)
  await manager.keyboard.press('v')
  await expect(manager.getByRole('complementary', { name: 'Versions filter' })).toBeVisible()
  await manager.context().close()
})

test('D: All Tasks keeps a selection across filters and plans it into a Sprint atomically, by click or drag', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const batch = (await api<{ batch: BatchDetail }>(manager, 'masar.api.batches.create', {
    batch_name: `${run} plan`, start_date: '2026-11-16', preset: 'two_weeks', client_request_id: crypto.randomUUID()
  })).body.data.batch.name
  await manager.goto(`/masar/tasks?q=${encodeURIComponent(run)}&group=batch`)
  await manager.getByRole('checkbox', { name: `Select ${run} gamma work` }).click()
  // Narrowing to one Space hides the Gamma task but keeps it selected.
  await addFilter(manager, 'Space')
  await manager.getByRole('option', { name: ALPHA() }).click()
  // Close the menu without Escape (Escape also clears the selection on All Tasks).
  await manager.getByRole('heading', { name: 'All Tasks' }).click()
  await expect(manager.getByText('1 selected task is hidden by the current filters and still selected.')).toBeVisible()
  await manager.getByRole('checkbox', { name: `Select ${run} plain` }).click()
  await manager.getByRole('button', { name: new RegExp(`^Add 2 selected tasks to ${run} plan`) }).click()
  await expect(manager.getByText('2 of 2 tasks moved.', { exact: true })).toBeVisible()
  for (const task of [tasks.plain, tasks.gamma]) {
    expect((await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task })).body.data.batch?.name).toBe(batch)
  }
  // Drag a row onto the Batch target (the click path above is the non-drag alternative).
  const row = manager.getByRole('listitem', { name: `${run} my day` })
  await row.dragTo(manager.locator(`[data-batch-target="${batch}"]`))
  await expect.poll(async () => (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.day })).body.data.batch?.name).toBe(batch)
  await manager.context().close()
})

test('E: the timer runs on one Task at a time and Stop logs exactly one Time Entry', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const before = (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.timer })).body.data
  await manager.goto(`/masar/tasks/${tasks.timer}`)
  await manager.getByRole('button', { name: 'Start timer' }).click()
  await expect(manager.getByTestId('timer-clock')).toBeVisible()
  await expect(manager.getByTestId('active-timer')).toContainText(`${run} timed`)
  // A second Task offers a deliberate choice instead of starting a parallel timer.
  await manager.goto(`/masar/tasks/${tasks.other}`)
  await expect(manager.getByText('Running on')).toBeVisible()
  await expect(manager.getByRole('button', { name: 'Start timer' })).toHaveCount(0)
  await manager.getByRole('link', { name: `${run} timed` }).first().click()
  await manager.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(manager.getByLabel('Minutes to log')).toHaveValue('1')
  await manager.getByRole('button', { name: 'Save time entry' }).click()
  await expect(manager.getByTestId('active-timer')).toHaveCount(0)
  const after = (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.timer })).body.data
  expect(after.loggedMinutes - before.loggedMinutes).toBe(1)
  expect(after.remainingMinutes).toBe(before.remainingMinutes)
  await manager.context().close()
})

test('F: a pasted screenshot and a dropped file become Task attachments; the page never navigates away', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/tasks/${tasks.plain}`)
  await expect(manager.getByTestId('task-title')).toBeVisible()
  await manager.evaluate(() => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([png], 'image.png', { type: 'image/png' }))
    const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
    document.querySelector('#attachments-heading')!.dispatchEvent(event)
  })
  await expect(manager.getByRole('link', { name: /^pasted-image-\d{8}-\d{6}\.png$/ })).toBeVisible()
  const url = manager.url()
  await manager.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['notes'], 'meeting-notes.txt', { type: 'text/plain' }))
    const target = document.querySelector('#attachments-heading')!
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }))
  })
  await expect(manager.getByRole('link', { name: 'meeting-notes.txt', exact: true })).toBeVisible()
  expect(manager.url()).toBe(url)
  await manager.context().close()
})

test('G: Managers choose a Space icon; pinned Spaces lead the sidebar; roadmap Done cards flag open Tasks', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/spaces/${alpha}/settings`)
  await manager.getByRole('radiogroup', { name: 'Space icon' }).getByRole('radio', { name: 'rocket' }).click()
  await expect(manager.getByRole('radiogroup', { name: 'Space icon' }).getByRole('radio', { name: 'rocket' })).toHaveAttribute('aria-checked', 'true')
  expect((await api<SpaceSummary[]>(manager, 'masar.api.spaces.list')).body.data.find(space => space.name === alpha)!.icon).toBe('rocket')
  await manager.getByRole('button', { name: `Pin ${ALPHA()}` }).first().click()
  await expect(manager.getByRole('navigation', { name: 'Spaces' }).getByText('Pinned')).toBeVisible()
  const feature = (await api<FeatureDetail>(manager, 'masar.api.features.create', { space: alpha, title: `${run} done feature`, roadmap: 'Done' })).body.data.name
  await api(manager, 'masar.api.tasks.update', { task: tasks.other, changes: { feature } })
  await manager.goto(`/masar/spaces/${alpha}/roadmap`)
  await expect(manager.getByTestId('roadmap-column-Done').locator(`[data-feature="${feature}"]`)).toContainText('1 task is still open')
  await manager.context().close()
})

test('H: member and outsider never see another Space through All Tasks scope', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const denied = await api(member, 'masar.api.tasks.my_work', undefined, { spaces: JSON.stringify([gamma]), assigned_to_me: '0' })
  expect(denied.status).toBe(404)
  await member.goto('/masar/tasks')
  await addFilter(member, 'Space')
  await expect(member.getByRole('option', { name: ALPHA() })).toBeVisible()
  await expect(member.getByRole('option', { name: GAMMA() })).toHaveCount(0)
  await member.context().close()
})

test('A2: visited Spaces appear under Recent; the Browse all Spaces panel navigates', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/spaces/${gamma}/tasks`)
  await expect(manager.getByRole('list', { name: 'Tasks' })).toBeVisible()
  await manager.goto('/masar/my-day')
  const spacesNav = manager.getByRole('navigation', { name: 'Spaces' })
  await expect(spacesNav.getByText('Recent')).toBeVisible()
  await expect(spacesNav.getByRole('link', { name: GAMMA() })).toBeVisible()
  await spacesNav.getByRole('button', { name: /^Browse all Spaces/ }).last().click()
  await manager.getByRole('dialog', { name: 'Spaces' }).getByRole('link', { name: ALPHA() }).click()
  await expect(manager).toHaveURL(new RegExp(`/spaces/${alpha}/tasks`))
  await manager.context().close()
})

test('C2: the Task List shows Status, Space, priority, due date and people for every row', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await api(manager, 'masar.api.tasks.add_assignee', { task: tasks.other, user: USERS.member })
  await api(manager, 'masar.api.tasks.update', { task: tasks.other, changes: { dueDate: '2020-01-01', priority: 'High' } })
  await manager.goto(`/masar/tasks?q=${encodeURIComponent(`${run} other timed`)}`)
  const row = manager.getByRole('listitem', { name: `${run} other timed` })
  await expect(row.getByText('Overdue', { exact: true })).toBeVisible()
  await expect(row.getByText(ALPHA())).toBeVisible()
  await expect(row.getByText('High', { exact: true })).toBeVisible()
  await expect(row.getByRole('img', { name: /Assigned to .*E2E Member/ })).toBeVisible()
  await expect(row.getByRole('button', { name: /^Status: Overdue\. Change status/ })).toBeVisible()
  await manager.context().close()
})

test('I: people, Feature, Release and Labels change in Task details and persist; Sprint is not chosen there', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const task = await createTask(manager, `${run} properties`)
  const feature = (await api<FeatureDetail>(manager, 'masar.api.features.create', { space: alpha, title: `${run} chip feature`, roadmap: 'Next' })).body.data.name
  await api(manager, 'masar.api.releases.create', { space: alpha, release_name: `${run}-chip` })
  await api(manager, 'masar.api.labels.create', { space: alpha, title: `${run}-chip` })
  await manager.goto(`/masar/tasks/${task}`)
  await manager.getByTestId('task-people').click()
  await manager.getByRole('checkbox', { name: 'E2E Member' }).click()
  // The creator owns a new Task (client revision 5) and stays its owner when others join; the crown shows it.
  await expect(manager.getByRole('button', { name: 'E2E Manager is the Task owner' })).toBeVisible()
  await manager.keyboard.press('Escape')
  // Client revision 3: Feature and Release are header icons; Batches are planned on the board only.
  await manager.getByTestId('task-feature').click()
  await manager.getByRole('button', { name: new RegExp(`^${run} chip feature Next$`) }).click()
  await manager.getByTestId('task-release').click()
  await manager.getByRole('button', { name: new RegExp(`^${run}-chip Planned$`) }).click()
  await expect(manager.getByRole('combobox', { name: 'Sprint' })).toHaveCount(0)
  await manager.getByRole('button', { name: 'Labels' }).click()
  await manager.getByRole('option', { name: `${run}-chip` }).click()
  await manager.keyboard.press('Escape')
  await expect.poll(async () => {
    const saved = (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task })).body.data
    return [saved.assignees.map(person => person.name).join(), saved.taskOwner, saved.feature?.name, saved.release?.title, saved.labels.map(label => label.title).join()]
  }).toEqual([`${USERS.manager},${USERS.member}`, USERS.manager, feature, `${run}-chip`, `${run}-chip`])
  await manager.reload()
  await expect(manager.getByTestId('task-feature')).toHaveAttribute('aria-label', `Feature: ${run} chip feature`)
  await manager.context().close()
})

test('J and K: a timer survives navigation and reload, and two tabs cannot run two timers', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const second = await manager.context().newPage()
  await second.goto(`/masar/tasks/${tasks.other}`)
  await expect(second.getByRole('button', { name: 'Start timer' })).toBeVisible()
  await manager.goto(`/masar/tasks/${tasks.timer}`)
  await manager.getByRole('button', { name: 'Start timer' }).click()
  await expect(manager.getByTestId('timer-clock')).toBeVisible()
  // The second tab still shows its stale "Start timer"; the server refuses a parallel session.
  await second.getByRole('button', { name: 'Start timer' }).click()
  await expect(second.getByText(/^Running on/)).toBeVisible()
  await expect(second.getByText('A timer is already running on another task. Stop or discard it first.', { exact: true })).toBeVisible()
  const active = (await api<TimerSession | null>(manager, 'masar.api.timer.active')).body.data
  expect(active?.task).toBe(tasks.timer)
  await manager.goto('/masar/my-day')
  await manager.reload()
  await expect(manager.getByTestId('active-timer')).toContainText(`${run} timed`)
  await manager.getByTestId('active-timer').click()
  const before = (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.timer })).body.data.loggedMinutes
  await manager.getByRole('button', { name: 'Stop', exact: true }).click()
  await manager.getByRole('button', { name: 'Save time entry' }).click()
  await expect(manager.getByTestId('active-timer')).toHaveCount(0)
  expect((await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.timer })).body.data.loggedMinutes - before).toBe(1)
  // Stopping again (a retried request) logs nothing more.
  const again = await api<{ logged: boolean }>(manager, 'masar.api.timer.stop', { timer: active!.name })
  expect(again.body.data.logged).toBe(false)
  await manager.context().close()
})

test('M: an image pasted into the comment composer is posted with the comment', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/tasks/${tasks.plain}`)
  const editor = manager.getByTestId('comment-editor')
  await editor.click()
  await manager.keyboard.type('Screenshot of the error ')
  await editor.evaluate((root) => {
    const element = root.matches('[contenteditable="true"]') ? root : root.querySelector('[contenteditable="true"]')!
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([png], 'image.png', { type: 'image/png' }))
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  })
  await expect(editor.locator('img')).toBeVisible()
  await manager.getByRole('button', { name: 'Comment', exact: true }).click()
  const posted = manager.getByRole('article', { name: 'Comment by E2E Manager' }).last()
  await expect(posted.locator('img[src^="/private/files/"]')).toBeVisible()
  await expect(posted.getByText('You', { exact: true })).toBeVisible()
  await manager.context().close()
})

test('P2: System appearance follows the device setting', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' })
  const page = await context.newPage()
  await signIn(page, USERS.manager)
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Appearance' }).click()
  await page.getByRole('menuitemcheckbox', { name: /^System/ }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await context.close()
})

test('Q: on a phone, My Day, All Tasks and Task properties remain usable', async ({ browser }) => {
  const phone = await asUser(browser, USERS.manager, { width: 390, height: 844 })
  await phone.goto('/masar/tasks')
  await phone.getByRole('button', { name: /open sidebar|Open menu|menu/i }).first().click()
  await phone.getByRole('link', { name: 'My Day', exact: true }).click()
  await expect(phone).toHaveURL(/\/my-day$/)
  await expect(phone.getByRole('list', { name: 'Tasks' })).toBeVisible()
  await phone.goto(`/masar/tasks?q=${encodeURIComponent(run)}`)
  await expect(phone.getByRole('button', { name: 'Add filter' })).toBeVisible()
  await phone.goto(`/masar/tasks/${tasks.plain}`)
  await phone.getByRole('button', { name: /^Priority: / }).click()
  await phone.getByRole('menuitemcheckbox', { name: 'Low', exact: true }).click()
  await expect(phone.getByRole('button', { name: 'Priority: Low' })).toBeVisible()
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await phone.context().close()
})
