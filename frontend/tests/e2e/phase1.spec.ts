import { expect, test } from '@playwright/test'
import type { SpaceSummary, TaskDetail, TaskListRow } from '../../app/types/api'
import { ALPHA, BETA, USERS, escapeRegExp, fillFrappeLogin, openSpace, pageApi, password, signIn, uniqueTitle } from './helpers'

// Phase 1 vertical slice acceptance (docs/phases/phase-1.md, AS-01/02/03/11 + Desk separation).

test.describe('authentication', () => {
  // Client revision 4: Masar uses Frappe's own login page and comes back to the requested page.
  test('unauthenticated visitors are sent to Frappe login and wrong passwords are rejected', async ({ page }) => {
    await page.goto('/masar/spaces')
    await expect(page).toHaveURL(/\/login\?redirect-to=(%2F|\/)masar(%2F|\/)spaces/)
    await fillFrappeLogin(page, USERS.member, 'definitely-not-the-password')
    await expect(page.getByText(/Invalid Login|Incorrect|invalid/i).first()).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('login restores the requested route, session survives reload, logout ends it', async ({ page }) => {
    await page.goto('/masar/spaces')
    await fillFrappeLogin(page, USERS.member, password())
    const onSpaces = (url: URL) => url.pathname === '/masar/spaces'
    await expect(page).toHaveURL(onSpaces)
    await expect(page.getByPlaceholder('Search spaces')).toBeVisible()
    await page.reload()
    await expect(page).toHaveURL(onSpaces)
    await expect(page.getByPlaceholder('Search spaces')).toBeVisible()

    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)
    const boot = await page.evaluate(() => fetch('/api/v2/method/masar.api.session.boot').then(r => r.json()))
    expect(boot.data.authenticated).toBe(false)
    await page.goto('/masar/spaces')
    await expect(page).toHaveURL(/\/login/)
  })

  test('an expired session redirects to login with the current route preserved', async ({ page, context }) => {
    await signIn(page, USERS.member)
    await openSpace(page, ALPHA())
    await context.clearCookies()
    await page.getByRole('button', { name: 'Assigned to me' }).click()
    await expect(page).toHaveURL(/\/login\?redirect-to=(%2F|\/)masar/)
  })
})

test.describe('spaces and tasks', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, USERS.member)
  })

  test('only authorised Spaces are listed', async ({ page }) => {
    const { body } = await pageApi<{ data: SpaceSummary[] }>(page, 'masar.api.spaces.list')
    expect(body.data.map(s => s.title)).toContain(ALPHA())
    expect(body.data.map(s => s.title)).not.toContain(BETA())
    await page.goto('/masar/spaces')
    await expect(page.getByRole('link', { name: new RegExp(`^${escapeRegExp(ALPHA())}, `) })).toBeVisible()
    await expect(page.getByRole('link', { name: new RegExp(escapeRegExp(BETA())) })).toHaveCount(0)
  })

  test('inline creation persists exactly one task even with a rapid double Enter (AS-01)', async ({ page }) => {
    await openSpace(page, ALPHA())
    const title = uniqueTitle('Inline')
    const input = page.getByLabel('New task title')
    await input.click()
    await input.fill(title)
    await input.press('Enter')
    await input.press('Enter') // second Enter on the now-empty field must not create anything
    await expect(page.getByRole('listitem', { name: title })).toHaveCount(1)
    await expect(input).toHaveValue('')
    await expect(input).toBeFocused()

    await page.reload()
    await expect(page.getByRole('listitem', { name: title })).toHaveCount(1)
    const space = new URL(page.url()).pathname.match(/\/spaces\/([^/]+)/)![1]!
    const { body } = await pageApi<{ data: { items: TaskListRow[] } }>(page, 'masar.api.tasks.list', { params: { space, limit: '500' } })
    expect(body.data.items.filter(t => t.title === title)).toHaveLength(1)
  })

  test('blur commits typed text and empty input creates nothing', async ({ page }) => {
    await openSpace(page, ALPHA())
    const input = page.getByLabel('New task title')
    const before = await page.getByRole('listitem').count()
    await input.click()
    await input.press('Enter')
    await expect(page.getByRole('listitem')).toHaveCount(before)

    const title = uniqueTitle('Blur')
    await input.fill(title)
    await page.getByRole('button', { name: 'Assigned to me' }).focus() // move focus away
    await expect(page.getByRole('listitem', { name: title })).toHaveCount(1)
  })

  test('a failed save keeps the draft and Retry saves it once (AS-02)', async ({ page }) => {
    await openSpace(page, ALPHA())
    let failNext = true
    await page.route('**/api/v2/method/masar.api.tasks.create', async (route) => {
      if (failNext) {
        failNext = false
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"errors":[{"type":"Exception"}]}' })
      } else {
        await route.continue()
      }
    })
    const title = uniqueTitle('Retry')
    const input = page.getByLabel('New task title')
    await input.fill(title)
    await input.press('Enter')
    const draft = page.getByTestId('draft-row').filter({ hasText: title })
    await expect(draft).toContainText('Not saved')
    await draft.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByRole('listitem', { name: title })).toHaveCount(1)
    await expect(page.getByTestId('draft-row')).toHaveCount(0)
  })

  test('task details open in a panel, edits persist, and the full page deep link survives reload', async ({ page }) => {
    await openSpace(page, ALPHA())
    const title = uniqueTitle('Detail')
    const input = page.getByLabel('New task title')
    await input.fill(title)
    await input.press('Enter')
    const row = page.getByRole('listitem', { name: title })
    await row.getByText(title, { exact: true }).click() // the row centre is the status menu
    await expect(page).toHaveURL(/\?task=/)
    const titleBox = page.getByTestId('task-title')
    await expect(titleBox).toHaveValue(title)

    const renamed = `${title} renamed`
    await titleBox.fill(renamed)
    await titleBox.press('Enter')
    // Client revision: priority is a property chip with a menu instead of a form select.
    await page.getByRole('button', { name: /^Priority: / }).click()
    await page.getByRole('menuitemcheckbox', { name: 'High', exact: true }).click()
    await expect(page.getByRole('listitem', { name: renamed })).toHaveCount(1)

    await page.reload()
    await expect(page.getByTestId('task-title')).toHaveValue(renamed)

    await page.getByRole('link', { name: 'Open as page' }).click()
    await expect(page).toHaveURL(/\/tasks\/[a-z0-9]+$/)
    await page.reload()
    await expect(page.getByTestId('task-title')).toHaveValue(renamed)
    await expect(page.getByRole('button', { name: 'Priority: High' })).toBeVisible()
  })

  test('keyboard: j/k move focus, Enter opens the panel, Space completes', async ({ page }) => {
    await openSpace(page, ALPHA())
    const title = uniqueTitle('Keys')
    const input = page.getByLabel('New task title')
    await input.fill(title)
    await input.press('Enter')
    const row = page.getByRole('listitem', { name: title })
    await expect(row).toHaveCount(1)
    // The new task is the first row: j moves down, k returns to it.
    await row.focus()
    await page.keyboard.press('j')
    await expect(row).not.toBeFocused()
    await page.keyboard.press('k')
    await expect(row).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\?task=/)
    await expect(page.getByTestId('task-title')).toHaveValue(title)
    await page.getByRole('button', { name: 'Close panel' }).click()
    await expect(page).not.toHaveURL(/\?task=/)
    // Statuses are chosen from the row's status menu (client revision 2).
    await row.getByRole('button', { name: /^Status: Open\. Change status/ }).click()
    await page.getByRole('menuitem', { name: 'Completed' }).click()
    await expect(page.getByText('Status: Completed', { exact: true })).toBeVisible()
    // The default (active) view drops the finished task once the server confirms.
    await expect(page.getByRole('listitem', { name: title })).toHaveCount(0)
  })
})

