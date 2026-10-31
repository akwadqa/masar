import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import type { SpaceSummary, TaskDetail } from '../../app/types/api'
import { USERS, pageApi, signIn, uniqueTitle } from './helpers'

// Stabilization round 3 (docs/qa/stabilization-2026-10-29/round-3-fix-report.md): on phones every
// control of Space Settings fits the screen (QA-D03), the Batch header controls do not overlap (QA-D04),
// the Task header, description toolbar and Batch chip keep every control reachable (QA-D09, QA-D11),
// the bell's unread badge opens the notifications (QA-D08), and the confirmed accessibility defects stay
// fixed (QA-D10). Tablet and desktop keep their layout.
test.describe.configure({ mode: 'serial' })

const run = uniqueTitle('SR3').replace(/\s+/g, '-')
let space = ''
let batch = ''
let task = ''
const PHONES = [[320, 568], [360, 640], [375, 667], [390, 664], [390, 844], [412, 839], [430, 932]] as const

async function asUser(browser: Browser, email: string, viewport: { width: number, height: number }, path?: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport, hasTouch: viewport.width < 600 })).newPage()
  await signIn(page, email, undefined, path)
  return page
}
async function api<T>(page: Page, method: string, body?: Record<string, unknown>) {
  return pageApi<{ data: T }>(page, method, { body })
}
function isoDay(offset: number) {
  const day = new Date()
  day.setDate(day.getDate() + offset)
  return day.toISOString().slice(0, 10)
}

/** Every visible control inside `scope` lies within the viewport and is not covered by another element;
 *  controls in a row that scrolls sideways on purpose (the Space tabs) count as reachable. */
async function unreachableControls(page: Page, scope = 'body') {
  return page.evaluate((scope) => {
    const vw = innerWidth, vh = innerHeight
    const root = document.querySelector(scope) ?? document.body
    const inSideScroller = (e: Element) => {
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a)
        if (/(auto|scroll)/.test(s.overflowX) && a.scrollWidth > a.clientWidth + 1) return true
      }
      return false
    }
    const shown = (e: Element) => {
      const r = e.getBoundingClientRect(), s = getComputedStyle(e)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !e.closest('[inert],[aria-hidden="true"],.sr-only')
    }
    const name = (e: Element) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 40)
    // Only controls inside the visible part of their scroll area can be checked for being covered:
    // above it they sit, correctly, under the page header.
    let top = 0, bottom = vh
    for (let a = root.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a)
      if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight + 1) {
        const r = a.getBoundingClientRect()
        top = Math.max(0, r.top)
        bottom = Math.min(vh, r.bottom)
        break
      }
    }
    const problems: string[] = []
    for (const e of root.querySelectorAll('button, a[href], [role="combobox"], [role="switch"], input:not([type="hidden"]), textarea')) {
      if (!shown(e)) continue
      const r = e.getBoundingClientRect()
      if ((r.right > vw + 1 || r.left < -1) && !inSideScroller(e)) problems.push(`off screen: ${name(e)}`)
      else if (r.top >= top && r.bottom <= bottom && r.right <= vw && r.left >= 0) {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (hit && hit !== e && !e.contains(hit) && !hit.contains(e)) problems.push(`covered: ${name(e)}`)
      }
    }
    if (document.documentElement.scrollWidth > vw + 1) problems.push('page scrolls sideways')
    return problems
  }, scope)
}

/** The accessible names (aria-label) of the controls axe reports for the two QA-D10 rules. */
async function axeFindings(page: Page) {
  const results = await new AxeBuilder({ page }).withRules(['label-content-name-mismatch', 'nested-interactive']).analyze()
  const names: string[] = []
  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      const name = await page.locator(String(node.target[0])).first().getAttribute('aria-label').catch(() => null)
      names.push(violation.id === 'nested-interactive' ? `nested: ${name ?? node.target.join(' ')}` : (name ?? node.target.join(' ')))
    }
  }
  return names
}

