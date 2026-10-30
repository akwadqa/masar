import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import type { Label, SpaceSummary, TaskAction, TaskDetail, TaskListRow, TaskSearchResult } from '../../app/types/api'
import { ALPHA, USERS, pageApi, pressPaletteShortcut, signIn, uniqueTitle } from './helpers'

// Phase 3 acceptance scenarios A–G (docs/phases/phase-3.md) plus automated accessibility checks.
test.describe.configure({ mode: 'serial' })

let alpha = ''
const run = uniqueTitle('P3').replace(/\s+/g, '-')

async function asUser(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, email)
  return page
}

async function createTask(page: Page, title: string, assignTo?: string): Promise<string> {
  const created = await pageApi<{ data: { task: TaskDetail } }>(page, 'masar.api.tasks.create', {
    body: { space: alpha, title, client_request_id: crypto.randomUUID() }
  })
  expect(created.status).toBe(200)
  const name = created.body.data.task.name
  if (assignTo) expect((await pageApi(page, 'masar.api.tasks.add_assignee', { body: { task: name, user: assignTo } })).status).toBe(200)
  return name
}

async function openTaskPanel(page: Page, title: string) {
  await page.getByRole('list', { name: 'Tasks' }).getByRole('listitem', { name: title }).getByText(title, { exact: true }).click()
  await expect(page.getByTestId('task-title')).toHaveValue(title)
}

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  return results.violations
    .filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)
}

test.beforeAll(async ({ browser }) => {
  const page = await asUser(browser, USERS.manager)
  const spaces = (await pageApi<{ data: SpaceSummary[] }>(page, 'masar.api.spaces.list')).body.data
  alpha = spaces.find(s => s.title === ALPHA())!.name
  await page.context().close()
})

test('A: daily work starts from All Tasks (assigned to me) and opens a task', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const title = `${run} daily`
  await createTask(manager, title, USERS.member)
  await manager.context().close()

  // My Work was removed (client revision 2): All Tasks with "Assigned to me" covers it.
  const member = await asUser(browser, USERS.member)
  await member.getByRole('link', { name: 'All Tasks', exact: true }).click()
  await expect(member).toHaveURL(/\/tasks/)
  await member.getByRole('button', { name: 'Assigned to me' }).click()
  await expect(member.getByRole('button', { name: 'Assigned to me' })).toHaveAttribute('aria-pressed', 'true')
  await member.getByLabel('Search tasks').fill(run)
  await expect(member.getByRole('list', { name: 'Tasks' }).getByRole('listitem', { name: title })).toBeVisible()
  await openTaskPanel(member, title)
  await expect(member).toHaveURL(/\/tasks\?.*task=/)
  await member.context().close()
})

test('B + G: Actions are added, edited, completed, persisted and survive a failed save', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const title = `${run} actions`
  const task = await createTask(member, title)
  await member.goto(`/masar/spaces/${alpha}/tasks?q=${encodeURIComponent(title)}`)
  await openTaskPanel(member, title)

  const add = member.getByLabel('New action')
  for (const text of ['Draft the plan', 'Review it', 'Publish']) {
    await add.fill(text)
    await add.press('Enter')
    await expect(member.getByRole('list', { name: 'Actions' }).getByText(text, { exact: true })).toBeVisible()
  }
  await member.getByRole('button', { name: 'Edit action: Review it' }).click()
  await member.getByRole('textbox', { name: 'Edit action' }).fill('Review it with the team')
  await member.getByRole('textbox', { name: 'Edit action' }).press('Enter')
  await member.getByRole('checkbox', { name: 'Complete action: Draft the plan' }).click()
  await expect(member.getByRole('checkbox', { name: 'Reopen action: Draft the plan' })).toBeChecked()

  // G: a network failure keeps the typed text; Retry saves exactly once.
  let fail = true
  await member.route('**/masar.api.actions.add', async (route) => {
    if (fail) { fail = false; await route.abort('failed') } else { await route.continue() }
  })
  await add.fill('Survives a failure')
  await add.press('Enter')
  await expect(member.getByTestId('action-error')).toBeVisible()
  await expect(add).toHaveValue('Survives a failure')
  await member.getByTestId('action-error').getByRole('button', { name: 'Retry' }).click()
  await expect(member.getByRole('list', { name: 'Actions' }).getByText('Survives a failure', { exact: true })).toBeVisible()

  await member.reload()
  await expect(member.getByTestId('task-title')).toHaveValue(title)
  const actions = (await pageApi<{ data: TaskAction[] }>(member, 'masar.api.actions.list', { params: { task } })).body.data
  expect(actions.map(a => [a.title, a.isDone])).toEqual([
    ['Draft the plan', true], ['Review it with the team', false], ['Publish', false], ['Survives a failure', false]
  ])
  await expect(member.getByRole('checkbox', { name: 'Reopen action: Draft the plan' })).toBeChecked()

  // The list row expands to show the Actions.
  await member.getByRole('button', { name: 'Close panel' }).click()
  await member.getByRole('button', { name: `Show actions of ${title}` }).click()
  await expect(member.getByRole('listitem', { name: `Action of ${title}: Publish` })).toBeVisible()
  await member.context().close()
})