test.describe('authorisation boundaries', () => {
  test('an outsider cannot read or modify a Space A task through the UI or any API path', async ({ page, browser }) => {
    await signIn(page, USERS.member)
    const alpha = (await pageApi<{ data: SpaceSummary[] }>(page, 'masar.api.spaces.list')).body.data.find(s => s.title === ALPHA())!
    const created = await pageApi<{ data: { task: TaskDetail } }>(page, 'masar.api.tasks.create', {
      body: { space: alpha.name, title: uniqueTitle('Private'), client_request_id: crypto.randomUUID() }
    })
    expect(created.status).toBe(200)
    const taskName = created.body.data.task.name

    const outsiderContext = await browser.newContext()
    const outsider = await outsiderContext.newPage()
    await signIn(outsider, USERS.outsider)
    await outsider.goto(`/masar/tasks/${taskName}`)
    await expect(outsider.getByText('Task not found')).toBeVisible()

    const masarGet = await pageApi(outsider, 'masar.api.tasks.get', { params: { task: taskName } })
    expect(masarGet.status).toBe(404)
    const masarUpdate = await pageApi(outsider, 'masar.api.tasks.update', { body: { task: taskName, changes: { title: 'hijacked' } } })
    expect(masarUpdate.status).toBe(404)
    const generic = await outsider.evaluate(async (name) => {
      const boot = await fetch('/api/v2/method/masar.api.session.boot').then(r => r.json())
      const headers = { 'Content-Type': 'application/json', 'X-Frappe-CSRF-Token': boot.data.csrfToken }
      const read = await fetch(`/api/resource/Masar%20Task/${name}`)
      const write = await fetch('/api/method/frappe.client.set_value', {
        method: 'POST', headers, body: JSON.stringify({ doctype: 'Masar Task', name, fieldname: 'title', value: 'hijacked' })
      })
      const patch = await fetch(`/api/v2/document/Masar%20Task/${name}`, { method: 'PATCH', headers, body: JSON.stringify({ title: 'hijacked' }) })
      const list = await fetch('/api/v2/document/Masar%20Task?fields=%5B%22name%22%5D&limit=1000').then(r => r.json())
      return { read: read.status, write: write.status, patch: patch.status, listed: list.data.some((t: { name: string }) => t.name === name) }
    }, taskName)
    expect(generic).toEqual({ read: 403, write: 403, patch: 403, listed: false })
    await outsiderContext.close()

    const after = await pageApi<{ data: TaskDetail }>(page, 'masar.api.tasks.get', { params: { task: taskName } })
    expect(after.body.data.title).not.toBe('hijacked')
  })

  test('Masar writes require the session CSRF token', async ({ page }) => {
    await signIn(page, USERS.member)
    const alpha = (await pageApi<{ data: SpaceSummary[] }>(page, 'masar.api.spaces.list')).body.data.find(s => s.title === ALPHA())!
    const response = await pageApi(page, 'masar.api.tasks.create', {
      body: { space: alpha.name, title: 'No token', client_request_id: crypto.randomUUID() },
      csrf: false
    })
    expect(response.status).toBe(400)
  })

  test('employees cannot open Frappe Desk', async ({ page }) => {
    await signIn(page, USERS.member)
    const response = await page.goto('/desk')
    expect(response?.status()).toBe(403)
    await expect(page.getByText('You are not permitted to access this page.')).toBeVisible()
  })
})
