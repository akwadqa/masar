import { expect, test, type Browser, type Page } from '@playwright/test'
import type { SpaceSummary, TaskDetail } from '../../app/types/api'
import { USERS, pageApi, signIn, uniqueTitle } from './helpers'

// Client request 2026-10-30 (docs/qa/feature-version-independent-panels-report.md): the Features and
// Versions panels of a Space Task List open and close independently and can be open together:
// [Features][Versions][Tasks] on wide screens, side by side above the list on narrower ones and on
// phones, where the list keeps the room QA-D01 gives it. Opening or closing a panel never changes the
// selected Feature or Version.
test.describe.configure({ mode: 'serial' })

const run = uniqueTitle('FVP').replace(/\s+/g, '-')
const LONG_FEATURE = `${run} feature with a very long name that keeps going beyond any narrow phone column`
const LONG_VERSION = `${run} exceptionally long name for narrow phones`.slice(0, 80)
const spaces = { full: '', empty: '' }
const items = { feature: '', release: '' }
const PHONES = [[320, 568], [360, 640], [375, 667], [390, 664], [390, 844], [412, 839], [430, 932]] as const

async function asUser(browser: Browser, email: string, viewport: { width: number, height: number }, path?: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport, hasTouch: viewport.width < 600 })).newPage()
  await signIn(page, email, undefined, path)
  return page
}
async function api<T>(page: Page, method: string, body?: Record<string, unknown>) {
  return pageApi<{ data: T }>(page, method, { body })
}

const toggle = (page: Page, name: 'Features' | 'Versions') => page.getByRole('button', { name: `${name} panel`, exact: true })
const panel = (page: Page, name: 'Features' | 'Versions') => page.getByRole('complementary', { name: `${name} filter` })
const list = (page: Page) => page.getByRole('list', { name: 'Tasks' })
const box = async (page: Page, name: 'Features' | 'Versions') => (await panel(page, name).boundingBox())!

async function expectOpen(page: Page, features: boolean, versions: boolean) {
  await expect(panel(page, 'Features')).toHaveCount(features ? 1 : 0)
  await expect(panel(page, 'Versions')).toHaveCount(versions ? 1 : 0)
  await expect(toggle(page, 'Features')).toHaveAttribute('aria-pressed', String(features))
  await expect(toggle(page, 'Versions')).toHaveAttribute('aria-pressed', String(versions))
}

/** The page never scrolls sideways: no content is wider than the window. */
const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

/** `name`'s Close button is on screen and is what a tap at its centre reaches. */
async function closeReachable(page: Page, name: 'Features' | 'Versions') {
  const close = page.getByRole('button', { name: `Close ${name} panel` })
  await expect(close).toBeInViewport({ ratio: 1 })
  return close.evaluate((node) => {
    const r = node.getBoundingClientRect()
    return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  })
}

test.beforeAll(async ({ browser }) => {
  const admin = await asUser(browser, USERS.admin, { width: 1440, height: 900 })
  for (const key of ['full', 'empty'] as const) {
    spaces[key] = (await api<SpaceSummary>(admin, 'masar.api.spaces.create', { data: { title: `${run} ${key}`, owner: USERS.manager, category: 'Verification' } })).body.data.name
  }
  await admin.context().close()
  const manager = await asUser(browser, USERS.manager, { width: 1440, height: 900 })
  const features: string[] = []
  for (const title of [LONG_FEATURE, ...Array.from({ length: 11 }, (_, i) => `${run} F${i + 1}`)]) {
    features.push((await api<{ name: string }>(manager, 'masar.api.features.create', { space: spaces.full, title, roadmap: 'Now' })).body.data.name)
  }
  const releases: string[] = []
  for (const release_name of [LONG_VERSION, ...Array.from({ length: 9 }, (_, i) => `${run} V${i + 1}`)]) {
    releases.push((await api<{ name: string }>(manager, 'masar.api.releases.create', { space: spaces.full, release_name })).body.data.name)
  }
  items.feature = features[1]!
  items.release = releases[1]!
  // 40 Tasks: every 4th has F1 and V1; others have only one of them or none.
  for (let i = 0; i < 40; i++) {
    const task = (await api<{ task: TaskDetail }>(manager, 'masar.api.tasks.create', { space: spaces.full, title: `${run} task ${i}`, client_request_id: crypto.randomUUID() })).body.data.task.name
    const changes: Record<string, string> = {}
    if (i % 2 === 0) changes.feature = features[1]!
    if (i % 4 === 0 || i % 4 === 1) changes.release = releases[1]!
    if (Object.keys(changes).length) expect((await api(manager, 'masar.api.tasks.update', { task, changes })).status).toBe(200)
  }
  await manager.context().close()
})

