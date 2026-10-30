import { expect, test, type Browser, type Page } from '@playwright/test'
import type { SpaceDetail, SpaceSummary, TaskDetail } from '../../app/types/api'
import { USERS, pageApi, signIn, uniqueTitle } from './helpers'

// Phase 2 acceptance scenarios A–G (docs/phases/phase-2.md). One Space is created per run and
// used by all scenarios in order.
test.describe.configure({ mode: 'serial' })

let spaceName = ''
let spaceTitle = ''
let sharedTask = ''

async function asUser(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, email)
  return page
}

async function openSettings(page: Page) {
  await page.goto(`/masar/spaces/${spaceName}/settings`)
  await expect(page.getByRole('list', { name: 'Space members' })).toBeVisible()
}

test('A: an administrator creates a Space that becomes accessible to its owner', async ({ browser }) => {
  const admin = await asUser(browser, USERS.admin)
  spaceTitle = uniqueTitle('P2 Space')
  await admin.goto('/masar/spaces')
  await admin.getByRole('button', { name: 'Create Space' }).first().click()
  const dialog = admin.getByRole('dialog')
  await dialog.getByLabel('Title').fill(spaceTitle)
  await dialog.getByRole('button', { name: 'Owner' }).click()
  await admin.getByPlaceholder('Search by name or email').fill('E2E Manager')
  await admin.getByRole('option', { name: /E2E Manager/ }).click()
  await dialog.getByLabel('Category').fill('Verification')
  await dialog.getByRole('button', { name: 'Create Space' }).click()
  await expect(admin).toHaveURL(/\/spaces\/[a-z0-9]+\/summary$/)
  spaceName = new URL(admin.url()).pathname.match(/\/spaces\/([^/]+)/)![1]!
  await expect(admin.getByText('Administrator view')).toBeVisible()
  // The creator did not join the Space implicitly: no task access.
  expect((await pageApi(admin, 'masar.api.tasks.list', { params: { space: spaceName } })).status).toBe(404)

  const manager = await asUser(browser, USERS.manager)
  await manager.goto('/masar/spaces')
  await expect(manager.getByRole('link', { name: new RegExp(`^${spaceTitle}, In Progress`) })).toBeVisible()
  await manager.getByRole('link', { name: new RegExp(`^${spaceTitle}, `) }).click()
  await expect(manager.getByRole('list', { name: 'Tasks' })).toBeVisible()
  await expect(manager.getByText('Owner', { exact: true }).first()).toBeVisible()

  // Non-administrators cannot create Spaces through the API.
  const denied = await pageApi(manager, 'masar.api.spaces.create', { body: { data: { title: 'Nope', owner: USERS.manager } } })
  expect(denied.status).toBe(403)
  await admin.context().close()
  await manager.context().close()
})

test('B: a Manager adds Members who then see only their authorised Spaces', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await openSettings(manager)
  for (const [email, label] of [[USERS.member, 'E2E Member'], [USERS.spare, 'E2E Spare']] as const) {
    await manager.getByRole('button', { name: 'Person to add' }).click()
    await manager.getByPlaceholder('Search by name or email').fill(label)
    await manager.getByRole('option', { name: new RegExp(label) }).click()
    await manager.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(manager.locator(`[data-member="${email}"]`)).toBeVisible()
  }
  // A shared task assigned to the spare (owner) and the member, used by scenario F.
  const created = await pageApi<{ data: { task: TaskDetail } }>(manager, 'masar.api.tasks.create', {
    body: { space: spaceName, title: uniqueTitle('Shared'), client_request_id: crypto.randomUUID() }
  })
  sharedTask = created.body.data.task.name
  for (const user of [USERS.spare, USERS.member]) {
    expect((await pageApi(manager, 'masar.api.tasks.add_assignee', { body: { task: sharedTask, user } })).status).toBe(200)
  }
  // The creator owns a new Task (client revision 5): hand it to the spare and leave it to the two of them.
  expect((await pageApi(manager, 'masar.api.tasks.set_owner', { body: { task: sharedTask, user: USERS.spare } })).status).toBe(200)
  expect((await pageApi(manager, 'masar.api.tasks.remove_assignee', { body: { task: sharedTask, user: USERS.manager } })).status).toBe(200)

  const spare = await asUser(browser, USERS.spare)
  const spaces = (await pageApi<{ data: SpaceSummary[] }>(spare, 'masar.api.spaces.list')).body.data
  expect(spaces.map(s => s.name)).toContain(spaceName)
  // Every listed Space is one the spare really belongs to (server-side membership).
  for (const s of spaces) expect(s.role).not.toBeNull()
  await spare.goto(`/masar/spaces/${spaceName}/tasks`)
  await expect(spare.getByRole('list', { name: 'Tasks' })).toBeVisible()

  const outsider = await asUser(browser, USERS.outsider)
  expect((await pageApi(outsider, 'masar.api.spaces.get', { params: { space: spaceName } })).status).toBe(404)
  await manager.context().close()
  await spare.context().close()
  await outsider.context().close()
})

