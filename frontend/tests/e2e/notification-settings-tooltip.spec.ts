import { expect, test, type Browser, type Page } from '@playwright/test'
import { USERS, signIn } from './helpers'

// The notification settings button (the sliders icon beside "Mark all read") has no floating
// "Settings" tooltip on any screen size; it keeps its accessible name and opens the settings view.
async function asUser(browser: Browser, email: string, viewport: { width: number, height: number }): Promise<Page> {
  const page = await (await browser.newContext({ viewport, hasTouch: viewport.width < 600 })).newPage()
  await signIn(page, email)
  return page
}

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['390 px phone', { width: 390, height: 664 }], ['320 px phone', { width: 320, height: 568 }]] as const) {
  test(`notification settings button has no "Settings" tooltip (${label}); it still opens the settings`, async ({ browser }) => {
    const page = await asUser(browser, USERS.spare, viewport)
    await page.getByTestId('notification-bell').locator('visible=true').click()
    const settings = page.getByRole('button', { name: 'Notification settings', exact: true })
    await expect(settings).toBeVisible()
    // The panel opens with a short scale-in animation: measure once it has finished. A cancelled
    // animation (e.g. a hover colour transition) rejects its promise, so wait for all to settle.
    await page.evaluate(() => Promise.allSettled(document.getAnimations().map(animation => animation.finished)))
    const before = await settings.boundingBox()

    // Pointer: hover (desktop) or tap (phones), then wait past the tooltip delay.
    if (viewport.width < 600) await settings.tap({ trial: true })
    else await settings.hover()
    await page.waitForTimeout(900)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await expect(page.getByText('Settings', { exact: true })).toHaveCount(0)
    expect(await settings.getAttribute('title')).toBeNull()
    expect(await settings.boundingBox()).toEqual(before) // no layout shift

    // Keyboard: focus shows the focus ring and no tooltip; Enter opens the settings view.
    await settings.focus()
    await page.waitForTimeout(900)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Notification settings' })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'E-mail notifications' })).toBeVisible()
    await expect(page.getByRole('tooltip')).toHaveCount(0)

    // Back, then a real click / tap opens the settings again.
    await page.getByRole('button', { name: 'Back to notifications' }).click()
    if (viewport.width < 600) await settings.tap()
    else await settings.click()
    await expect(page.getByRole('heading', { name: 'Notification settings' })).toBeVisible()
    await page.waitForTimeout(900)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await page.context().close()
  })
}
