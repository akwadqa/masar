import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import type { Feature, FeatureDetail, PlanningList, ReleaseDetail, SpaceSummary, TaskDetail } from '../../app/types/api'
import { ALPHA, BETA, USERS, pageApi, signIn, uniqueTitle, pickDate } from './helpers'

// Phase 4 acceptance scenarios A–L (docs/phases/phase-4.md): Features roadmap, Releases and their
// Task links. Scenario K (regression) is the Phase 1–3 suites, run in the same invocation.
test.describe.configure({ mode: 'serial' })

let alpha = ''
let beta = ''
const run = uniqueTitle('P4').replace(/\s+/g, '-')

async function asUser(browser: Browser, email: string, viewport?: { width: number, height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage()
  await signIn(page, email)
  return page
}

async function api<T>(page: Page, method: string, body?: Record<string, unknown>, params?: Record<string, string>) {
  return pageApi<{ data: T }>(page, method, { body, params })
}

async function createTask(page: Page, title: string, space = alpha): Promise<string> {
  const created = await api<{ task: TaskDetail }>(page, 'masar.api.tasks.create', { space, title, client_request_id: crypto.randomUUID() })
  expect(created.status).toBe(200)
  return created.body.data.task.name
}

async function createFeature(page: Page, title: string, roadmap = 'Later', space = alpha): Promise<string> {
  const created = await api<FeatureDetail>(page, 'masar.api.features.create', { space, title, roadmap })
  expect(created.status).toBe(200)
  return created.body.data.name
}

async function featureState(page: Page, name: string) {
  return (await api<FeatureDetail>(page, 'masar.api.features.get', undefined, { feature: name })).body.data
}

const column = (page: Page, name: string) => page.getByTestId(`roadmap-column-${name}`)
const card = (scope: Page | Locator, title: string) => scope.getByRole('listitem', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`) })

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  return results.violations
    .filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)
}

test.beforeAll(async ({ browser }) => {
  const page = await asUser(browser, USERS.manager)
  const spaces = (await api<SpaceSummary[]>(page, 'masar.api.spaces.list')).body.data
  alpha = spaces.find(s => s.title === ALPHA())!.name
  await page.context().close()
  const outsider = await asUser(browser, USERS.outsider)
  beta = (await api<SpaceSummary[]>(outsider, 'masar.api.spaces.list')).body.data.find(s => s.title === BETA())!.name
  await outsider.context().close()
})

test('A: a Manager creates a Feature in Now and sees it on the roadmap', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/spaces/${alpha}/roadmap`)
  await expect(manager.getByRole('link', { name: 'Roadmap' })).toHaveAttribute('aria-current', 'page')
  // A fresh Space starts with an explanatory empty state.
  await expect(manager.getByText('No Features yet')).toBeVisible()
  await manager.getByRole('button', { name: 'New Feature' }).last().click()
  const title = `${run} sign-on`
  await manager.getByRole('dialog').getByRole('textbox').first().fill(title)
  await manager.getByRole('dialog').getByRole('combobox').click()
  await manager.getByRole('option', { name: 'Now' }).click()
  await manager.getByRole('button', { name: 'Create Feature' }).click()
  await expect(card(column(manager, 'Now'), title)).toBeVisible()
  await expect(card(column(manager, 'Now'), title)).toContainText('No tasks yet')

  // Members see the roadmap but cannot manage it.
  const member = await asUser(browser, USERS.member)
  await member.goto(`/masar/spaces/${alpha}/roadmap`)
  await expect(card(column(member, 'Now'), title)).toBeVisible()
  await expect(member.getByRole('button', { name: 'New Feature' })).toHaveCount(0)
  await expect(member.getByRole('button', { name: `Move ${title}` })).toHaveCount(0)
  await member.context().close()
  await manager.context().close()
})

test('B: drag and drop moves a Feature from Now to Next and the move persists', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const title = `${run} drag`
  const name = await createFeature(manager, title, 'Now')
  await manager.goto(`/masar/spaces/${alpha}/roadmap`)
  const source = card(column(manager, 'Now'), title)
  const target = column(manager, 'Next').getByRole('list')
  await source.scrollIntoViewIfNeeded()
  const from = (await source.boundingBox())!
  const to = (await target.boundingBox())!
  await manager.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await manager.mouse.down()
  await manager.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 })
  await manager.mouse.move(to.x + to.width / 2, to.y + to.height - 10, { steps: 20 })
  await manager.mouse.up()
  await expect(card(column(manager, 'Next'), title)).toBeVisible()
  await expect.poll(async () => (await featureState(manager, name)).roadmap).toBe('Next')
  await manager.reload()
  await expect(card(column(manager, 'Next'), title)).toBeVisible()
  await expect(card(column(manager, 'Now'), title)).toHaveCount(0)
  await manager.context().close()
})