test('C: a Member cannot promote themselves through the UI or any API', async ({ browser }) => {
  const spare = await asUser(browser, USERS.spare)
  await spare.goto(`/masar/spaces/${spaceName}/summary`)
  await expect(spare.getByRole('link', { name: 'Settings' })).toHaveCount(0)
  await spare.goto(`/masar/spaces/${spaceName}/settings`)
  await expect(spare).toHaveURL(/\/summary$/)

  const viaMasar = await pageApi(spare, 'masar.api.spaces.change_role', { body: { space: spaceName, user: USERS.spare, role: 'Manager' } })
  expect(viaMasar.status).toBe(403)
  const generic = await spare.evaluate(async (space) => {
    const boot = await fetch('/api/v2/method/masar.api.session.boot').then(r => r.json())
    const headers = { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': boot.data.csrfToken }
    const doc = await fetch(`/api/resource/Masar%20Space/${space}`).then(r => r.json())
    const members = doc.data.members.map((m: { user: string, role: string }) => ({ user: m.user, role: 'Manager' }))
    const v1 = await fetch('/api/method/frappe.client.set_value', {
      method: 'POST', headers, body: JSON.stringify({ doctype: 'Masar Space', name: space, fieldname: 'members', value: members })
    })
    const v2 = await fetch(`/api/v2/document/Masar%20Space/${space}`, { method: 'PATCH', headers, body: JSON.stringify({ space_owner: boot.data.user }) })
    return [v1.status, v2.status]
  }, spaceName)
  expect(generic).toEqual([403, 403])
  const detail = (await pageApi<{ data: SpaceDetail }>(spare, 'masar.api.spaces.get', { params: { space: spaceName } })).body.data
  expect(detail.members.find(m => m.name === USERS.spare)?.role).toBe('Member')
  expect(detail.owner.name).toBe(USERS.manager)
  await spare.context().close()
})

test('D + F: removing a Member revokes access immediately and keeps task data consistent', async ({ browser }) => {
  const spare = await asUser(browser, USERS.spare)
  await spare.goto(`/masar/spaces/${spaceName}/tasks`)
  await expect(spare.getByRole('list', { name: 'Tasks' })).toBeVisible()

  const manager = await asUser(browser, USERS.manager)
  await openSettings(manager)
  await manager.getByRole('button', { name: 'Remove E2E Spare' }).click()
  const impact = manager.getByTestId('removal-impact')
  await expect(impact).toContainText('Removed as assignee from 1 task')
  await expect(impact).toContainText('Task ownership moves to the next assignee on 1 task')
  await manager.getByRole('button', { name: 'Remove member' }).click()
  await expect(manager.locator(`[data-member="${USERS.spare}"]`)).toHaveCount(0)

  // The previously opened page and direct API calls no longer expose the Space.
  expect((await pageApi(spare, 'masar.api.tasks.list', { params: { space: spaceName } })).status).toBe(404)
  expect((await pageApi(spare, 'masar.api.tasks.get', { params: { task: sharedTask } })).status).toBe(404)
  await spare.reload()
  await expect(spare.getByText('Space not found')).toBeVisible()

  const task = (await pageApi<{ data: TaskDetail }>(manager, 'masar.api.tasks.get', { params: { task: sharedTask } })).body.data
  expect(task.assignees.map(a => a.name)).toEqual([USERS.member])
  expect(task.taskOwner).toBe(USERS.member)
  await spare.context().close()
  await manager.context().close()
})

test('E: ownership transfer keeps the Space owned and the owner a Manager', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await openSettings(manager)
  await manager.getByRole('button', { name: 'Transfer ownership' }).click()
  const dialog = manager.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'New owner' }).click()
  await manager.getByRole('option', { name: /E2E Member/ }).click()
  await expect(dialog).toContainText('promoted to Manager')
  await dialog.getByRole('button', { name: 'Transfer ownership' }).click()
  await expect(manager.getByText('Ownership transferred', { exact: true })).toBeVisible()
  const detail = (await pageApi<{ data: SpaceDetail }>(manager, 'masar.api.spaces.get', { params: { space: spaceName } })).body.data
  expect(detail.owner.name).toBe(USERS.member)
  expect(Object.fromEntries(detail.members.map(m => [m.name, m.role]))).toMatchObject({ [USERS.member]: 'Manager', [USERS.manager]: 'Manager' })
  // The former owner can no longer transfer ownership.
  const again = await pageApi(manager, 'masar.api.spaces.transfer_ownership', { body: { space: spaceName, new_owner: USERS.manager } })
  expect(again.status).toBe(403)
  await manager.context().close()
})