test('every open and close transition: buttons and Close keep the other panel as it is', async ({ browser }) => {
  const page = await asUser(browser, USERS.manager, { width: 1440, height: 900 }, `/masar/spaces/${spaces.full}/tasks`)
  await expect(list(page).locator('[data-task]').first()).toBeVisible()
  await expectOpen(page, false, false)
  await toggle(page, 'Features').click(); await expectOpen(page, true, false) // neither → Features
  await toggle(page, 'Versions').click(); await expectOpen(page, true, true) // Features → both
  await toggle(page, 'Features').click(); await expectOpen(page, false, true) // both → Versions remains
  await toggle(page, 'Features').click(); await expectOpen(page, true, true) // Versions → both
  await toggle(page, 'Versions').click(); await expectOpen(page, true, false) // both → Features remains
  await toggle(page, 'Features').click(); await expectOpen(page, false, false) // Features → neither
  await toggle(page, 'Versions').click(); await expectOpen(page, false, true) // neither → Versions
  await toggle(page, 'Versions').click(); await expectOpen(page, false, false) // Versions → neither
  // Close buttons (X).
  await toggle(page, 'Features').click(); await toggle(page, 'Versions').click(); await expectOpen(page, true, true)
  await page.getByRole('button', { name: 'Close Features panel' }).click(); await expectOpen(page, false, true)
  await toggle(page, 'Features').click(); await expectOpen(page, true, true)
  await page.getByRole('button', { name: 'Close Versions panel' }).click(); await expectOpen(page, true, false)
  await page.getByRole('button', { name: 'Close Features panel' }).click(); await expectOpen(page, false, false)
  await toggle(page, 'Versions').click()
  await page.getByRole('button', { name: 'Close Versions panel' }).click(); await expectOpen(page, false, false)
  await page.context().close()
})

test('F and V toggle each panel independently, not while typing; Escape in a panel closes only that one', async ({ browser }) => {
  const page = await asUser(browser, USERS.manager, { width: 1440, height: 900 }, `/masar/spaces/${spaces.full}/tasks`)
  await expect(list(page).locator('[data-task]').first()).toBeVisible()
  await page.getByLabel('Search tasks').fill('fv')
  await expectOpen(page, false, false)
  await page.getByLabel('Search tasks').fill('')
  await page.getByLabel('Search tasks').blur()
  await page.keyboard.press('f'); await expectOpen(page, true, false)
  await page.keyboard.press('v'); await expectOpen(page, true, true)
  await page.keyboard.press('f'); await expectOpen(page, false, true)
  await page.keyboard.press('f'); await expectOpen(page, true, true)
  await page.keyboard.press('v'); await expectOpen(page, true, false)
  await page.keyboard.press('v'); await expectOpen(page, true, true)
  // Typing in a panel's search box does not toggle panels.
  await panel(page, 'Versions').getByRole('textbox').fill('vf')
  await expectOpen(page, true, true)
  await panel(page, 'Versions').getByRole('textbox').press('Escape')
  await expectOpen(page, true, false)
  await page.context().close()
})

