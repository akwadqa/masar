import { expect, test, type Browser, type Page } from '@playwright/test'
import type { SpaceSummary, TaskDetail } from '../../app/types/api'
import { USERS, pageApi, signIn, uniqueTitle } from './helpers'

// Stabilization round 1 (docs/qa/stabilization-2026-10-29/round-1-fix-report.md), on phone-sized
// screens: the Space Task List keeps its filters, Task rows and composer usable (QA-D01) and rests at
// the end of a list without anything moving on its own (QA-D02). Since the iPhone stabilization of
// 2026-10-30 (client decision) a phone Task page scrolls as one page: filters, rows and composer move
// together and the filters no longer slide away. Tablet and desktop keep their filter layout.
test.describe.configure({ mode: 'serial' })

const run = uniqueTitle('SR1').replace(/\s+/g, '-')
const spaces = { long: '', short: '', empty: '' }
const PHONES = [[320, 568], [375, 667], [390, 664], [390, 844], [412, 839], [430, 932]] as const

async function asUser(browser: Browser, email: string, viewport: { width: number, height: number }, path?: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport, hasTouch: viewport.width < 600 })).newPage()
  await signIn(page, email, undefined, path)
  return page
}
async function api<T>(page: Page, method: string, body?: Record<string, unknown>) {
  return pageApi<{ data: T }>(page, method, { body })
}

const filters = (page: Page) => page.getByTestId('task-filters')
const list = (page: Page) => page.getByRole('list', { name: 'Tasks' })

/** The element that scrolls the list: the page (panel body) on phones, the list itself on wider screens. */
async function owner(page: Page) {
  return list(page).evaluateHandle((node) => {
    let element: HTMLElement | null = node as HTMLElement
    while (element && !/(auto|scroll)/.test(getComputedStyle(element).overflowY)) element = element.parentElement
    return element!
  })
}
async function scroll(page: Page, run: (node: HTMLElement) => unknown) {
  await (await owner(page)).evaluate(run)
}

/** Counts every change of the filter area from now on: hiding (`inert`) or a change of its height. */
async function watchFilters(page: Page) {
  await filters(page).evaluate((bar) => {
    const w = window as unknown as { filterToggles: number }
    w.filterToggles = 0
    new MutationObserver(() => { w.filterToggles++ }).observe(bar, { attributes: true, attributeFilter: ['inert'] })
    let height = bar.getBoundingClientRect().height
    new ResizeObserver(() => {
      const next = bar.getBoundingClientRect().height
      if (Math.abs(next - height) > 0.5) w.filterToggles++
      height = next
    }).observe(bar)
  })
  return () => page.evaluate(() => (window as unknown as { filterToggles: number }).filterToggles)
}

/** Waits until the page has not moved for 600 ms, then for another 1.5 s of quiet, and returns the
 *  filter changes that happened while nobody was scrolling. */
async function togglesAfterStop(page: Page, toggles: () => Promise<number>) {
  await expect.poll(async () => {
    const before = await (await owner(page)).evaluate(node => node.scrollTop)
    await page.waitForTimeout(600)
    return before === await (await owner(page)).evaluate(node => node.scrollTop)
  }).toBe(true)
  const settled = await toggles()
  await page.waitForTimeout(1500)
  return (await toggles()) - settled
}

const atEnd = async (page: Page) => (await owner(page)).evaluate(node => node.scrollTop >= node.scrollHeight - node.clientHeight - 1)
/** Bottom of the area above the composer (the composer stays at the bottom of the screen on phones). */
const composerTop = (page: Page) => page.locator('[class*="group/composer"]').evaluate(node => node.parentElement!.getBoundingClientRect().top)

test.beforeAll(async ({ browser }) => {
  const admin = await asUser(browser, USERS.admin, { width: 1440, height: 900 })
  for (const key of ['long', 'short', 'empty'] as const) {
    spaces[key] = (await api<SpaceSummary>(admin, 'masar.api.spaces.create', { data: { title: `${run} ${key}`, owner: USERS.manager, category: 'Verification' } })).body.data.name
  }
  await admin.context().close()
  const manager = await asUser(browser, USERS.manager, { width: 1440, height: 900 })
  const create = (space: string, title: string) => api<{ task: TaskDetail }>(manager, 'masar.api.tasks.create', { space, title, client_request_id: crypto.randomUUID() })
  for (let i = 0; i < 40; i++) await create(spaces.long, `${run} long ${i}`)
  for (let i = 0; i < 3; i++) await create(spaces.short, `${run} short ${i}`)
  await manager.context().close()
})