test('G: an inactive Space applies its restrictions without deleting tasks', async ({ browser }) => {
  const owner = await asUser(browser, USERS.member) // owner since scenario E
  await openSettings(owner)
  await owner.getByRole('button', { name: 'Mark completed' }).click()
  await owner.getByRole('dialog').getByRole('button', { name: 'Mark completed' }).click()
  await expect(owner.getByText('Space is now Completed', { exact: true })).toBeVisible()
  // Demote the former owner to Member to check Member restrictions.
  await owner.getByRole('combobox', { name: 'Role of E2E Manager' }).click()
  await owner.getByRole('option', { name: 'Member', exact: true }).click()
  await expect(owner.getByText('E2E Manager is now a Member', { exact: true })).toBeVisible()

  const member = await asUser(browser, USERS.manager)
  await member.goto(`/masar/spaces/${spaceName}/tasks`)
  await expect(member.getByText('This Space is completed.')).toBeVisible()
  await expect(member.getByLabel('New task title')).toHaveCount(0)
  const create = await pageApi(member, 'masar.api.tasks.create', { body: { space: spaceName, title: 'Blocked', client_request_id: crypto.randomUUID() } })
  expect(create.status).toBe(403)
  await member.goto(`/masar/spaces/${spaceName}/tasks?show=all`)
  await expect(member.getByRole('listitem').first()).toBeVisible() // tasks still listed

  await owner.getByRole('button', { name: 'Mark closed' }).click()
  await owner.getByRole('dialog').getByRole('button', { name: 'Mark closed' }).click()
  await expect(owner.getByText('Space is now Closed', { exact: true })).toBeVisible()
  const closedUpdate = await pageApi(owner, 'masar.api.tasks.set_completed', { body: { task: sharedTask, completed: 1 } })
  expect(closedUpdate.status).toBe(403) // Closed: read-only even for Managers
  await owner.getByRole('button', { name: 'Reopen' }).click()
  await owner.getByRole('dialog').getByRole('button', { name: 'Reopen' }).click()
  await expect(owner.getByText('Space is now In Progress', { exact: true })).toBeVisible()
  expect((await pageApi(owner, 'masar.api.tasks.get', { params: { task: sharedTask } })).status).toBe(200)
  await owner.context().close()
  await member.context().close()
})

test('Space details are edited by Managers with clear feedback', async ({ browser }) => {
  const owner = await asUser(browser, USERS.member)
  await openSettings(owner)
  const details = owner.locator('#details')
  // Categories are a list since client revision 5: a new name is added from the same field.
  const category = details.getByRole('combobox', { name: 'Category' })
  await category.click()
  await category.fill('Verification (edited)')
  // The existing entry, or "Add category …" when it is not in the list yet.
  await owner.getByRole('option', { name: /Verification \(edited\)/ }).first().click()
  await details.getByRole('button', { name: 'Save details' }).click()
  await expect(owner.getByText('Space details saved', { exact: true })).toBeVisible()
  await owner.goto(`/masar/spaces/${spaceName}/summary`)
  await expect(owner.getByText('Verification (edited)')).toBeVisible()
  await owner.context().close()
})

test('Masar has no sign-in or password pages of its own (client revision 4)', async ({ page }) => {
  // Sign-in and password recovery are Frappe's own pages; Masar's old addresses lead there.
  for (const path of ['/masar/login', '/masar/forgot-password', '/masar/update-password']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login\?redirect-to=/)
  }
})