test('selections survive opening and closing panels; Feature and Version filter together', async ({ browser }) => {
  const page = await asUser(browser, USERS.manager, { width: 1440, height: 900 }, `/masar/spaces/${spaces.full}/tasks`)
  await expect(list(page).locator('[data-task]').first()).toBeVisible()
  await toggle(page, 'Features').click()
  await panel(page, 'Features').getByRole('option', { name: new RegExp(`${run} F1\\b`) }).click()
  await expect(page).toHaveURL(new RegExp(`feature=${items.feature}`))
  await expect(list(page).locator('[data-task]')).toHaveCount(20)
  await toggle(page, 'Versions').click()
  await expectOpen(page, true, true)
  await expect(panel(page, 'Features').getByRole('option', { name: new RegExp(`${run} F1\\b`) })).toHaveAttribute('aria-selected', 'true')
  await panel(page, 'Versions').getByRole('option', { name: new RegExp(`${run} V1\\b`) }).click()
  await expect(page).toHaveURL(new RegExp(`feature=${items.feature}`))
  await expect(page).toHaveURL(new RegExp(`release=${items.release}`))
  // Both filters apply together, as they did before (Feature F1 and Version V1: every 4th Task).
  await expect(list(page).locator('[data-task]')).toHaveCount(10)
  await page.getByRole('button', { name: 'Close Features panel' }).click()
  await expect(page).toHaveURL(new RegExp(`feature=${items.feature}`))
  await expect(list(page).locator('[data-task]')).toHaveCount(10)
  await toggle(page, 'Features').click()
  await expect(panel(page, 'Features').getByRole('option', { name: new RegExp(`${run} F1\\b`) })).toHaveAttribute('aria-selected', 'true')
  await expect(panel(page, 'Versions').getByRole('option', { name: new RegExp(`${run} V1\\b`) })).toHaveAttribute('aria-selected', 'true')
  // Clearing one selection keeps the other.
  await panel(page, 'Versions').getByRole('option', { name: new RegExp(`${run} V1\\b`) }).click()
  await expect(page).not.toHaveURL(/release=/)
  await expect(page).toHaveURL(new RegExp(`feature=${items.feature}`))
  await expect(list(page).locator('[data-task]')).toHaveCount(20)
  await page.context().close()
})

for (const [width, height, beside] of [[1440, 900, true], [1280, 800, true], [1024, 768, false], [768, 1024, false]] as const) {
  test(`${width}×${height}: both panels ${beside ? 'stand beside the list as [Features][Versions][Tasks]' : 'stand side by side above the list'}`, async ({ browser }) => {
    const page = await asUser(browser, USERS.manager, { width, height }, `/masar/spaces/${spaces.full}/tasks`)
    await expect(list(page).locator('[data-task]').first()).toBeVisible()
    await toggle(page, 'Features').click()
    const single = await box(page, 'Features')
    await toggle(page, 'Versions').click()
    const f = await box(page, 'Features'), v = await box(page, 'Versions'), l = (await list(page).boundingBox())!
    expect(f.x + f.width).toBeLessThanOrEqual(v.x)
    expect(Math.abs(f.y - v.y)).toBeLessThanOrEqual(1)
    if (beside) {
      expect(v.x + v.width).toBeLessThanOrEqual(l.x)
      expect(f.width).toBe(single.width) // each keeps the width of a single panel
      expect(l.width).toBeGreaterThan(400)
    } else {
      expect(Math.max(f.y + f.height, v.y + v.height)).toBeLessThanOrEqual(l.y)
      expect(l.height).toBeGreaterThan(90) // at least two Task rows
    }
    expect(await pageOverflow(page)).toBe(0)
    expect(await closeReachable(page, 'Features')).toBe(true)
    expect(await closeReachable(page, 'Versions')).toBe(true)
    // Each panel scrolls on its own.
    for (const name of ['Features', 'Versions'] as const) {
      const options = panel(page, name).getByRole('listbox')
      await options.evaluate((node) => { node.scrollTop = node.scrollHeight })
      await expect(options.getByRole('option').last()).toBeInViewport()
    }
    await page.context().close()
  })
}