test.beforeAll(async ({ browser }) => {
  const admin = await asUser(browser, USERS.admin, { width: 1440, height: 900 })
  space = (await api<SpaceSummary>(admin, 'masar.api.spaces.create', { data: { title: `${run} Space`, owner: USERS.manager, category: 'Verification' } })).body.data.name
  await api(admin, 'masar.api.spaces.add_member', { space, user: USERS.member, role: 'Member' })
  await admin.context().close()
  const manager = await asUser(browser, USERS.manager, { width: 1440, height: 900 })
  task = (await api<{ task: TaskDetail }>(manager, 'masar.api.tasks.create', { space, title: `${run} task`, client_request_id: crypto.randomUUID() })).body.data.task.name
  const feature = (await api<{ name: string }>(manager, 'masar.api.features.create', { space, title: `${run} feature`, roadmap: 'Now' })).body.data.name
  expect((await api(manager, 'masar.api.tasks.update', { task, changes: { feature } })).status).toBe(200)
  batch = (await api<{ batch: { name: string } }>(manager, 'masar.api.batches.create', { batch_name: `${run} Batch with a rather long title`, start_date: isoDay(0), end_date: isoDay(13), client_request_id: crypto.randomUUID() })).body.data.batch.name
  await api(manager, 'masar.api.batches.move_tasks', { tasks: [task], batch: batch })
  expect((await api(manager, 'masar.api.batches.start', { batch: batch, request_id: crypto.randomUUID() })).status).toBe(200)
  await manager.context().close()
})

test('QA-D03: Space Settings fits every phone screen, also with a long member name and e-mail', async ({ browser }) => {
  for (const [width, height] of PHONES) {
    const page = await asUser(browser, USERS.manager, { width, height }, `/masar/spaces/${space}/settings`)
    await expect(page.getByRole('list', { name: 'Space members' })).toBeVisible()
    // A long name and e-mail (displayed text only) must not widen the page.
    await page.locator('[data-member] p').first().evaluate((p) => { p.firstChild!.textContent = 'Maximiliana Alexandra Fitzgerald-Montgomery ' })
    await page.locator('[data-member] p.text-xs').first().evaluate((p) => { p.textContent = 'maximiliana.alexandra.fitzgerald-montgomery@example.invalid' })
    await page.waitForTimeout(100)
    for (const card of await page.locator('.masar-boxed > div').all()) {
      expect((await card.boundingBox())!.width, `${width} px: card width`).toBeLessThanOrEqual(width)
    }
    // Scroll through the page so every control is checked inside the viewport.
    const scroller = page.locator('.masar-boxed').locator('xpath=..')
    const total = await scroller.evaluate(node => node.scrollHeight)
    for (let top = 0; top < total; top += height / 2) {
      await scroller.evaluate((node, top) => { node.scrollTop = top }, top)
      // The Category menu's end trigger lies under its Clear button by design (QA-D10): that spot clears
      // the field, as it did when the button was nested inside the trigger.
      const problems = (await unreachableControls(page, '.masar-boxed')).filter(problem => problem !== 'covered: Show options')
      expect(problems, `${width} px at scroll ${top}`).toEqual([])
    }
    // The role selector and remove button of the long row are still there and usable.
    const row = page.locator('[data-member]').filter({ hasText: 'Maximiliana' })
    for (const control of [row.getByRole('button', { name: /^Remove / }), row.locator('[aria-label^="Role of "]')]) {
      await control.scrollIntoViewIfNeeded()
      const box = (await control.boundingBox())!
      expect(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height, `${width} px: ${JSON.stringify(box)}`).toBe(true)
    }
    await page.context().close()
  }
})

