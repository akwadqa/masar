import { expect, test, type Browser, type Page } from '@playwright/test'
import type { SpaceSummary, TaskDetail } from '../../app/types/api'
import { USERS, pageApi, signIn, uniqueTitle } from './helpers'

// iPhone stabilization 2026-10-30 (docs/qa/iphone-pwa-single-scroll-stabilization-report.md).
// 1. The shell never scrolls and each page fits inside it: in the installed iPhone app (safe-area insets
//    of 59/34 px are substituted here for env(), which browsers cannot set) the composer was cut off and
//    a focused composer scrolled the whole shell under the status bar.
// 2. Mobile Task pages (phones in portrait and landscape, browser or installed) scroll as one page with
//    a composer that stays at the bottom of the screen; tablets and desktops keep the list's own scroll.
// Browser emulation is not a real iPhone: the status bar, keyboard and native scrolling need a device.
test.describe.configure({ mode: 'serial' })

const run = uniqueTitle('MPS').replace(/\s+/g, '-')
const INSETS = { top: 59, bottom: 34 }
let space = ''
let shortSpace = ''

async function asUser(browser: Browser, viewport: { width: number, height: number }, path: string, touch = viewport.width < 1000, email: string = USERS.manager): Promise<Page> {
  const page = await (await browser.newContext({ viewport, hasTouch: touch })).newPage()
  await signIn(page, email, undefined, path)
  return page
}
const list = (page: Page) => page.getByRole('list', { name: 'Tasks' })
const composer = (page: Page) => page.getByLabel('New task title')

/** The installed iPhone app: the shell's safe-area padding takes the iPhone's inset values. */
async function standalone(page: Page) {
  await page.addStyleTag({ content: `.fixed.inset-0 { padding-top: ${INSETS.top}px !important; padding-bottom: ${INSETS.bottom}px !important }` })
}
/** Geometry that must not change on its own: shell scroll, page title, page scroll, composer. */
function geometry(page: Page) {
  return page.evaluate(() => {
    const list = document.querySelector('[role="list"][aria-label="Tasks"]')!
    let owner: HTMLElement | null = list as HTMLElement
    while (owner && !/(auto|scroll)/.test(getComputedStyle(owner).overflowY)) owner = owner.parentElement
    const box = document.querySelector('[aria-label="New task title"]')!.closest('.border-t')!.getBoundingClientRect()
    return {
      shellScroll: document.querySelector('.fixed.inset-0')!.scrollTop,
      titleTop: Math.round(document.querySelector('h1')!.getBoundingClientRect().top),
      pageScroll: Math.round(owner!.scrollTop),
      composerTop: Math.round(box.top),
      composerBottom: Math.round(box.bottom)
    }
  })
}
async function scrollOwner(page: Page) {
  return list(page).evaluate((node) => {
    let element: HTMLElement | null = node as HTMLElement
    while (element && !/(auto|scroll)/.test(getComputedStyle(element).overflowY)) element = element.parentElement
    return element === node ? 'list' : element?.getAttribute('data-slot') ?? 'other'
  })
}

test.beforeAll(async ({ browser }) => {
  const admin = await asUser(browser, { width: 1440, height: 900 }, '/masar/my-day', false, USERS.admin)
  space = (await pageApi<{ data: SpaceSummary }>(admin, 'masar.api.spaces.create', { body: { data: { title: `${run} space`, owner: USERS.manager, category: 'Verification' } } })).body.data.name
  shortSpace = (await pageApi<{ data: SpaceSummary }>(admin, 'masar.api.spaces.create', { body: { data: { title: `${run} short`, owner: USERS.manager, category: 'Verification' } } })).body.data.name
  await admin.context().close()
  const manager = await asUser(browser, { width: 1440, height: 900 }, '/masar/my-day', false)
  for (let i = 0; i < 2; i++) {
    await pageApi<{ data: { task: TaskDetail } }>(manager, 'masar.api.tasks.create', { body: { space: shortSpace, title: `${run} short ${i}`, client_request_id: crypto.randomUUID() } })
  }
  for (let i = 0; i < 150; i++) {
    await pageApi<{ data: { task: TaskDetail } }>(manager, 'masar.api.tasks.create', { body: { space, title: `${run} task ${String(i).padStart(3, '0')}`, client_request_id: crypto.randomUUID() } })
  }
  await manager.context().close()
})

