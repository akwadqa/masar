import { expect, test, type Browser, type Page } from '@playwright/test'
import type { SpaceSummary, TaskDetail, TimelinePage } from '../../app/types/api'
import { ALPHA, fillFrappeLogin, pageApi, password, pickDate, signIn, uniqueTitle, USERS } from './helpers'

// Phase 7 Workspace behaviour (directive §19): the Log time form against real Frappe data.
test.describe.configure({ mode: 'serial' })

const run = uniqueTitle('P7UI').replace(/\s+/g, '-')
let alpha = ''

async function asUser(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, email)
  return page
}
async function api<T>(page: Page, method: string, body?: Record<string, unknown>, params?: Record<string, string>) {
  return pageApi<{ data: T }>(page, method, { body, params })
}
async function newTask(page: Page, space: string, title: string) {
  return (await api<{ task: TaskDetail }>(page, 'masar.api.tasks.create', { space, title, client_request_id: crypto.randomUUID() })).body.data.task.name
}
const entriesOf = async (page: Page, task: string) =>
  (await api<TimelinePage>(page, 'masar.api.comments.timeline', undefined, { task, view: 'worklog', limit: '100' })).body.data.items.flatMap(i => (i.kind === 'time' ? [i.entry] : []))
const logButton = (page: Page) => page.getByRole('button', { name: 'Log time', exact: true }).last()

test.beforeAll(async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  alpha = (await api<SpaceSummary[]>(manager, 'masar.api.spaces.list')).body.data.find(s => s.title === ALPHA())!.name
  await manager.context().close()
})

test('a lost response is retried with the same request: the time is logged once', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const task = await newTask(member, alpha, `${run} retry`)
  await member.goto(`/masar/tasks/${task}`)
  await member.getByRole('button', { name: 'Log time' }).first().click()
  await member.getByTestId('log-duration').fill('40m')
  await expect(member.getByText('= 40m')).toBeVisible() // live parse feedback
  await member.getByLabel('Work note').fill('Network dropped')
  // The server saves the entry but the browser never sees the answer.
  let dropped = 0
  await member.route('**/api/v2/method/masar.api.time.log', async (route) => {
    if (dropped++ === 0) { await route.fetch(); return route.abort('connectionreset') }
    return route.continue()
  })
  await logButton(member).click()
  await expect(member.getByRole('alert')).toBeVisible()
  await expect(member.getByTestId('log-duration')).toHaveValue('40m') // draft kept
  await member.reload() // even a reload keeps the draft and its request id
  await member.getByRole('button', { name: 'Log time' }).first().click()
  await expect(member.getByTestId('log-duration')).toHaveValue('40m')
  await logButton(member).click()
  await expect(member.getByText('40m logged', { exact: true })).toBeVisible()
  expect((await entriesOf(member, task)).map(e => e.minutes)).toEqual([40])
  expect((await api<TaskDetail>(member, 'masar.api.tasks.get', undefined, { task })).body.data.loggedMinutes).toBe(40)
  await member.context().close()
})

test('double-clicking Log time saves one entry; invalid and future input never reach the server', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const task = await newTask(member, alpha, `${run} double`)
  await member.goto(`/masar/tasks/${task}`)
  await member.getByRole('button', { name: 'Log time' }).first().click()
  const sent: string[] = []
  member.on('request', r => { if (r.url().includes('masar.api.time.log')) sent.push(r.url()) })
  for (const [input, message] of [['', 'Enter how long you worked'], ['25h', '24 hours'], ['abc', 'such as 30m']] as const) {
    await member.getByTestId('log-duration').fill(input)
    await logButton(member).click()
    await expect(member.getByRole('alert')).toContainText(message)
  }
  expect(sent).toEqual([])
  await member.getByTestId('log-duration').fill('1:15')
  await logButton(member).dblclick()
  await expect(member.getByText('1h 15m logged', { exact: true })).toBeVisible()
  await expect(member.getByTestId('logged-total')).toContainText('1h 15m')
  expect((await entriesOf(member, task)).length).toBe(1)
  await member.context().close()
})