test('single panels keep their place: one beside the list on tablet and desktop', async ({ browser }) => {
  for (const [width, height] of [[1440, 900], [768, 1024]] as const) {
    const page = await asUser(browser, USERS.manager, { width, height }, `/masar/spaces/${spaces.full}/tasks`)
    await expect(list(page).locator('[data-task]').first()).toBeVisible()
    for (const name of ['Features', 'Versions'] as const) {
      await toggle(page, name).click()
      const p = await box(page, name), l = (await list(page).boundingBox())!
      expect(p.width).toBe(256)
      expect(p.x + p.width).toBeLessThanOrEqual(l.x)
      await toggle(page, name).click()
    }
    await page.context().close()
  }
})

for (const [width, height] of PHONES) {
  test(`${width}×${height}: both panels side by side above the Tasks, list and composer still usable`, async ({ browser }) => {
    const page = await asUser(browser, USERS.manager, { width, height }, `/masar/spaces/${spaces.full}/tasks`)
    await expect(list(page).locator('[data-task]').first()).toBeVisible()
    await toggle(page, 'Features').click()
    await toggle(page, 'Versions').click()
    await expectOpen(page, true, true)
    const f = await box(page, 'Features'), v = await box(page, 'Versions'), l = (await list(page).boundingBox())!
    // One row, both fully on screen, above the list.
    expect(Math.abs(f.y - v.y)).toBeLessThanOrEqual(1)
    expect(f.x).toBeGreaterThanOrEqual(0)
    expect(f.x + f.width).toBeLessThanOrEqual(v.x)
    expect(v.x + v.width).toBeLessThanOrEqual(width)
    await expect(panel(page, 'Features')).toBeInViewport({ ratio: 1 })
    await expect(panel(page, 'Versions')).toBeInViewport({ ratio: 1 })
    expect(Math.max(f.y + f.height, v.y + v.height)).toBeLessThanOrEqual(l.y)
    // One page scroll (iPhone stabilization 2026-10-30): the panels do not take the list's room; the page
    // scrolls on to the Task rows, which come up above the composer, and the composer stays on screen.
    await expect(page.getByLabel('New task title')).toBeInViewport({ ratio: 1 })
    const first = list(page).locator('[data-task]').first()
    // Scroll the page until the first row's top reaches the top of the screen.
    await first.evaluate((row) => {
      let owner = row.parentElement
      while (owner && !/(auto|scroll)/.test(getComputedStyle(owner).overflowY)) owner = owner.parentElement
      owner!.scrollBy(0, row.getBoundingClientRect().top - owner!.getBoundingClientRect().top)
    })
    const row = (await first.boundingBox())!, composerTop = (await page.getByLabel('New task title').locator('xpath=ancestor::div[contains(@class,"sticky")][1]').boundingBox())!.y
    expect(row.y + row.height).toBeLessThanOrEqual(composerTop + 1)
    await panel(page, 'Features').scrollIntoViewIfNeeded()
    expect(await pageOverflow(page)).toBe(0)
    // Long names stay inside their column.
    for (const name of ['Features', 'Versions'] as const) {
      const long = panel(page, name).getByRole('option', { name: new RegExp(name === 'Features' ? 'very long name' : 'exceptionally long name') })
      const option = (await long.boundingBox())!, column = await box(page, name)
      expect(option.x + option.width).toBeLessThanOrEqual(column.x + column.width + 0.5)
    }
    expect(await closeReachable(page, 'Features')).toBe(true)
    expect(await closeReachable(page, 'Versions')).toBe(true)
    // Each panel scrolls inside itself to its last item.
    for (const name of ['Features', 'Versions'] as const) {
      const options = panel(page, name).getByRole('listbox')
      await options.evaluate((node) => { node.scrollTop = node.scrollHeight })
      await expect(options.getByRole('option').last()).toBeInViewport()
    }
    // Close one, then the other: the remaining panel stays on screen, then the list moves up in its place.
    await page.getByRole('button', { name: 'Close Features panel' }).click()
    await expectOpen(page, false, true)
    await expect(panel(page, 'Versions')).toBeInViewport({ ratio: 1 })
    await page.getByRole('button', { name: 'Close Versions panel' }).click()
    await expectOpen(page, false, false)
    expect(Math.round((await list(page).boundingBox())!.y)).toBeLessThan(Math.round(l.y))
    expect(await pageOverflow(page)).toBe(0)
    await page.context().close()
  })
}