for (const [width, height] of [[375, 667], [390, 844], [430, 932]] as const) {
  test(`installed iPhone app ${width}×${height}: composer fully visible; New task, typing, adding and leaving the field never move the shell`, async ({ browser }) => {
    const page = await asUser(browser, { width, height }, `/masar/spaces/${space}/tasks`)
    await expect(list(page).locator('[data-task]').first()).toBeVisible()
    await standalone(page)
    const start = await geometry(page)
    expect(start.shellScroll).toBe(0)
    expect(start.titleTop, 'the header starts below the status bar').toBeGreaterThanOrEqual(INSETS.top)
    expect(start.composerTop, 'the composer is fully on screen').toBeGreaterThanOrEqual(0)
    expect(start.composerBottom, 'and above the home indicator').toBeLessThanOrEqual(height - INSETS.bottom)

    await page.getByRole('button', { name: /^New task/ }).click()
    await expect(composer(page)).toBeFocused()
    expect(await geometry(page), 'New task').toEqual(start)
    await page.keyboard.type(`${run} typed in the app ${width}`)
    await page.keyboard.press('Enter')
    await expect(list(page).getByText(`${run} typed in the app ${width}`, { exact: true })).toBeVisible()
    await expect(composer(page)).toBeFocused()
    await expect(composer(page)).toHaveValue('')
    expect(await geometry(page), 'after adding a Task').toEqual(start)
    await composer(page).blur()
    expect(await geometry(page), 'after leaving the field').toEqual(start)
    await page.context().close()
  })
}

test('installed iPhone app 390×664 with both panels open: the composer stays on screen and the shell still never moves', async ({ browser }) => {
  const page = await asUser(browser, { width: 390, height: 664 }, `/masar/spaces/${space}/tasks`)
  await expect(list(page).locator('[data-task]').first()).toBeVisible()
  await standalone(page)
  await page.getByRole('button', { name: 'Features panel', exact: true }).click()
  await page.getByRole('button', { name: 'Versions panel', exact: true }).click()
  const start = await geometry(page)
  expect(start.composerBottom).toBeLessThanOrEqual(664 - INSETS.bottom)
  await expect(composer(page)).toBeInViewport({ ratio: 1 })
  await composer(page).click()
  await page.keyboard.type(`${run} with panels`)
  await page.keyboard.press('Enter')
  await composer(page).blur()
  const end = await geometry(page)
  expect(end.shellScroll).toBe(0)
  expect(end.titleTop).toBe(start.titleTop)
  expect(end.pageScroll).toBe(start.pageScroll)
  expect(end.composerTop).toBe(start.composerTop)
  await page.context().close()
})

test('mobile browser 390×844 (no insets): the same stability, the composer at the bottom of the screen', async ({ browser }) => {
  const page = await asUser(browser, { width: 390, height: 844 }, `/masar/spaces/${space}/tasks`)
  await expect(list(page).locator('[data-task]').first()).toBeVisible()
  const start = await geometry(page)
  expect(start.composerBottom).toBe(844)
  await page.getByRole('button', { name: /^New task/ }).click()
  await page.keyboard.type(`${run} typed in Safari`)
  await page.keyboard.press('Enter')
  await composer(page).blur()
  expect(await geometry(page)).toEqual(start)
  await page.context().close()
})