test('QA-D04: the Batch header controls do not overlap on phones and the Finish Batch action works', async ({ browser }) => {
  for (const [width, height] of PHONES) {
    const page = await asUser(browser, USERS.manager, { width, height }, `/masar/batches/${batch}`)
    const finish = page.getByRole('button', { name: 'Finish Batch' })
    await expect(finish).toBeVisible()
    expect(await unreachableControls(page, '[data-slot="header"]'), `${width} px`).toEqual([])
    for (const name of ['Open sidebar', 'All Batches', 'More Batch actions']) {
      await expect(page.getByRole('button', { name }).or(page.getByRole('link', { name })).first(), `${width} px: ${name}`).toBeInViewport({ ratio: 1 })
    }
    // On phones the action shows its icon only and the Batch title keeps room.
    await expect(finish.getByText('Finish Batch', { exact: true })).toBeHidden()
    // 320 px: the status badge leaves the title its first characters only (owner decision pending, see
    // the round 3 report); from 360 px at least 40 px of title are shown.
    expect((await page.getByRole('heading', { level: 1 }).first().boundingBox())!.width, `${width} px: title width`).toBeGreaterThanOrEqual(width >= 360 ? 40 : 8)
    await finish.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await expect(page.getByRole('link', { name: 'My Day', exact: true })).toBeVisible()
    await page.context().close()
  }
})

for (const where of ['page', 'panel'] as const) {
  test(`QA-D09: Task ${where} header and description toolbar keep every control reachable on phones`, async ({ browser }) => {
    for (const [width, height] of PHONES) {
      const path = where === 'page' ? `/masar/tasks/${task}` : `/masar/spaces/${space}/tasks?task=${task}`
      const page = await asUser(browser, USERS.manager, { width, height }, path)
      const scope = where === 'page' ? 'body' : '[role="dialog"]'
      const description = page.getByRole('region', { name: 'Description' })
      const addLink = description.getByRole('button', { name: 'Add link' })
      await expect(addLink).toBeVisible()
      // Add link sits inside the description box and opens its link form.
      const box = (await description.boundingBox())!
      const link = (await addLink.boundingBox())!
      expect(link.x + link.width, `${width} px: Add link inside the editor`).toBeLessThanOrEqual(box.x + box.width)
      await addLink.click()
      await expect(page.getByRole('textbox', { name: 'Link address' })).toBeVisible()
      await page.keyboard.press('Escape')
      // The Space link's icon never overlaps the Feature button.
      const header = page.locator(scope).getByTestId('task-feature').locator('xpath=ancestor::header[1]')
      const spaceIcon = (await header.locator('a[href*="/spaces/"] > span').first().boundingBox())!
      const feature = (await header.getByTestId('task-feature').boundingBox())!
      expect(spaceIcon.x + spaceIcon.width, `${width} px: Space icon before the Feature button`).toBeLessThanOrEqual(feature.x)
      expect(await unreachableControls(page, `${scope} header`), `${width} px header`).toEqual([])
      // QA-D11: the Batch chip with a long Batch name stays inside the screen.
      const chip = (await page.locator(scope).getByTestId('task-batch').boundingBox())!
      expect(chip.x + chip.width, `${width} px: Batch chip`).toBeLessThanOrEqual(width)
      await page.context().close()
    }
  })
}