test('C: an Action is promoted to a task exactly once and stays linked', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const title = `${run} promote`
  const task = await createTask(member, title)
  await pageApi(member, 'masar.api.actions.add', { body: { task, title: `${run} promoted child` } })
  await member.goto(`/masar/tasks/${task}`)
  await member.getByRole('button', { name: `More options for ${run} promoted child` }).click()
  await member.getByRole('menuitem', { name: 'Promote to task' }).click()
  await expect(member.getByText('Promoted to a task', { exact: true })).toBeVisible()
  const link = member.getByRole('link', { name: 'Promoted task' })
  await expect(link).toBeVisible()

  const actions = (await pageApi<{ data: TaskAction[] }>(member, 'masar.api.actions.list', { params: { task } })).body.data
  const again = await pageApi<{ data: { created: boolean, task: TaskDetail } }>(member, 'masar.api.actions.promote', { body: { action: actions[0]!.name } })
  expect(again.body.data.created).toBe(false)
  expect(again.body.data.task.name).toBe(actions[0]!.promotedTask)

  await link.click()
  await expect(member).toHaveURL(new RegExp(`/tasks/${actions[0]!.promotedTask}$`))
  await expect(member.getByTestId('task-title')).toHaveValue(`${run} promoted child`)
  await expect(member.getByRole('link', { name: title })).toBeVisible() // "Promoted from" lineage
  await member.context().close()
})

test('D: a shared label is created, applied to several tasks and used as a filter', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const first = `${run} label one`
  const second = `${run} label two`
  await createTask(member, first)
  await createTask(member, second)
  await createTask(member, `${run} label none`)
  const labelName = `L-${Date.now().toString(36)}`

  await member.goto(`/masar/spaces/${alpha}/tasks?q=${encodeURIComponent(run)}`)
  await openTaskPanel(member, first)
  await member.getByRole('button', { name: 'Labels' }).click()
  await member.getByPlaceholder('Find a label, or type a new one to create it').fill(labelName)
  await member.getByRole('option', { name: new RegExp(`Create.*${labelName}`) }).click()
  await member.keyboard.press('Escape')
  await expect(member.getByRole('button', { name: 'Labels' })).toContainText(labelName)

  await member.getByRole('button', { name: 'Close panel' }).click()
  await openTaskPanel(member, second)
  await member.getByRole('button', { name: 'Labels' }).click()
  await member.getByPlaceholder('Find a label, or type a new one to create it').fill(labelName)
  await member.getByRole('option', { name: labelName, exact: true }).click()
  await member.keyboard.press('Escape')
  await member.getByRole('button', { name: 'Close panel' }).click()

  const labels = (await pageApi<{ data: Label[] }>(member, 'masar.api.labels.list', { params: { space: alpha } })).body.data
  expect(labels.filter(l => l.title === labelName)).toHaveLength(1)
  await member.getByRole('combobox', { name: 'Filter by label' }).click()
  await member.getByRole('option', { name: labelName }).click()
  const list = member.getByRole('list', { name: 'Tasks' })
  await expect(list.getByRole('listitem', { name: first })).toBeVisible()
  await expect(list.getByRole('listitem', { name: second })).toBeVisible()
  await expect(list.getByRole('listitem', { name: `${run} label none` })).toHaveCount(0)
  await member.context().close()
})

test('E: multi-selection drives an authorised bulk update without touching other tasks', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const names = [] as string[]
  for (const i of [1, 2, 3, 4]) names.push(await createTask(member, `${run} bulk ${i}`))
  await member.goto(`/masar/spaces/${alpha}/tasks?q=${encodeURIComponent(`${run} bulk`)}&sort=manual`)
  const list = member.getByRole('list', { name: 'Tasks' })
  await expect(list.getByRole('listitem')).toHaveCount(4)
  // Newest first: rows are bulk 4, 3, 2, 1. Select bulk 4, then Shift-select bulk 2.
  await list.getByRole('checkbox', { name: `Select ${run} bulk 4` }).click()
  await list.getByRole('checkbox', { name: `Select ${run} bulk 2` }).click({ modifiers: ['Shift'] })
  await expect(member.getByRole('toolbar', { name: 'Bulk actions for selected tasks' })).toContainText('3 selected')
  // Scrolling and re-filtering must not change the selection.
  await member.getByRole('button', { name: 'Priority' }).click()
  await member.getByRole('menuitem', { name: 'Highest' }).click()
  await expect(member.getByText('Priority set to Highest', { exact: true })).toBeVisible()

  const rows = (await pageApi<{ data: { items: TaskListRow[] } }>(member, 'masar.api.tasks.list', { params: { space: alpha, q: `${run} bulk`, limit: '50' } })).body.data.items
  const priority = Object.fromEntries(rows.map(r => [r.title, r.priority]))
  expect(priority).toEqual({
    [`${run} bulk 4`]: 'Highest', [`${run} bulk 3`]: 'Highest', [`${run} bulk 2`]: 'Highest', [`${run} bulk 1`]: 'Medium'
  })
  await member.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(member.getByRole('toolbar', { name: 'Bulk actions for selected tasks' })).toHaveCount(0)
  await member.context().close()
})