test('phone 390×664: with both panels open the page scrolls as one to the end, nothing hides, and a Task opens and closes', async ({ browser }) => {
  const page = await asUser(browser, USERS.manager, { width: 390, height: 664 }, `/masar/spaces/${spaces.full}/tasks`)
  await expect(list(page).locator('[data-task]').first()).toBeVisible()
  await toggle(page, 'Features').click()
  await toggle(page, 'Versions').click()
  const filters = page.getByTestId('task-filters')
  const pageScroller = await list(page).evaluateHandle((node) => {
    let element: HTMLElement | null = node as HTMLElement
    while (element && !/(auto|scroll)/.test(getComputedStyle(element).overflowY)) element = element.parentElement
    return element!
  })
  expect(await list(page).evaluate(node => getComputedStyle(node).overflowY)).toBe('visible') // no list scroll of its own
  await filters.evaluate((bar) => {
    const w = window as unknown as { toggles: number }
    w.toggles = 0
    new MutationObserver(() => { w.toggles++ }).observe(bar, { attributes: true, attributeFilter: ['inert', 'style'] })
  })
  // Scrolling inside a panel scrolls that panel only, not the page.
  const pageTop = await pageScroller.evaluate(node => node.scrollTop)
  await panel(page, 'Features').getByRole('listbox').evaluate((node) => { node.scrollTop = node.scrollHeight })
  await page.waitForTimeout(400)
  expect(await pageScroller.evaluate(node => node.scrollTop)).toBe(pageTop)
  // Steady scrolling of the page to the end: filters and panels move away with it and never hide.
  await pageScroller.evaluate(async (node) => { for (let i = 0; i < 200; i++) { node.scrollBy(0, 24); await new Promise(r => setTimeout(r, 16)) } })
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => (window as unknown as { toggles: number }).toggles)).toBe(0)
  expect(await pageScroller.evaluate(node => node.scrollTop >= node.scrollHeight - node.clientHeight - 1)).toBe(true)
  await expect(page.getByLabel('New task title')).toBeInViewport()
  // A Task opens and closes; the page stays where it was and both panels are still open.
  const atEnd = await pageScroller.evaluate(node => node.scrollTop)
  await list(page).locator('[data-task]').last().getByText(new RegExp(`^${run} task \\d+$`)).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close panel' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await pageScroller.evaluate(node => node.scrollTop)).toBe(atEnd)
  await pageScroller.evaluate(node => node.scrollTo(0, 0))
  await expect(filters).not.toHaveAttribute('inert')
  await expectOpen(page, true, true)
  await page.context().close()
})

test('a Space without Features or Versions: both panels show only their "without" entry, side by side', async ({ browser }) => {
  for (const [width, height] of [[320, 568], [1440, 900]] as const) {
    const page = await asUser(browser, USERS.manager, { width, height }, `/masar/spaces/${spaces.empty}/tasks`)
    await expect(page.getByLabel('New task title')).toBeVisible()
    await toggle(page, 'Features').click()
    await toggle(page, 'Versions').click()
    await expect(panel(page, 'Features').getByRole('option')).toHaveText(['Tasks without a Feature'])
    await expect(panel(page, 'Versions').getByRole('option')).toHaveText(['Tasks without a Version'])
    const f = await box(page, 'Features'), v = await box(page, 'Versions')
    expect(Math.abs(f.y - v.y)).toBeLessThanOrEqual(1)
    expect(f.x + f.width).toBeLessThanOrEqual(v.x)
    expect(await pageOverflow(page)).toBe(0)
    await page.context().close()
  }
})