test('C: the menu and keyboard move a Feature without dragging', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const title = `${run} keyboard`
  const name = await createFeature(manager, title, 'Next')
  await manager.goto(`/masar/spaces/${alpha}/roadmap`)
  // Menu: open it from the keyboard and choose a column.
  await manager.getByRole('button', { name: `Move ${title}` }).focus()
  await manager.keyboard.press('Enter')
  await manager.getByRole('menuitem', { name: 'Move to Later' }).focus()
  await manager.keyboard.press('Enter')
  await expect(card(column(manager, 'Later'), title)).toBeVisible()
  await expect.poll(async () => (await featureState(manager, name)).roadmap).toBe('Later')
  // Keyboard shortcut on the focused card: Alt+← moves one column left.
  await card(column(manager, 'Later'), title).focus()
  await manager.keyboard.press('Alt+ArrowLeft')
  await expect(card(column(manager, 'Next'), title)).toBeVisible()
  await expect(manager.getByText(`${title} moved to Next`)).toBeAttached()
  await expect.poll(async () => (await featureState(manager, name)).roadmap).toBe('Next')
  // Enter opens the details with a shareable URL.
  await card(column(manager, 'Next'), title).focus()
  await manager.keyboard.press('Enter')
  await expect(manager).toHaveURL(new RegExp(`feature=${name}`))
  await expect(manager.getByLabel('Feature title')).toHaveValue(title)
  await manager.context().close()
})

test('D: Feature progress follows task completion and never changes the roadmap', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const title = `${run} progress`
  const feature = await createFeature(manager, title, 'Now')
  const t1 = await createTask(manager, `${run} progress one`)
  const t2 = await createTask(manager, `${run} progress two`)
  for (const task of [t1, t2]) {
    expect((await api(manager, 'masar.api.tasks.update', { task, changes: { feature } })).status).toBe(200)
  }
  await manager.goto(`/masar/features/${feature}`)
  await expect(manager.getByText('0/2')).toBeVisible()
  // Complete one task from the Task List; reopen it again.
  await manager.goto(`/masar/spaces/${alpha}/tasks?feature=${feature}`)
  await manager.locator(`[data-task="${t1}"]`).getByRole('button', { name: /^Status: Open\. Change status/ }).click()
  await manager.getByRole('menuitem', { name: 'Completed' }).click()
  await expect.poll(async () => (await featureState(manager, feature)).progress.completed).toBe(1)
  await manager.goto(`/masar/features/${feature}`)
  await expect(manager.getByText('1/2')).toBeVisible()
  expect((await featureState(manager, feature)).progress.percent).toBe(50)
  expect((await api(manager, 'masar.api.tasks.set_completed', { task: t1, completed: false })).status).toBe(200)
  await manager.reload()
  await expect(manager.getByText('0/2')).toBeVisible()
  expect((await featureState(manager, feature)).roadmap).toBe('Now')

  // Moving to Done with open tasks warns and leaves the tasks open.
  await manager.getByRole('combobox', { name: 'Roadmap column' }).click()
  await manager.getByRole('option', { name: 'Done' }).click()
  await expect(manager.getByRole('dialog', { name: 'Move to Done with open tasks?' })).toBeVisible()
  await manager.getByRole('button', { name: 'Move to Done' }).click()
  await expect(manager.getByText('Done with 2 open tasks')).toBeVisible()
  const t1Detail = (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: t1 })).body.data
  expect(t1Detail.isCompleted).toBe(false)
  await manager.context().close()
})

