import { expect, test, type Browser, type Page } from '@playwright/test'
import type { SpaceSummary, TaskDetail } from '../../app/types/api'
import { ALPHA, USERS, addFilter, escapeRegExp, pageApi, signIn, uniqueTitle } from './helpers'

// Filter chips with operators and the new sorts (specs/dynamic-task-filters.md, client 2026-10-31).
test.describe.configure({ mode: 'serial' })

let alpha = ''
const run = uniqueTitle('DF').replace(/\s+/g, '-')
const tasks = { assigned: '', unassigned: '' }

async function asUser(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, email)
  return page
}

async function createTask(page: Page, title: string) {
  const created = await pageApi<{ data: { task: TaskDetail } }>(page, 'masar.api.tasks.create', {
    body: { space: alpha, title, client_request_id: crypto.randomUUID() }
  })
  expect(created.status).toBe(200)
  return created.body.data.task.name
}

test.beforeAll(async ({ browser }) => {
  const page = await asUser(browser, USERS.manager)
  const spaces = (await pageApi<{ data: SpaceSummary[] }>(page, 'masar.api.spaces.list')).body.data
  alpha = spaces.find(s => s.title === ALPHA())!.name
  tasks.unassigned = await createTask(page, `${run} nobody`)
  tasks.assigned = await createTask(page, `${run} someone`)
  expect((await pageApi(page, 'masar.api.tasks.add_assignee', { body: { task: tasks.assigned, user: USERS.member } })).status).toBe(200)
  await page.context().close()
})

test('"Assignee is empty" lists only unassigned Tasks and survives a reload', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/spaces/${alpha}/tasks?q=${encodeURIComponent(run)}`)
  await expect(manager.locator(`[data-task="${tasks.assigned}"]`)).toBeVisible()
  await addFilter(manager, 'Assignee')
  await manager.keyboard.press('Escape')
  await manager.getByRole('button', { name: /^Assignee operator: is$/ }).click()
  await manager.getByRole('menuitemcheckbox', { name: 'is empty', exact: true }).click()
  await expect(manager).toHaveURL(/assignee_op=empty/)
  await expect(manager.locator(`[data-task="${tasks.unassigned}"]`)).toBeVisible()
  await expect(manager.locator(`[data-task="${tasks.assigned}"]`)).toHaveCount(0)
  await manager.reload()
  await expect(manager.getByRole('group', { name: 'Assignee filter' })).toContainText('is empty')
  await expect(manager.locator(`[data-task="${tasks.assigned}"]`)).toHaveCount(0)
  // Removing the chip shows both again.
  await manager.getByRole('button', { name: 'Remove Assignee filter' }).click()
  await expect(manager.locator(`[data-task="${tasks.assigned}"]`)).toBeVisible()
  await manager.context().close()
})

test('the Space Task List keeps search, filters, sort and toggles on one row at 1440 px', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await signIn(page, USERS.manager, undefined, `/masar/spaces/${alpha}/tasks`)
  const bar = page.getByTestId('task-filters')
  const controls = [
    bar.getByRole('textbox', { name: 'Search tasks' }),
    bar.getByRole('button', { name: 'Add filter' }),
    bar.getByRole('combobox', { name: 'Sort tasks' }),
    bar.getByRole('button', { name: 'Assigned to me' }),
    bar.getByRole('button', { name: 'Versions panel' })
  ]
  const middles = await Promise.all(controls.map(async (control) => {
    const box = (await control.boundingBox())!
    return box.y + box.height / 2
  }))
  expect(Math.max(...middles) - Math.min(...middles)).toBeLessThan(4)

  // The Filter button and each chip carry a colour, not the grey of the text (client 2026-10-31).
  const saturation = async (locator: ReturnType<Page['locator']>) => {
    const [r, g, b] = (await locator.evaluate(node => getComputedStyle(node).color)).match(/[\d.]+/g)!.map(Number)
    return Math.max(r!, g!, b!) - Math.min(r!, g!, b!)
  }
  expect(await saturation(bar.getByRole('button', { name: 'Add filter' }).locator('[class*="text-filter-"]'))).toBeGreaterThan(40)
  await page.goto(`/masar/spaces/${alpha}/tasks?assignee_op=empty&priority=High`)
  for (const field of ['Assignee', 'Priority']) {
    expect(await saturation(bar.getByRole('group', { name: `${field} filter` }).locator('[class*="text-filter-"]')), field).toBeGreaterThan(40)
  }
  await page.context().close()
})

test('"Status is not" and a second chip combine as AND on All Tasks', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/tasks?q=${encodeURIComponent(run)}&status=Open&status_op=not`)
  await expect(manager.getByRole('group', { name: 'Status filter' })).toContainText('is not')
  await expect(manager.locator(`[data-task="${tasks.unassigned}"]`)).toHaveCount(0)
  await manager.goto(`/masar/tasks?q=${encodeURIComponent(run)}&assignee_op=set&priority=Medium`)
  await expect(manager.locator(`[data-task="${tasks.assigned}"]`)).toBeVisible()
  await expect(manager.locator(`[data-task="${tasks.unassigned}"]`)).toHaveCount(0)
  await manager.context().close()
})

test('Task Lists sort by Recently updated or Creation date only; old manual links fall back', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  for (const path of [`/masar/spaces/${alpha}/tasks`, '/masar/tasks']) {
    await manager.goto(`${path}?q=${encodeURIComponent(run)}&sort=manual`)
    const sort = manager.getByRole('combobox', { name: 'Sort tasks' })
    await expect(sort).toContainText('Recently updated')
    await sort.click()
    await expect(manager.getByRole('option')).toHaveText(['Recently updated', 'Creation date'])
    await manager.getByRole('option', { name: 'Creation date' }).click()
    await expect(manager).toHaveURL(/sort=created/)
    const rows = manager.locator('[data-task]')
    await expect(rows).toHaveCount(2)
    // Newest first: "someone" was created after "nobody".
    await expect(rows.first()).toHaveAttribute('data-task', tasks.assigned)
  }
  await manager.context().close()
})

test('the Spaces page sorts by name or by creation date', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const spaces = (await pageApi<{ data: SpaceSummary[] }>(manager, 'masar.api.spaces.list')).body.data
    .filter(space => space.status === 'In Progress')
  await manager.goto('/masar/spaces?sort=created')
  await expect(manager.getByRole('combobox', { name: 'Sort spaces' })).toContainText('Creation date')
  const newestFirst = [...spaces].sort((a, b) => Date.parse(b.creation) - Date.parse(a.creation))
  const cards = manager.locator('a[aria-label]').filter({ has: manager.locator('p.font-medium') })
  await expect(cards.first()).toHaveAttribute('aria-label', new RegExp(`^${escapeRegExp(newestFirst[0]!.title)}, `))
  await manager.getByRole('combobox', { name: 'Sort spaces' }).click()
  await manager.getByRole('option', { name: 'Name' }).click()
  await expect(manager).not.toHaveURL(/sort=/)
  await manager.context().close()
})
