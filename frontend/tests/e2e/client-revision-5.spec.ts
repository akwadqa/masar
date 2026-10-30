import { expect, test, type Browser, type Page } from '@playwright/test'
import type { SpaceSummary, TaskDetail } from '../../app/types/api'
import { USERS, pageApi, signIn, uniqueTitle } from './helpers'

// Client revision 5 acceptance (docs/design/client-revision-5/README.md): the creator owns a new Task,
// Space members in the top bar, wider search, the notification bell, the attachment indicator, polished
// Space identity, Space categories as a list, working copied links, the installable app (manifest,
// icons, launch screens, service worker), filters that make room on phones, Back closing the Task
// panel, and Comments as the first Activity view. R11 runs last: it adds many Tasks to the list.
test.describe.configure({ mode: 'serial' })

let alpha = ''
const run = uniqueTitle('CR5').replace(/\s+/g, '-')
const tasks: Record<string, string> = {}

async function asUser(browser: Browser, email: string, path?: string, viewport = { width: 1440, height: 900 }, serviceWorkers?: 'allow' | 'block'): Promise<Page> {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 600, ...(serviceWorkers ? { serviceWorkers } : {}) })
  // WebKit has no clipboard permissions to grant (Playwright: "Unknown permission").
  if (browser.browserType().name() === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  await signIn(page, email, undefined, path)
  return page
}
async function api<T>(page: Page, method: string, body?: Record<string, unknown>, params?: Record<string, string>) {
  return pageApi<{ data: T }>(page, method, { body, params })
}
async function createTask(page: Page, space: string, title: string) {
  return (await api<{ task: TaskDetail }>(page, 'masar.api.tasks.create', { space, title, client_request_id: crypto.randomUUID() })).body.data.task.name
}

test.beforeAll(async ({ browser }) => {
  const admin = await asUser(browser, USERS.admin)
  alpha = (await api<SpaceSummary>(admin, 'masar.api.spaces.create', { data: { title: `${run} Alpha`, owner: USERS.manager, category: 'Verification' } })).body.data.name
  await api(admin, 'masar.api.spaces.add_member', { space: alpha, user: USERS.member, role: 'Member' })
  await admin.context().close()
  const manager = await asUser(browser, USERS.manager)
  for (const key of ['owned', 'panel', 'described', 'file']) tasks[key] = await createTask(manager, alpha, `${run} ${key}`)
  await manager.context().close()
})

test('R1: the creator owns a new task and can assign members', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const detail = (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks.owned })).body.data
  expect(detail.taskOwner).toBe(USERS.manager)
  expect(detail.assignees.map(person => person.name)).toEqual([USERS.manager])
  await manager.context().close()
})

test('R3: the Space shows its members in the top bar', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager, `/masar/spaces/${alpha}/tasks`)
  const stack = manager.getByTestId('space-members')
  await expect(stack).toBeVisible()
  await stack.click()
  const list = manager.getByRole('region', { name: 'Space members' })
  await expect(list.getByText('Owner')).toBeVisible()
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await manager.context().close()
})

test('R4: search finds tasks by description, comments and actions', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const key = `needle${Date.now().toString(36)}`
  await api(manager, 'masar.api.tasks.update', { task: tasks.described, changes: { description: `About ${key} desc` } })
  await api(manager, 'masar.api.comments.create', { task: tasks.panel, content: `<p>${key} comment</p>`, client_request_id: crypto.randomUUID() })
  await api(manager, 'masar.api.actions.add', { task: tasks.owned, title: `${key} action` })
  await manager.goto('/masar/tasks')
  await manager.getByRole('textbox', { name: 'Search tasks' }).fill(key)
  for (const name of [tasks.described, tasks.panel, tasks.owned]) await expect(manager.locator(`[data-task="${name}"]`)).toBeVisible()
  await expect(manager.locator(`[data-task="${tasks.file}"]`)).toHaveCount(0)
  await manager.context().close()
})