for (const [label, width, height, owner] of [
  ['phone portrait', 390, 844, 'body'], ['phone landscape', 844, 390, 'body'], ['small phone landscape', 667, 375, 'body'],
  ['iPad portrait', 820, 1180, 'list'], ['iPad landscape', 1180, 820, 'list'], ['desktop', 1440, 900, 'list']
] as const) {
  test(`${label} ${width}×${height}: Space Task List and All Tasks scroll with one ${owner === 'body' ? 'page scroll' : 'list scroll (unchanged)'}`, async ({ browser }) => {
    const page = await asUser(browser, { width, height }, `/masar/spaces/${space}/tasks`, label !== 'desktop')
    for (const path of [`/masar/spaces/${space}/tasks`, `/masar/tasks?spaces=${space}`]) {
      await page.goto(path)
      await expect(list(page).locator('[data-task]').first()).toBeVisible()
      expect(await scrollOwner(page), path).toBe(owner)
      const scrollers = await page.evaluate(() => [...document.querySelectorAll('main *, [data-slot="body"], [role="list"]')]
        .filter(e => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1 && !e.closest('[role="listbox"], [role="dialog"]')).length)
      expect(scrollers, `${path}: one scrolling area for the page`).toBe(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
      if (path.includes('/spaces/')) await expect(composer(page)).toBeInViewport({ ratio: 1 })
    }
    await page.context().close()
  })
}

test('turning a phone: the page switches between page scroll (landscape and portrait) without losing the composer', async ({ browser }) => {
  const page = await asUser(browser, { width: 390, height: 844 }, `/masar/spaces/${space}/tasks`)
  await expect(list(page).locator('[data-task]').first()).toBeVisible()
  for (const [width, height] of [[844, 390], [390, 844], [1180, 820], [390, 844]] as const) {
    await page.setViewportSize({ width, height })
    await expect.poll(() => scrollOwner(page)).toBe(width === 1180 ? 'list' : 'body')
    await expect(composer(page)).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  }
  await page.context().close()
})

test('long list on a phone: rows stay virtualized, the end is reachable, ArrowUp from the composer shows the last row above it', async ({ browser }) => {
  const page = await asUser(browser, { width: 390, height: 664 }, `/masar/spaces/${space}/tasks`)
  await expect(list(page).locator('[data-task]').first()).toBeVisible()
  expect(await list(page).locator('[data-task]').count(), 'only the rows near the screen are rendered').toBeLessThan(60)
  await list(page).evaluate((node) => {
    let owner: HTMLElement | null = node as HTMLElement
    while (owner && !/(auto|scroll)/.test(getComputedStyle(owner).overflowY)) owner = owner.parentElement
    owner!.scrollTop = owner!.scrollHeight
  })
  const oldest = list(page).getByText(`${run} task 000`, { exact: true })
  await expect(oldest).toBeVisible()
  const composerTop = (await composer(page).locator('xpath=ancestor::div[contains(@class,"border-t")][1]').boundingBox())!.y
  const lastRow = (await list(page).locator('[data-task]').last().boundingBox())!
  expect(lastRow.y + lastRow.height, 'the composer does not cover the last row').toBeLessThanOrEqual(composerTop + 1)
  expect(await list(page).locator('[data-task]').count()).toBeLessThan(60)
  // Keyboard: from the composer, ArrowUp moves to the last Task row, which is shown above the composer.
  await list(page).evaluate((node) => {
    let owner: HTMLElement | null = node as HTMLElement
    while (owner && !/(auto|scroll)/.test(getComputedStyle(owner).overflowY)) owner = owner.parentElement
    owner!.scrollTop = 0
  })
  await composer(page).click()
  await page.keyboard.press('ArrowUp')
  const focused = page.locator('[data-task]:focus, [data-task] :focus').first()
  await expect(focused).toBeVisible()
  const row = (await page.locator(':focus').boundingBox())!
  const top = (await composer(page).locator('xpath=ancestor::div[contains(@class,"border-t")][1]').boundingBox())!.y
  expect(row.y + row.height).toBeLessThanOrEqual(top + 1)
  await expect(page.locator(':focus')).toContainText(`${run} task 000`)
  await page.context().close()
})

test('desktop is unchanged: the list scrolls by itself and adding a Task scrolls the list to the new row', async ({ browser }) => {
  const page = await asUser(browser, { width: 1440, height: 900 }, `/masar/spaces/${space}/tasks`, false)
  await expect(list(page).locator('[data-task]').first()).toBeVisible()
  expect(await list(page).evaluate(node => getComputedStyle(node).overflowY)).toBe('auto')
  await list(page).evaluate((node) => { node.scrollTop = node.scrollHeight })
  await composer(page).fill(`${run} desktop add`)
  await composer(page).press('Enter')
  await expect(list(page).getByText(`${run} desktop add`, { exact: true })).toBeVisible()
  expect(await list(page).evaluate(node => node.scrollTop)).toBe(0)
  await page.context().close()
})

// New task button (client request 2026-10-30): the Plus icon alone on phones, unchanged from 640 px.
for (const [width, height] of [[320, 568], [360, 640], [375, 667], [390, 844], [430, 932]] as const) {
  test(`New task on a ${width}×${height} phone: icon only, 44 px, named, beside Features and Versions, opens the composer`, async ({ browser }) => {
    const page = await asUser(browser, { width, height }, `/masar/spaces/${space}/tasks`)
    const button = page.getByRole('button', { name: 'New task', exact: true })
    await expect(button).toBeVisible()
    const box = (await button.boundingBox())!
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([44, 44])
    await expect(button.locator('[data-slot="label"]')).toBeHidden()
    const icon = (await button.locator('[data-slot="leadingIcon"]').boundingBox())!
    expect(Math.abs(icon.x + icon.width / 2 - (box.x + box.width / 2))).toBeLessThanOrEqual(1)
    expect(Math.abs(icon.y + icon.height / 2 - (box.y + box.height / 2))).toBeLessThanOrEqual(1)
    for (const name of ['Features panel', 'Versions panel']) {
      const other = (await page.getByRole('button', { name, exact: true }).boundingBox())!
      const apart = other.x + other.width <= box.x || other.x >= box.x + box.width || other.y + other.height <= box.y || other.y >= box.y + box.height
      expect(apart, `${name} does not overlap`).toBe(true)
    }
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await button.tap()
    await expect(composer(page)).toBeFocused()
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await page.context().close()
  })
}

test('New task from 640 px keeps its label and the C hint', async ({ browser }) => {
  for (const [width, height] of [[768, 1024], [1440, 900]] as const) {
    const page = await asUser(browser, { width, height }, `/masar/spaces/${space}/tasks`, false)
    const button = page.getByRole('button', { name: /^New task/ })
    await expect(button.locator('[data-slot="label"]')).toHaveText('New task')
    await expect(button.locator('kbd')).toBeVisible()
    expect(await button.getAttribute('aria-label')).toBeNull()
    await button.click()
    await expect(composer(page)).toBeFocused()
    await page.context().close()
  }
})

// Phone drawer in the installed iPhone app: the account footer reaches the drawer's bottom edge and its
// controls stay above the home indicator (the inset replaces the footer's own padding, it no longer adds
// a band below it). Each env() rule of the drawer is mirrored with the iPhone value where it exists.
async function standaloneDrawer(page: Page, bottom: number) {
  await page.addStyleTag({ content: `
    [class*="pt-[env(safe-area-inset-top)]"] { padding-top: ${INSETS.top}px !important }
    [class*="pb-[env(safe-area-inset-bottom)]"] { padding-bottom: ${bottom}px !important }
    [class*="[data-slot=footer]]:pb-[max(0.75rem,env(safe-area-inset-bottom))]"] > [data-slot="footer"] { padding-bottom: max(12px, ${bottom}px) !important }` })
}
for (const [mode, bottom] of [['installed iPhone app', INSETS.bottom], ['mobile browser', 0]] as const) {
  test(`${mode}: the phone drawer's account footer reaches the bottom edge, controls above the home indicator, no shift when the account menu opens`, async ({ browser }) => {
    const page = await asUser(browser, { width: 390, height: 844 }, '/masar/my-day')
    await standaloneDrawer(page, bottom)
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    const drawer = page.locator('[role="dialog"].inset-y-0')
    await expect(drawer).toBeVisible()
    const measure = () => drawer.evaluate((d) => {
      const footer = d.querySelector<HTMLElement>('[data-slot="footer"]')!
      const account = footer.querySelector('button')!.getBoundingClientRect()
      return { drawerBottom: Math.round(d.getBoundingClientRect().bottom), footerBottom: Math.round(footer.getBoundingClientRect().bottom), accountBottom: Math.round(account.bottom), bodyBottom: Math.round(d.querySelector('[data-slot="body"]')!.getBoundingClientRect().bottom) }
    })
    const closed = await measure()
    expect(closed.drawerBottom).toBe(844)
    expect(closed.footerBottom, 'no band below the footer').toBe(844)
    expect(844 - closed.accountBottom, 'account controls end at the safe area').toBe(Math.max(12, bottom))
    await drawer.getByRole('button', { name: /account menu/i }).click()
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    expect(await measure(), 'opening the account menu moves nothing').toEqual(closed)
    await page.keyboard.press('Escape')
    await page.context().close()
  })
}

// Final iOS stabilization (2026-10-30, screenshots client_file/last_Issues).
test('installed app: iOS draws its own solid status bar (default style); the viewport keeps viewport-fit=cover for the home indicator', async ({ browser }) => {
  const page = await asUser(browser, { width: 390, height: 844 }, '/masar/my-day')
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content', 'default')
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
  await page.context().close()
})

test('the + button focuses the composer exactly like a tap on the field (a plain focus iOS moves above its keyboard)', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage()
  await page.addInitScript(() => {
    const w = window as unknown as { composerFocus: unknown[] }
    w.composerFocus = []
    const original = HTMLElement.prototype.focus
    HTMLElement.prototype.focus = function (options?: FocusOptions) {
      if (this.getAttribute('aria-label') === 'New task title') w.composerFocus.push(options ?? null)
      return original.call(this, options)
    }
  })
  await signIn(page, USERS.manager, undefined, `/masar/spaces/${space}/tasks`)
  await expect(list(page).locator('[data-task]').first()).toBeVisible()
  const before = await geometry(page)
  await page.getByRole('button', { name: 'New task', exact: true }).tap()
  await expect(composer(page)).toBeFocused()
  const calls = await page.evaluate(() => (window as unknown as { composerFocus: Array<FocusOptions | null> }).composerFocus)
  expect(calls.length).toBeGreaterThan(0)
  expect(calls.every(options => !options?.preventScroll), `focus options: ${JSON.stringify(calls)}`).toBe(true)
  expect(await geometry(page), 'and the page does not move in the browser').toEqual(before)
  await page.context().close()
})