test('QA-D01: on every phone size the Space Task List shows its filters, reachable Task rows and the composer', async ({ browser }) => {
  for (const [width, height] of PHONES) {
    const page = await asUser(browser, USERS.manager, { width, height }, `/masar/spaces/${spaces.long}/tasks`)
    await expect(list(page).locator('[data-task]').first()).toBeVisible()
    // One page scroll: the list does not scroll by itself, the page does.
    expect(await list(page).evaluate(node => getComputedStyle(node).overflowY), `${width}×${height}`).toBe('visible')
    const composer = page.getByLabel('New task title')
    await expect(composer).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), `${width}×${height}: sideways overflow`).toBe(false)
    // Scrolling the page brings Task rows above the composer: at least two complete rows.
    await scroll(page, node => node.scrollTo(0, (document.querySelector('[role="list"][aria-label="Tasks"]') as HTMLElement).getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop - 48))
    const limit = await composerTop(page)
    const fullRows = await list(page).evaluate((node, limit) => [...node.querySelectorAll('[data-task]')]
      .filter((row) => { const box = row.getBoundingClientRect(); return box.top >= 0 && box.bottom <= limit + 1 }).length, limit)
    expect(fullRows, `${width}×${height}: complete Task rows above the composer`).toBeGreaterThanOrEqual(2)
    await scroll(page, node => node.scrollTo(0, 0))

    // Every filter control can be reached and shows its whole label: nothing is cut off or made smaller.
    const controls = filters(page).locator('button:visible, input:visible')
    for (let i = 0; i < await controls.count(); i++) {
      const control = controls.nth(i)
      await control.scrollIntoViewIfNeeded()
      await expect(control).toBeInViewport({ ratio: 1 })
      expect((await control.boundingBox())!.height, `${width}×${height}: touch target`).toBeGreaterThanOrEqual(32)
    }
    const cut = await filters(page).evaluate(bar => [...bar.querySelectorAll<HTMLElement>('button .truncate, button span')]
      .filter(span => span.offsetParent && span.scrollWidth > span.clientWidth + 1).map(span => span.textContent))
    expect(cut, `${width}×${height}: truncated labels`).toEqual([])
    const fontSizes = await filters(page).evaluate(bar => [...new Set([...bar.querySelectorAll('input, button')].map(e => getComputedStyle(e).fontSize))].sort())
    expect(fontSizes, `${width}×${height}: font sizes`).toEqual(['15px', '16px'])
    await page.context().close()
  }
})

test('phones: the filters move with the page and never hide, shrink or come back on their own', async ({ browser }) => {
  const page = await asUser(browser, USERS.manager, { width: 320, height: 568 }, `/masar/spaces/${spaces.long}/tasks`)
  await expect(list(page).locator('[data-task]').first()).toBeVisible()
  const toggles = await watchFilters(page)
  const filterTop = async () => (await filters(page).boundingBox())!.y
  const start = await filterTop()
  await scroll(page, node => node.scrollBy(0, 200))
  await expect.poll(filterTop).toBeCloseTo(start - 200, 0) // moved exactly with the page
  await scroll(page, node => node.scrollBy(0, -120))
  await expect.poll(filterTop).toBeCloseTo(start - 80, 0) // and back with it, no snapping
  await scroll(page, node => node.scrollTo(0, 0))
  await expect.poll(filterTop).toBeCloseTo(start, 0)
  expect(await togglesAfterStop(page, toggles)).toBe(0)
  expect(await toggles()).toBe(0)
  await expect(filters(page)).not.toHaveAttribute('inert')
  await page.context().close()
})

for (const [width, height] of [[320, 568], [390, 664], [430, 932]] as const) {
  for (const where of ['Space Task List', 'All Tasks'] as const) {
    test(`QA-D02: ${where} at ${width}×${height} rests at the end of the list with nothing moving on its own`, async ({ browser }) => {
      const path = where === 'All Tasks' ? `/masar/tasks?q=${encodeURIComponent(`${run} long`)}` : `/masar/spaces/${spaces.long}/tasks`
      const page = await asUser(browser, USERS.manager, { width, height }, path)
      await expect(list(page).locator('[data-task]').first()).toBeVisible()
      const toggles = await watchFilters(page)

      // A fast flick: one jump to the very end, then hands off.
      await scroll(page, (node) => { node.scrollTop = node.scrollHeight })
      expect(await togglesAfterStop(page, toggles)).toBe(0)
      expect(await atEnd(page), 'the page rests at the end').toBe(true)
      await expect(list(page).getByText(`${run} long 0`, { exact: true })).toBeVisible() // the oldest Task, last in the list

      // Steady scrolling that keeps pushing at the end, then small moves near the end.
      await scroll(page, node => node.scrollTo(0, 0))
      await scroll(page, async (node) => { for (let i = 0; i < 400; i++) { node.scrollBy(0, 24); await new Promise(r => setTimeout(r, 16)) } })
      expect(await togglesAfterStop(page, toggles)).toBe(0)
      expect(await atEnd(page)).toBe(true)
      await scroll(page, async (node) => { for (let i = 0; i < 3; i++) { node.scrollBy(0, -12); await new Promise(r => setTimeout(r, 16)) } })
      await scroll(page, async (node) => { for (let i = 0; i < 20; i++) { node.scrollBy(0, 24); await new Promise(r => setTimeout(r, 16)) } })
      expect(await togglesAfterStop(page, toggles)).toBe(0)
      expect(await atEnd(page)).toBe(true)
      expect(await toggles(), 'the filters never changed').toBe(0)
      if (where === 'Space Task List') {
        // At the end the composer rests below the last row, which it does not cover.
        await expect(page.getByLabel('New task title')).toBeInViewport()
        const lastRow = (await list(page).locator('[data-task]').last().boundingBox())!
        expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(await composerTop(page) + 1)
      }
      await page.context().close()
    })
  }
}