test('tablet and desktop keep their layout (no wrapping introduced)', async ({ browser }) => {
  for (const [width, height] of [[768, 1024], [1440, 900]] as const) {
    const page = await asUser(browser, USERS.manager, { width, height }, `/masar/spaces/${space}/settings`)
    const row = page.locator('[data-member]').first()
    await expect(row).toBeVisible()
    expect(await row.evaluate(node => getComputedStyle(node).flexWrap)).toBe('nowrap')
    await page.goto(`/masar/batches/${batch}`)
    await expect(page.getByRole('button', { name: 'Finish Batch' }).getByText('Finish Batch', { exact: true })).toBeVisible()
    await page.goto(`/masar/tasks/${task}`)
    const toolbarBase = page.getByRole('region', { name: 'Description' }).getByRole('button', { name: 'Add link' }).locator('xpath=ancestor::div[@data-slot="base"][1]')
    expect(await toolbarBase.evaluate(node => getComputedStyle(node).flexWrap)).toBe('nowrap')
    await page.context().close()
  }
})

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['390 px phone', { width: 390, height: 664 }], ['320 px phone', { width: 320, height: 568 }]] as const) {
  test(`QA-D08: a tap or click on the unread badge opens the notifications like the bell (${label})`, async ({ browser }) => {
    // The manager has unread notifications from the setup above (Space ownership).
    const page = await asUser(browser, USERS.manager, viewport)
    const bell = page.getByTestId('notification-bell').locator('visible=true').first()
    await expect(bell).toHaveAccessibleName(/Notifications, \d+ unread/)
    const badge = (await bell.locator('xpath=..').locator('[data-slot="base"]').boundingBox())!
    const at = { x: badge.x + badge.width / 2, y: badge.y + badge.height / 2 }
    const panel = page.locator('section[aria-label="Notifications"]').locator('visible=true')
    if (viewport.width < 600) await page.touchscreen.tap(at.x, at.y)
    else await page.mouse.click(at.x, at.y)
    await expect(panel).toHaveCount(1)
    // Same toggle as the bell: a second tap or click on the badge closes it again.
    if (viewport.width < 600) await page.touchscreen.tap(at.x, at.y)
    else await page.mouse.click(at.x, at.y)
    await expect(panel).toHaveCount(0)
    // Keyboard and name are unchanged; no "Settings" tooltip comes back.
    await bell.focus()
    await page.keyboard.press('Enter')
    await expect(panel).toHaveCount(1)
    await page.getByRole('button', { name: 'Notification settings', exact: true }).hover()
    await page.waitForTimeout(800)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await page.context().close()
  })
}

test('QA-D10: the corrected controls name their visible text, nothing is nested, and focus never lands on a hidden control', async ({ browser, browserName }) => {
  const page = await asUser(browser, USERS.manager, { width: 1440, height: 900 }, `/masar/spaces/${space}/tasks?task=${task}`)
  await expect(page.getByRole('dialog')).toBeVisible()
  // Visible text in the accessible name.
  await expect(page.getByRole('button', { name: 'Add filter' })).toContainText('Filter')
  await expect(page.getByRole('dialog').getByRole('button', { name: /^1 person: E2E Manager/ })).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Add labels' })).toBeVisible()
  await expect(page.getByRole('dialog').getByTestId('remaining-estimate')).toHaveAccessibleName(/^Remaining (not estimated|\d)/)
  await expect(page.getByRole('button', { name: /^E2E Manager, account menu$/ })).toBeVisible()
  // The Task panel's first Tab stop is a visible control (the hidden "Close" is gone; "Close panel" stays).
  await page.getByRole('dialog').focus()
  await page.keyboard.press('Tab')
  const first = await page.evaluate(() => { const e = document.activeElement!; const r = e.getBoundingClientRect(); return { inHidden: !!e.closest('.sr-only'), w: r.width, h: r.height } })
  expect(first.inHidden).toBe(false)
  expect(first.w).toBeGreaterThan(1)
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Close panel' })).toBeVisible()
  // Reviewed and accepted (round 3 report): avatar initials and keyboard hints are visible text that is not the label.
  const accepted = /, account menu$|^\d+ members?:|^Features panel$|^Versions panel$/
  expect((await axeFindings(page)).filter(name => !accepted.test(name))).toEqual([])

  // Space Settings: the completion date names what it shows, and the category's Clear is not nested.
  await page.goto(`/masar/spaces/${space}/settings`)
  await expect(page.getByRole('button', { name: 'Completion date: Choose a date' })).toBeVisible()
  const clear = page.getByRole('button', { name: 'Clear category' })
  await expect(clear).toBeVisible()
  expect(await clear.evaluate(node => !!node.parentElement!.closest('button'))).toBe(false)
  expect((await axeFindings(page)).filter(name => !accepted.test(name))).toEqual([])
  // Keyboard: Clear category is reachable with Tab from the category input and clears it (Safari moves
  // to buttons with Option+Tab).
  await page.getByRole('combobox', { name: 'Category' }).focus()
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
  for (let i = 0; i < 3 && !(await clear.evaluate(node => node === document.activeElement)); i++) await page.keyboard.press(tab)
  await expect(clear).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('combobox', { name: 'Category' })).toHaveValue('')
  await page.context().close()
})

