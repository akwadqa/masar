import { expect, test, type Browser, type Page } from '@playwright/test'
import { USERS, pageApi, signIn } from './helpers'

// Stabilization round 2 (docs/qa/stabilization-2026-10-29/round-2-fix-report.md): preferences changed
// quickly one after another all reach the server and survive a reload and a second session (QA-D05).
// The spare QA identity is used, and its preferences are put back to the defaults afterwards.
test.describe.configure({ mode: 'serial' })

const DEFAULTS = { theme: 'violet', appearance: 'light', full_width: true, pinned_spaces: [], email_notifications: true }

async function asUser(browser: Browser, email: string, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const page = await (await browser.newContext({ viewport, hasTouch: viewport.width < 600 })).newPage()
  await signIn(page, email)
  return page
}
type Prefs = { theme: string, appearance: string, fullWidth: boolean, emailNotifications: boolean }
const saved = async (page: Page) => (await pageApi<{ data: { preferences: Prefs } }>(page, 'masar.api.session.boot')).body.data.preferences
async function chooseInUserMenu(page: Page, section: 'Design theme' | 'Appearance', option: string) {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: section }).click()
  await page.getByRole('menuitemcheckbox', { name: new RegExp(`^${option}`) }).click()
  await page.keyboard.press('Escape')
}

test('QA-D05: theme, appearance, full width and e-mail changed in quick succession all persist', async ({ browser }) => {
  const page = await asUser(browser, USERS.spare)
  expect((await pageApi(page, 'masar.api.session.set_preferences', { body: DEFAULTS })).status).toBe(200)
  await page.reload()
  try {
    // Four changes without waiting for the server in between: their saves overlap.
    await chooseInUserMenu(page, 'Design theme', 'Ink & Signal')
    await chooseInUserMenu(page, 'Appearance', 'Dark')
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Full-width pages' }).click()
    await page.keyboard.press('Escape')
    await chooseInUserMenu(page, 'Design theme', 'Masar Teal')
    const want = { theme: 'teal', appearance: 'dark', fullWidth: false, emailNotifications: true }
    await expect.poll(() => saved(page)).toMatchObject(want)

    // A second, independent session and a reload see the same values; nothing reverts afterwards.
    const other = await asUser(browser, USERS.spare)
    expect(await saved(other)).toMatchObject(want)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'teal')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.waitForTimeout(1500)
    expect(await saved(page)).toMatchObject(want)
    expect(await saved(other)).toMatchObject(want)
    await other.context().close()
  } finally {
    await pageApi(page, 'masar.api.session.set_preferences', { body: DEFAULTS })
    await page.context().close()
  }
})