test('QA-D02: repeated direction changes follow the person, and opening a Task keeps the page still', async ({ browser }) => {
  const page = await asUser(browser, USERS.manager, { width: 390, height: 664 }, `/masar/spaces/${spaces.long}/tasks`)
  await expect(list(page).locator('[data-task]').first()).toBeVisible()
  const toggles = await watchFilters(page)
  for (let round = 0; round < 3; round++) {
    const before = await (await owner(page)).evaluate(node => node.scrollTop)
    await scroll(page, async (node) => { for (let i = 0; i < 10; i++) { node.scrollBy(0, 30); await new Promise(r => setTimeout(r, 16)) } })
    await scroll(page, async (node) => { for (let i = 0; i < 4; i++) { node.scrollBy(0, -20); await new Promise(r => setTimeout(r, 16)) } })
    expect(await (await owner(page)).evaluate(node => node.scrollTop)).toBe(before + 300 - 80)
  }
  expect(await togglesAfterStop(page, toggles)).toBe(0)
  expect(await toggles()).toBe(0)

  // Open a Task from the end of the list, close it, and the page is where it was.
  await scroll(page, (node) => { node.scrollTop = node.scrollHeight })
  expect(await togglesAfterStop(page, toggles)).toBe(0)
  const top = await (await owner(page)).evaluate(node => node.scrollTop)
  const row = list(page).locator('[data-task]').last()
  await row.getByText(new RegExp(`^${run} long \\d+$`)).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close panel' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await togglesAfterStop(page, toggles)).toBe(0)
  expect(await (await owner(page)).evaluate(node => node.scrollTop)).toBe(top)
  await page.context().close()
})

test('short and empty lists: the filters stay, the composer works', async ({ browser }) => {
  for (const [key, rows] of [['short', 3], ['empty', 0]] as const) {
    const page = await asUser(browser, USERS.manager, { width: 390, height: 664 }, `/masar/spaces/${spaces[key]}/tasks`)
    await expect(list(page).locator('[data-task]')).toHaveCount(rows)
    const toggles = await watchFilters(page)
    await scroll(page, node => node.scrollBy(0, 300))
    await page.waitForTimeout(500)
    expect(await toggles()).toBe(0)
    await expect(filters(page)).not.toHaveAttribute('inert')
    const input = page.getByLabel('New task title')
    await expect(input).toBeInViewport()
    if (key === 'empty') {
      await input.fill(`${run} typed on a phone`)
      await input.press('Enter')
      await expect(page.getByRole('listitem', { name: new RegExp(`^${run} typed on a phone`) })).toBeVisible()
    }
    await page.context().close()
  }
})

test('tablet and desktop keep their filter layout and never hide the filters', async ({ browser }) => {
  for (const [width, height] of [[768, 1024], [1440, 900]] as const) {
    const page = await asUser(browser, USERS.manager, { width, height }, `/masar/spaces/${spaces.long}/tasks`)
    await expect(list(page).locator('[data-task]').first()).toBeVisible()
    // The original sizes: Search 16rem, every other select 11rem, the filter area never scrolls.
    expect(Math.round((await page.getByLabel('Search tasks').locator('..').boundingBox())!.width)).toBe(256)
    // Prefix match: the Status and Owner names also carry what the button shows (QA-D10).
    for (const name of ['Filter by status', 'Filter by owner', 'Filter by priority', 'Filter by label', 'Sort tasks']) {
      expect(Math.round((await filters(page).locator(`[aria-label^="${name}"]`).boundingBox())!.width), name).toBe(176)
    }
    expect(await filters(page).locator('> div').evaluate(node => getComputedStyle(node).overflowY)).toBe('visible')
    // Wider screens: the list scrolls by itself under filters that stay.
    expect(await list(page).evaluate(node => getComputedStyle(node).overflowY)).toBe('auto')
    const toggles = await watchFilters(page)
    await list(page).evaluate((node) => { node.scrollTop = node.scrollHeight })
    await page.waitForTimeout(800)
    expect(await toggles()).toBe(0)
    await page.context().close()
  }
})