test('F: a user outside Space A sees none of its tasks through any Phase 3 path', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const title = `${run} secret`
  const task = await createTask(member, title, USERS.member)
  const action = (await pageApi<{ data: { action: TaskAction } }>(member, 'masar.api.actions.add', { body: { task, title: 'hidden step' } })).body.data.action
  const label = (await pageApi<{ data: { label: Label } }>(member, 'masar.api.labels.create', { body: { space: alpha, title: `${run}-secret` } })).body.data.label
  await member.context().close()

  const outsider = await asUser(browser, USERS.outsider)
  const work = await pageApi<{ data: { items: TaskListRow[] } }>(outsider, 'masar.api.tasks.my_work', { params: { completed: 'all', limit: '500' } })
  expect(work.body.data.items.map(t => t.name)).not.toContain(task)
  const search = await pageApi<{ data: TaskSearchResult[] }>(outsider, 'masar.api.tasks.search', { params: { q: title } })
  expect(search.body.data).toEqual([])
  expect((await pageApi<{ data: TaskSearchResult[] }>(outsider, 'masar.api.tasks.lookup', { params: { names: JSON.stringify([task]) } })).body.data).toEqual([])
  expect((await pageApi(outsider, 'masar.api.actions.list', { params: { task } })).status).toBe(404)
  expect((await pageApi(outsider, 'masar.api.actions.promote', { body: { action: action.name } })).status).toBe(404)
  expect((await pageApi(outsider, 'masar.api.labels.list', { params: { space: alpha } })).status).toBe(404)
  expect((await pageApi(outsider, 'masar.api.tasks.bulk_update', { body: { tasks: [task], operation: 'priority', value: 'Low' } })).status).toBe(404)
  const generic = await outsider.evaluate(async ({ action, label }) => {
    const read = await fetch(`/api/resource/Masar%20Task%20Action/${action}`)
    const labels = await fetch('/api/v2/document/Masar%20Label?fields=%5B%22name%22%5D&limit=1000').then(r => r.json())
    return { action: read.status, labelListed: labels.data.some((l: { name: string }) => l.name === label) }
  }, { action: action.name, label: label.name })
  expect(generic).toEqual({ action: 403, labelListed: false })

  // The sidebar search shows no inaccessible title.
  await outsider.goto('/masar/my-day')
  await outsider.getByRole('combobox', { name: 'Find tasks and Spaces' }).fill(title)
  await expect(outsider.getByRole('listbox', { name: 'Search results' }).getByText('Nothing found.')).toBeVisible()
  await expect(outsider.getByRole('option', { name: new RegExp(title) })).toHaveCount(0)
  await outsider.context().close()
})

test('sidebar search finds authorised tasks inline and navigates', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const title = `${run} palette`
  const task = await createTask(member, title)
  await member.goto('/masar/spaces')
  const search = member.getByRole('combobox', { name: 'Find tasks and Spaces' })
  await expect(search).toBeVisible()
  // ⌘K / Ctrl+K focuses the sidebar search (client revision 2: no dialog).
  await pressPaletteShortcut(member)
  await expect(search).toBeFocused()
  await search.fill(title)
  await member.getByRole('option', { name: new RegExp(title) }).click()
  await expect(member).toHaveURL(new RegExp(`/tasks/${task}$`))
  await expect(member.getByTestId('task-title')).toHaveValue(title)
  await expect(search).toHaveValue('')
  await member.context().close()
})

test('accessibility: no serious or critical axe violations on core Phase 3 screens', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const title = `${run} a11y`
  await createTask(member, title)
  await member.goto('/masar/tasks')
  await expect(member.getByRole('list', { name: 'Tasks' }).first()).toBeVisible()
  expect(await seriousViolations(member)).toEqual([])
  await member.goto(`/masar/spaces/${alpha}/tasks?q=${encodeURIComponent(title)}`)
  await openTaskPanel(member, title)
  expect(await seriousViolations(member)).toEqual([])
  await member.getByRole('button', { name: 'Close panel' }).click()
  await member.getByRole('combobox', { name: 'Find tasks and Spaces' }).fill(title)
  await expect(member.getByRole('option', { name: new RegExp(title) })).toBeVisible()
  expect(await seriousViolations(member)).toEqual([])
  await member.context().close()
})