for (const [mode, insets] of [['mobile browser', false], ['installed app geometry', true]] as const) {
  test(`short list (${mode}): the composer sits at the bottom of the screen, not in the middle with blank space below`, async ({ browser }) => {
    const page = await asUser(browser, { width: 390, height: 844 }, `/masar/spaces/${shortSpace}/tasks`)
    await expect(list(page).locator('[data-task]').first()).toBeVisible()
    expect(await list(page).locator('[data-task]').count(), 'a short list').toBeLessThanOrEqual(4)
    if (insets) await standalone(page)
    const { composerBottom } = await geometry(page)
    expect(composerBottom).toBe(844 - (insets ? INSETS.bottom : 0))
    const lastRow = (await list(page).locator('[data-task]').last().boundingBox())!
    expect(lastRow.y + lastRow.height).toBeLessThan(composerBottom - 69) // rows above, list area between
    await composer(page).fill(`${run} short added ${mode}`)
    await composer(page).press('Enter')
    await expect(list(page).getByText(`${run} short added ${mode}`, { exact: true })).toBeVisible()
    expect((await geometry(page)).composerBottom).toBe(composerBottom)
    await page.context().close()
  })
}

// Installed iPhone app (2026-10-30, docs/qa/ios-pwa-status-bar-blur-investigation.md): iOS blurs the top
// edge unless the position: fixed box at the top-edge sample point (4 px below the middle) is full-width
// and opaque. Masar keeps such a surface there from the first frame: the launch surface, then the shell.
async function topEdgeBox(page: Page) {
  return page.evaluate(() => {
    let element = document.elementFromPoint(innerWidth / 2, 4)
    while (element && !['fixed', 'sticky'].includes(getComputedStyle(element).position)) element = element.parentElement
    if (!element) return null
    const style = getComputedStyle(element), box = element.getBoundingClientRect()
    return { background: style.backgroundColor, opaque: !/rgba\(.*,\s*0(\.\d+)?\)$/.test(style.backgroundColor) && style.backgroundColor !== 'transparent', fullWidth: box.width >= 0.9 * innerWidth, atTop: box.top <= 4, tall: box.height > 10 }
  })
}