test('work date selection with the calendar; future dates are not selectable', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const task = await newTask(member, alpha, `${run} dates`)
  await member.goto(`/masar/tasks/${task}`)
  await member.getByRole('button', { name: 'Log time' }).first().click()
  const qatarToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar' }).format(new Date())
  const shift = (days: number) => {
    const date = new Date(`${qatarToday}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
  }
  // The calendar refuses days after the Qatar business date (client revision 3: a date picker).
  await member.getByRole('button', { name: 'Work date' }).click()
  const tomorrow = member.locator(`[data-value="${shift(1)}"]:not([data-outside-view])`)
  if (await tomorrow.count()) await expect(tomorrow).toHaveAttribute('data-disabled', /.*/)
  await member.keyboard.press('Escape')
  // Yesterday through the calendar.
  await member.getByTestId('log-duration').fill('15m')
  await pickDate(member, member, 'Work date', shift(-1))
  await logButton(member).click()
  await expect(member.getByText('15m logged', { exact: true })).toBeVisible()
  expect((await entriesOf(member, task)).find(e => e.minutes === 15)?.workDate).toBe(shift(-1))
  await member.context().close()
})

test('session expiry keeps the draft; after signing in again it is still there', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const task = await newTask(member, alpha, `${run} expiry`)
  await member.goto(`/masar/tasks/${task}`)
  await member.getByRole('button', { name: 'Log time' }).first().click()
  await member.getByTestId('log-duration').fill('2h')
  await member.getByLabel('Work note').fill('Before the session ended')
  await member.context().clearCookies()
  await logButton(member).click()
  await member.waitForURL(/\/login/)
  await fillFrappeLogin(member, USERS.member, password())
  await member.waitForURL(new RegExp(`/masar/tasks/${task}`))
  await member.getByRole('button', { name: 'Log time' }).first().click()
  await expect(member.getByTestId('log-duration')).toHaveValue('2h')
  await expect(member.getByLabel('Work note')).toHaveValue('Before the session ended')
  expect(await entriesOf(member, task)).toEqual([]) // nothing was saved while signed out
  await logButton(member).click()
  await expect(member.getByText('2h logged', { exact: true })).toBeVisible()
  await member.context().close()
})

test('a rejected save changes nothing on screen (no optimistic total)', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  const task = await newTask(member, alpha, `${run} reject`)
  await member.goto(`/masar/tasks/${task}`)
  await member.getByRole('button', { name: 'Log time' }).first().click()
  await member.getByTestId('log-duration').fill('30m')
  await member.getByLabel('Update remaining estimate').check()
  await member.getByTestId('log-remaining').fill('1h')
  // Someone else sets an estimate meanwhile.
  const manager = await asUser(browser, USERS.manager)
  await api(manager, 'masar.api.tasks.update', { task, changes: { remainingMinutes: 300 } })
  await logButton(member).click()
  await expect(member.getByRole('alert')).toContainText('Your time was not logged')
  await expect(member.getByTestId('logged-total')).toContainText('0m')
  await expect(member.getByTestId('remaining-estimate')).toContainText('5h') // refreshed to the real value
  expect(await entriesOf(member, task)).toEqual([])
  for (const page of [member, manager]) await page.context().close()
})

test('read-only Spaces show the Worklog without logging controls', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const gamma = (await api<SpaceSummary[]>(manager, 'masar.api.spaces.list')).body.data.find(s => s.title === process.env.E2E_GAMMA)!.name
  const task = await newTask(manager, gamma, `${run} read-only`)
  await api(manager, 'masar.api.time.log', { task, duration: 50, client_request_id: crypto.randomUUID(), description: 'Before completion' })
  expect((await api(manager, 'masar.api.spaces.set_status', { space: gamma, status: 'Completed', expected_status: 'In Progress' })).status).toBe(200)
  try {
    const member = await asUser(browser, USERS.outsider) // a Member of Gamma
    await member.goto(`/masar/tasks/${task}`)
    await expect(member.getByTestId('logged-total')).toContainText('50m')
    await expect(member.getByRole('button', { name: 'Log time' })).toHaveCount(0)
    await member.getByRole('tab', { name: 'Worklog' }).click()
    const entry = member.locator('[data-time-entry]').first()
    await expect(entry).toContainText('Before completion')
    await expect(entry.getByRole('button', { name: /Actions for time entry/ })).toHaveCount(0)
    await member.context().close()
  } finally {
    expect((await api(manager, 'masar.api.spaces.set_status', { space: gamma, status: 'In Progress', expected_status: 'Completed' })).status).toBe(200)
    await manager.context().close()
  }
})