test('E: a task is linked to a Feature of its Space; another Space is rejected', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const manager = await asUser(browser, USERS.manager)
  const featureTitle = `${run} relation`
  const feature = await createFeature(manager, featureTitle)
  const taskTitle = `${run} relation task`
  const task = await createTask(member, taskTitle)
  await member.goto(`/masar/spaces/${alpha}/tasks?q=${encodeURIComponent(taskTitle)}`)
  await member.getByRole('list', { name: 'Tasks' }).getByRole('listitem', { name: taskTitle }).getByText(taskTitle, { exact: true }).click()
  await member.getByTestId('task-feature').click()
  // Client revision 3: the Feature is an icon in the Task header with a chooser behind it.
  await member.getByRole('button', { name: new RegExp(`^${featureTitle} (Now|Next|Later|Done)$`) }).click()
  await expect(member.getByTestId('task-feature')).toHaveAttribute('aria-label', `Feature: ${featureTitle}`)
  await expect.poll(async () => (await api<TaskDetail>(member, 'masar.api.tasks.get', undefined, { task })).body.data.feature?.name).toBe(feature)
  // The Feature lists the task.
  await member.goto(`/masar/features/${feature}`)
  await expect(member.getByRole('link', { name: new RegExp(taskTitle) })).toBeVisible()

  // A Feature of another Space (Beta, owned by the outsider) cannot be linked.
  const outsider = await asUser(browser, USERS.outsider)
  const foreign = await createFeature(outsider, `${run} foreign`, 'Now', beta)
  const rejected = await api(member, 'masar.api.tasks.update', { task, changes: { feature: foreign } })
  expect(rejected.status).toBe(417)
  expect((await api<TaskDetail>(member, 'masar.api.tasks.get', undefined, { task })).body.data.feature?.name).toBe(feature)
  for (const page of [member, manager, outsider]) await page.context().close()
})

test('F + G: a Release is created, released with a warning, archived read-only and restored', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const releaseName = `${run}-v1.0`
  await manager.goto(`/masar/spaces/${alpha}/releases`)
  await manager.getByRole('button', { name: 'New Release' }).first().click()
  await manager.getByRole('dialog').getByRole('textbox').first().fill(releaseName)
  await pickDate(manager.getByRole('dialog'), manager, 'Release date', '2026-12-15')
  await manager.getByRole('button', { name: 'Create Release' }).click()
  const row = manager.getByRole('row', { name: new RegExp(releaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
  await expect(row).toContainText('Planned')
  await expect(row).toContainText('Dec 15, 2026')

  // Version uniqueness ignores case and spacing.
  await manager.getByRole('button', { name: 'New Release' }).first().click()
  await manager.getByRole('dialog').getByRole('textbox').first().fill(`  ${releaseName.toUpperCase()} `)
  await manager.getByRole('button', { name: 'Create Release' }).click()
  await expect(manager.getByRole('alert')).toContainText('already exists')
  await manager.keyboard.press('Escape')

  const releases = (await api<PlanningList<ReleaseDetail>>(manager, 'masar.api.releases.list', undefined, { space: alpha, q: releaseName })).body.data.items
  const release = releases[0]!.name
  const task = await createTask(manager, `${run} release task`)
  expect((await api(manager, 'masar.api.tasks.update', { task, changes: { release } })).status).toBe(200)

  // Members can open it but not change its lifecycle.
  const member = await asUser(browser, USERS.member)
  await member.goto(`/masar/releases/${release}`)
  await expect(member.getByLabel('Release name')).toBeDisabled()
  await expect(member.getByRole('button', { name: 'Mark as released' })).toHaveCount(0)
  expect((await api(member, 'masar.api.releases.set_status', { release, status: 'Released' })).status).toBe(403)
  await member.context().close()

  await manager.goto(`/masar/releases/${release}`)
  await manager.getByRole('button', { name: 'Mark as released' }).click()
  await expect(manager.getByRole('dialog', { name: 'Release with open tasks?' })).toBeVisible()
  await manager.getByRole('dialog').getByRole('button', { name: 'Mark as released' }).click()
  await expect(manager.getByText('Released', { exact: true }).first()).toBeVisible()
  expect((await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task })).body.data.isCompleted).toBe(false)

  await manager.getByRole('button', { name: 'Archive' }).click()
  await manager.getByRole('dialog').getByRole('button', { name: 'Archive' }).click()
  await expect(manager.getByText('This Release is archived')).toBeVisible()
  await expect(manager.getByLabel('Release name')).toBeDisabled()
  // Archived: links are frozen in both directions.
  expect((await api(manager, 'masar.api.tasks.update', { task, changes: { release: null } })).status).toBe(417)
  const other = await createTask(manager, `${run} too late`)
  expect((await api(manager, 'masar.api.tasks.update', { task: other, changes: { release } })).status).toBe(417)
  await manager.getByRole('button', { name: 'Restore as Released' }).click()
  await expect(manager.getByText('This Release is archived')).toHaveCount(0)
  await manager.context().close()
})