test('installed app top edge: an opaque full-width fixed surface is at the sample point at launch, with a drawer, after closing it and after navigating (Light and Dark)', async ({ browser }) => {
  const page = await asUser(browser, { width: 428, height: 926 }, `/masar/spaces/${space}/tasks`)
  await expect(list(page).locator('[data-task]').first()).toBeVisible()
  const qualifies = { opaque: true, fullWidth: true, atTop: true, tall: true }
  const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(await topEdgeBox(page), 'at launch: the shell, in the page colour').toEqual({ background: canvas, ...qualifies })
  await page.getByRole('button', { name: 'Open sidebar' }).click()
  const drawer = page.locator('[role="dialog"].inset-y-0')
  await expect(drawer).toBeVisible()
  expect(await topEdgeBox(page), 'with the drawer open').toMatchObject(qualifies)
  await drawer.getByRole('button', { name: /close/i }).first().click()
  await expect(drawer).toHaveCount(0)
  expect(await topEdgeBox(page), 'after closing the drawer').toEqual({ background: canvas, ...qualifies })
  await page.goto('/masar/my-day')
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached()
  expect(await topEdgeBox(page), 'after navigating').toEqual({ background: canvas, ...qualifies })
  await page.evaluate(() => { document.documentElement.classList.add('dark'); document.documentElement.classList.remove('light') })
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(dark).not.toBe(canvas)
  expect(await topEdgeBox(page), 'Dark: the shell takes the dark page colour').toEqual({ background: dark, ...qualifies })
  await page.context().close()
})

