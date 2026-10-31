import { expect, test, type Browser, type Page } from '@playwright/test'
import type { SpaceDetail, SpaceSummary, TaskDetail } from '../../app/types/api'
import { USERS, pageApi, signIn, uniqueTitle } from './helpers'

// Deleting a Space from its settings (client decision 2026-10-31): the owner or a Masar admin types
// the title; the Space and its Tasks are gone for everyone.
test.describe.configure({ mode: 'serial' })

const run = uniqueTitle('SD').replace(/\s+/g, '-')

async function asUser(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, email)
  return page
}

async function api<T>(page: Page, method: string, body?: Record<string, unknown>, params?: Record<string, string>) {
  return pageApi<{ data: T }>(page, method, { body, params })
}

async function createSpace(admin: Page, title: string) {
  const space = (await api<SpaceSummary>(admin, 'masar.api.spaces.create', { data: { title, owner: USERS.manager, category: 'Verification' } })).body.data.name
  expect((await api(admin, 'masar.api.spaces.add_member', { space, user: USERS.member, role: 'Manager' })).status).toBe(200)
  return space
}

test('the owner deletes a Space with its Tasks after typing its title', async ({ browser }) => {
  const admin = await asUser(browser, USERS.admin)
  const title = `${run} doomed`
  const space = await createSpace(admin, title)
  await admin.context().close()

  const manager = await asUser(browser, USERS.manager)
  const task = (await api<{ task: TaskDetail }>(manager, 'masar.api.tasks.create', { space, title: `${run} task`, client_request_id: crypto.randomUUID() })).body.data.task.name
  await manager.goto(`/masar/spaces/${space}/settings`)
  await manager.getByRole('button', { name: 'Delete Space' }).click()
  const confirm = manager.getByRole('button', { name: 'Delete permanently' })
  await expect(confirm).toBeDisabled()
  await manager.getByRole('textbox', { name: 'Space title' }).fill('not the title')
  await expect(confirm).toBeDisabled()
  await manager.getByRole('textbox', { name: 'Space title' }).fill(title)
  await confirm.click()
  await expect(manager).toHaveURL(/\/masar\/spaces$/)
  await expect(manager.getByText('Space deleted')).toBeVisible()
  expect((await api(manager, 'masar.api.spaces.get', undefined, { space })).status).toBe(404)
  expect((await api(manager, 'masar.api.tasks.get', undefined, { task })).status).toBe(404)
  await manager.context().close()
})

test('another Manager of the Space sees no delete option and cannot delete through the API', async ({ browser }) => {
  const admin = await asUser(browser, USERS.admin)
  const title = `${run} kept`
  const space = await createSpace(admin, title)
  await admin.context().close()

  const member = await asUser(browser, USERS.member)
  await member.goto(`/masar/spaces/${space}/settings`)
  await expect(member.getByRole('heading', { name: 'Status' })).toBeVisible()
  await expect(member.getByRole('button', { name: 'Delete Space' })).toHaveCount(0)
  expect((await api(member, 'masar.api.spaces.delete', { space, confirm_title: title })).status).toBe(403)
  expect((await api<SpaceDetail>(member, 'masar.api.spaces.get', undefined, { space })).status).toBe(200)
  await member.context().close()
})