test('H: bulk assignment puts several tasks into a Release and every view agrees', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const releaseName = `${run}-bulk`
  const release = (await api<ReleaseDetail>(manager, 'masar.api.releases.create', { space: alpha, release_name: releaseName })).body.data.name
  const titles = [`${run} bulk a`, `${run} bulk b`, `${run} bulk c`]
  const tasks = []
  for (const title of titles) tasks.push(await createTask(manager, title))
  await manager.goto(`/masar/spaces/${alpha}/tasks?q=${encodeURIComponent(`${run} bulk`)}`)
  for (const title of titles.slice(0, 2)) await manager.getByRole('checkbox', { name: `Select ${title}` }).click()
  await manager.getByRole('toolbar', { name: 'Bulk actions for selected tasks' }).getByRole('button', { name: 'Release' }).click()
  await manager.getByRole('menuitem', { name: new RegExp(releaseName) }).click()
  await expect(manager.getByText('2 of 2 tasks changed.', { exact: true })).toBeVisible()
  await expect(manager.getByLabel(`Release: ${releaseName}`)).toHaveCount(2)
  // The Release filter and the Release detail show the same two tasks.
  await manager.goto(`/masar/spaces/${alpha}/tasks?release=${release}&show=all`)
  await expect(manager.getByRole('list', { name: 'Tasks' }).getByRole('listitem')).toHaveCount(2)
  await manager.goto(`/masar/releases/${release}`)
  await expect(manager.getByText('0/2')).toBeVisible()
  for (const title of titles.slice(0, 2)) await expect(manager.getByRole('link', { name: new RegExp(title) })).toBeVisible()
  const third = (await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task: tasks[2]! })).body.data
  expect(third.release).toBeNull()
  await manager.context().close()
})

test('I: Features and Releases of a Space stay invisible to non-members on every path', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const feature = await createFeature(manager, `${run} secret`)
  const release = (await api<ReleaseDetail>(manager, 'masar.api.releases.create', { space: alpha, release_name: `${run}-secret` })).body.data.name
  await manager.context().close()

  const outsider = await asUser(browser, USERS.outsider)
  for (const [method, params] of [
    ['masar.api.features.list', { space: alpha }],
    ['masar.api.features.get', { feature }],
    ['masar.api.releases.list', { space: alpha }],
    ['masar.api.releases.get', { release }],
    ['masar.api.tasks.list', { space: alpha, feature }]
  ] as const) {
    expect((await pageApi(outsider, method, { params: params as Record<string, string> })).status, method).toBe(404)
  }
  for (const [method, body] of [
    ['masar.api.features.move', { feature, roadmap: 'Done' }],
    ['masar.api.features.update', { feature, changes: { title: 'x' } }],
    ['masar.api.releases.set_status', { release, status: 'Archived' }],
    ['masar.api.releases.delete', { release, detach: true }]
  ] as const) {
    expect((await pageApi(outsider, method, { body })).status, method).toBe(404)
  }
  // Generic Frappe document APIs: list is filtered, direct reads and writes are refused.
  const listed = await outsider.evaluate(async () => (await fetch('/api/resource/Masar Feature?limit_page_length=500')).json())
  expect(JSON.stringify(listed)).not.toContain(feature)
  const direct = await outsider.evaluate(async name => (await fetch(`/api/resource/Masar Feature/${name}`)).status, feature)
  expect(direct).toBe(403)
  const search = await outsider.evaluate(async () => (await fetch('/api/method/frappe.desk.search.search_link?doctype=Masar%20Release&txt=')).json())
  expect(JSON.stringify(search)).not.toContain(release)
  // The shareable URL reveals nothing.
  await outsider.goto(`/masar/features/${feature}`)
  await expect(outsider.getByText('Feature not found')).toBeVisible()
  await outsider.goto(`/masar/releases/${release}`)
  await expect(outsider.getByText('Release not found')).toBeVisible()
  await outsider.context().close()
})