test('installed app first frames: before the Workspace starts, the static page already has the opaque launch surface at the top edge', async ({ browser }) => {
  const signedIn = await asUser(browser, { width: 428, height: 926 }, '/masar/my-day')
  const state = await signedIn.context().storageState()
  await signedIn.context().close()
  const page = await (await browser.newContext({ viewport: { width: 428, height: 926 }, javaScriptEnabled: false, storageState: state })).newPage()
  await page.goto('/masar/my-day')
  expect(await topEdgeBox(page)).toMatchObject({ opaque: true, fullWidth: true, atTop: true, tall: true })
  await page.context().close()
})

test('the shell colour is the page colour: no visible change in any theme or appearance', async ({ browser }) => {
  const page = await asUser(browser, { width: 390, height: 844 }, '/masar/my-day')
  for (const theme of ['ink', 'violet', 'teal']) {
    for (const mode of ['light', 'dark']) {
      const [body, shell] = await page.evaluate(([t, m]) => {
        document.documentElement.dataset.theme = t
        document.documentElement.classList.toggle('dark', m === 'dark')
        document.documentElement.classList.toggle('light', m === 'light')
        return [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.fixed.inset-0')!).backgroundColor]
      }, [theme, mode])
      expect(shell, `${theme} ${mode}`).toBe(body)
    }
  }
  await page.context().close()
})