test('R5: assignment reaches the bell; opening it marks it read', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await api(manager, 'masar.api.tasks.add_assignee', { task: tasks.panel, user: USERS.member })
  await manager.context().close()

  const member = await asUser(browser, USERS.member)
  const bell = member.getByTestId('notification-bell').locator('visible=true')
  await expect(bell).toHaveAccessibleName(/Notifications, \d+ unread/)
  await bell.click()
  const item = member.getByRole('button', { name: new RegExp(`assigned you to “${run} panel”`) })
  await expect(item).toBeVisible()
  await item.click()
  await expect(member).toHaveURL(new RegExp(`/masar/tasks/${tasks.panel}`))
  await expect.poll(async () => (await api<{ items: { task: string, isRead: boolean }[] }>(member, 'masar.api.notifications.list')).body.data.items
    .find(entry => entry.task === tasks.panel)?.isRead).toBe(true)

  // The personal e-mail switch is saved on the server. It starts from a known state (on) and is put
  // back on afterwards, also when an assertion fails, so a failed run cannot leak into the next (QA-T09).
  const emailSaved = async () => (await api<{ preferences: { emailNotifications: boolean } }>(member, 'masar.api.session.boot')).body.data.preferences.emailNotifications
  expect((await api(member, 'masar.api.session.set_preferences', { email_notifications: true })).status).toBe(200)
  await member.reload()
  try {
    await member.getByTestId('notification-bell').locator('visible=true').click()
    await member.getByRole('button', { name: 'Notification settings' }).click()
    const email = member.getByRole('switch', { name: 'E-mail notifications' })
    await expect(email).toBeChecked()
    await email.click()
    await expect.poll(emailSaved).toBe(false)
    await email.click()
    await expect.poll(emailSaved).toBe(true)
  } finally {
    await api(member, 'masar.api.session.set_preferences', { email_notifications: true })
    await member.context().close()
  }
})

test('R6: a task with files shows a paperclip', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager, `/masar/spaces/${alpha}/tasks`)
  const status = await manager.evaluate(async (task) => {
    const boot = await fetch('/api/v2/method/masar.api.session.boot').then(r => r.json())
    const body = new FormData()
    body.append('task', task)
    body.append('purpose', 'Task')
    body.append('file', new File(['notes'], 'notes.txt', { type: 'text/plain' }))
    const response = await fetch('/api/v2/method/masar.api.attachments.upload', { method: 'POST', body, headers: { 'X-Frappe-CSRF-Token': boot.data.csrfToken } })
    return response.status
  }, tasks.file)
  expect(status).toBe(200)
  await manager.reload()
  await expect(manager.locator(`[data-task="${tasks.file}"]`).getByTestId('attachment-indicator')).toBeVisible()
  await expect(manager.locator(`[data-task="${tasks.owned}"]`).getByTestId('attachment-indicator')).toHaveCount(0)
  await manager.context().close()
})

test('R7, R8: Space identity is an even grid; categories are a list you can add to', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager, `/masar/spaces/${alpha}/settings`)
  await manager.getByRole('radio', { name: 'Teal' }).click()
  await expect(manager.getByRole('radio', { name: 'Teal' })).toHaveAttribute('aria-checked', 'true')
  await expect(manager.getByRole('radiogroup', { name: 'Space icon' }).getByRole('radio')).toHaveCount(24)

  const category = `${run} Category`
  const field = manager.getByRole('combobox', { name: 'Category' })
  await field.click()
  await field.fill(category)
  await manager.getByRole('option', { name: `Add category “${category}”` }).click()
  await manager.getByRole('button', { name: 'Save details' }).click()
  // Exact: the toast's screen-reader live region reads "Notification Space details saved".
  await expect(manager.getByText('Space details saved', { exact: true })).toBeVisible()
  expect((await api<string[]>(manager, 'masar.api.spaces.categories')).body.data).toContain(category)
  await manager.context().close()
})

test('R9, R14: copied task links open the task; Activity opens on Comments', async ({ browser, browserName }) => {
  const manager = await asUser(browser, USERS.manager, `/masar/spaces/${alpha}/tasks?task=${tasks.panel}`)
  const panel = manager.getByRole('dialog')
  await expect(panel.getByRole('tab', { name: 'Comments' })).toHaveAttribute('aria-selected', 'true')
  // WebKit lets no test read the clipboard: there, the link the app writes is recorded on its way in.
  await manager.evaluate(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard)
    navigator.clipboard.writeText = (text: string) => { (window as unknown as { copied: string }).copied = text; return write(text) }
  })
  await panel.getByRole('button', { name: 'Copy link' }).click()
  await expect(manager.getByText('Link copied', { exact: true })).toBeVisible()
  const link = await manager.evaluate(engine => engine === 'chromium' ? navigator.clipboard.readText() : (window as unknown as { copied: string }).copied, browserName)
  expect(new URL(link).pathname).toBe(`/masar/tasks/${tasks.panel}`)
  await manager.goto(link)
  await expect(manager.getByRole('heading', { name: `${run} panel` }).first()).toBeVisible()
  await manager.context().close()
})