test('J: failed moves, Release edits and bulk changes leave no wrong state behind', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const title = `${run} failing`
  const name = await createFeature(manager, title, 'Now')
  await manager.goto(`/masar/spaces/${alpha}/roadmap`)
  await manager.route('**/masar.api.features.move', route => route.fulfill({ status: 500, body: '{}' }))
  await manager.getByRole('button', { name: `Move ${title}` }).click()
  await manager.getByRole('menuitem', { name: 'Move to Later' }).click()
  await expect(card(column(manager, 'Now'), title)).toBeVisible()
  await expect(card(column(manager, 'Later'), title)).toHaveCount(0)
  await manager.unroute('**/masar.api.features.move')
  expect((await featureState(manager, name)).roadmap).toBe('Now')

  // Concurrent move: the second client's stale view gets a conflict and is refreshed.
  const other = await asUser(browser, USERS.manager)
  expect((await api(other, 'masar.api.features.move', { feature: name, roadmap: 'Done', expected_roadmap: 'Now' })).status).toBe(200)
  await manager.getByRole('button', { name: `Move ${title}` }).click()
  await manager.getByRole('menuitem', { name: 'Move to Next' }).click()
  await expect(manager.getByText('The roadmap changed', { exact: true })).toBeVisible()
  await expect(card(column(manager, 'Done'), title)).toBeVisible()
  expect((await featureState(manager, name)).roadmap).toBe('Done')
  await other.context().close()

  // A duplicate Release name is refused inline and the field returns to the stored value.
  const first = (await api<ReleaseDetail>(manager, 'masar.api.releases.create', { space: alpha, release_name: `${run}-r1` })).body.data
  const second = (await api<ReleaseDetail>(manager, 'masar.api.releases.create', { space: alpha, release_name: `${run}-r2` })).body.data
  await manager.goto(`/masar/releases/${second.name}`)
  await manager.getByLabel('Release name').fill(first.releaseName.toUpperCase())
  await manager.getByLabel('Release name').press('Enter')
  await expect(manager.getByRole('alert')).toContainText('already exists')
  await expect(manager.getByLabel('Release name')).toHaveValue(second.releaseName)

  // A failed bulk assignment changes nothing.
  const task = await createTask(manager, `${run} bulk fail`)
  await manager.goto(`/masar/spaces/${alpha}/tasks?q=${encodeURIComponent(`${run} bulk fail`)}`)
  await manager.route('**/masar.api.tasks.bulk_update', route => route.fulfill({ status: 500, body: '{}' }))
  await manager.getByRole('checkbox', { name: `Select ${run} bulk fail` }).click()
  await manager.getByRole('toolbar', { name: 'Bulk actions for selected tasks' }).getByRole('button', { name: 'Feature' }).click()
  await manager.getByRole('menuitem').first().click()
  await expect(manager.getByLabel(/^Feature: /)).toHaveCount(0)
  expect((await api<TaskDetail>(manager, 'masar.api.tasks.get', undefined, { task })).body.data.feature).toBeNull()
  await manager.context().close()
})

test('L: narrow phones: All Tasks fits the screen, the board and Releases are usable', async ({ browser }) => {
  const phone = { width: 360, height: 740 }
  const member = await asUser(browser, USERS.member, phone)
  await member.goto('/masar/tasks')
  await expect(member.getByRole('button', { name: 'Assigned to me' })).toBeVisible()
  const overflow = await member.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await member.context().close()

  const manager = await asUser(browser, USERS.manager, phone)
  const title = `${run} phone`
  const name = await createFeature(manager, title, 'Later')
  await manager.goto(`/masar/spaces/${alpha}/roadmap`)
  await expect(column(manager, 'Now')).toBeVisible()
  await column(manager, 'Later').scrollIntoViewIfNeeded()
  await manager.getByRole('button', { name: `Move ${title}` }).click()
  await manager.getByRole('menuitem', { name: 'Move to Next' }).click()
  await expect.poll(async () => (await featureState(manager, name)).roadmap).toBe('Next')
  expect((await api(manager, 'masar.api.releases.create', { space: alpha, release_name: `${run}-phone` })).status).toBe(200)
  await manager.goto(`/masar/spaces/${alpha}/releases`)
  await expect(manager.getByRole('table')).toBeVisible()
  // Six Space tabs scroll sideways instead of truncating, and the current one is in view.
  const truncated = await manager.locator('nav a span').evaluateAll(spans => spans.filter(s => s.scrollWidth > s.clientWidth + 1).length)
  expect(truncated).toBe(0)
  await expect(manager.getByRole('link', { name: 'Releases' })).toBeInViewport()
  await manager.context().close()
})

test('accessibility: no serious or critical axe violations on Phase 4 screens', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const feature = await createFeature(manager, `${run} axe`, 'Now')
  const release = (await api<ReleaseDetail>(manager, 'masar.api.releases.create', { space: alpha, release_name: `${run}-axe` })).body.data.name
  const screens = [`/masar/spaces/${alpha}/roadmap`, `/masar/features/${feature}`, `/masar/spaces/${alpha}/releases`, `/masar/releases/${release}`]
  for (const path of screens) {
    await manager.goto(path)
    await manager.waitForLoadState('networkidle')
    expect(await seriousViolations(manager), path).toEqual([])
  }
  const items = (await api<PlanningList<Feature>>(manager, 'masar.api.features.list', undefined, { space: alpha })).body.data.items
  expect(items.length).toBeGreaterThan(0)
  await manager.context().close()
})