test('R10: the Workspace is installable as an app', async ({ browser, request }) => {
  // The service worker is blocked in the WebKit project (playwright.config.ts); this spec checks it registers.
  const manager = await asUser(browser, USERS.manager, undefined, undefined, 'allow')
  const head = await manager.evaluate(() => ({
    manifest: document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href,
    capable: document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-capable"]')?.content,
    title: document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')?.content,
    viewport: document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content,
    touchIcon: document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href,
    launchScreens: document.querySelectorAll('link[rel="apple-touch-startup-image"]').length
  }))
  expect(head).toMatchObject({ capable: 'yes', title: 'Masar' })
  expect(head.viewport).toContain('viewport-fit=cover')
  expect(head.viewport).toContain('maximum-scale=1')
  expect(head.launchScreens).toBeGreaterThan(20)
  const manifest = await (await request.get(head.manifest!)).json()
  expect(manifest).toMatchObject({ name: 'Masar', display: 'standalone', scope: '/masar/', start_url: '/masar/my-day' })
  for (const icon of manifest.icons) expect((await request.get(new URL(icon.src, head.manifest).href)).status()).toBe(200)
  expect((await request.get(head.touchIcon!)).status()).toBe(200)
  const worker = await request.get('/masar/sw.js')
  expect(worker.headers()['content-type']).toContain('javascript')
  await expect.poll(() => manager.evaluate(async () => (await navigator.serviceWorker.getRegistration('/masar/'))?.scope ?? null))
    .toMatch(/\/masar\/$/)
  await manager.context().close()
})

test('R12: Back closes the task panel and keeps the list', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager, `/masar/spaces/${alpha}/tasks`)
  // The row centre is the status menu: open a Task from its title.
  await manager.locator(`[data-task="${tasks.owned}"]`).getByText(`${run} owned`, { exact: true }).click()
  await expect(manager).toHaveURL(new RegExp(`task=${tasks.owned}`))
  await manager.locator(`[data-task="${tasks.described}"]`).getByText(`${run} described`, { exact: true }).click({ force: true })
  await expect(manager).toHaveURL(new RegExp(`task=${tasks.described}`))
  await manager.goBack()
  await expect(manager).toHaveURL(new RegExp(`/masar/spaces/${alpha}/tasks$`))
  await expect(manager.getByRole('dialog')).toHaveCount(0)
  await expect(manager.getByRole('list', { name: 'Tasks' })).toBeVisible()

  // Closing from the panel goes back the same way, so Back afterwards leaves the list as expected.
  await manager.locator(`[data-task="${tasks.owned}"]`).getByText(`${run} owned`, { exact: true }).click()
  await manager.getByRole('dialog').getByRole('button', { name: 'Close panel' }).click()
  await expect(manager).toHaveURL(new RegExp(`/masar/spaces/${alpha}/tasks$`))
  await expect(manager.getByRole('dialog')).toHaveCount(0)
  await manager.context().close()
})

test('R11: on a phone the filters and the list scroll together as one page (iPhone stabilization 2026-10-30)', async ({ browser }) => {
  // Client revision 5 slid the filters away while the list scrolled; the client replaced this with one
  // natural page scroll on 2026-10-30: the filters move with the page and never hide by themselves.
  const manager = await asUser(browser, USERS.manager, undefined, { width: 390, height: 844 })
  for (let i = 0; i < 30; i++) await createTask(manager, alpha, `${run} scroll ${i}`)
  await manager.goto(`/masar/spaces/${alpha}/tasks`)
  const filters = manager.getByTestId('task-filters')
  const list = manager.getByRole('list', { name: 'Tasks' })
  await expect(list.locator('[data-task]').first()).toBeVisible()
  expect(await list.evaluate(node => getComputedStyle(node).overflowY)).toBe('visible')
  const page = await list.evaluateHandle((node) => {
    let element: HTMLElement | null = node as HTMLElement
    while (element && !/(auto|scroll)/.test(getComputedStyle(element).overflowY)) element = element.parentElement
    return element!
  })
  const top = (await filters.boundingBox())!.y
  await page.evaluate(node => node.scrollBy(0, 600))
  await expect.poll(async () => (await filters.boundingBox())!.y).toBeCloseTo(top - 600, 0)
  await expect(filters).not.toHaveAttribute('inert')
  await expect(manager.getByRole('link', { name: 'Task List' })).toBeVisible() // the tabs stay
  await page.evaluate(node => node.scrollTo(0, 0))
  await expect.poll(async () => (await filters.boundingBox())!.y).toBeCloseTo(top, 0)
  await manager.context().close()
})
