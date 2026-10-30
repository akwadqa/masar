import { readFileSync } from 'node:fs'
import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const USERS = {
  manager: 'qa.manager@masar-qa.invalid',
  member: 'qa.member@masar-qa.invalid',
  outsider: 'qa.outsider@masar-qa.invalid',
  admin: 'qa.admin@masar-qa.invalid',
  spare: 'qa.spare@masar-qa.invalid',
  reset: 'qa.reset@masar-qa.invalid'
} as const

/** Run-specific Space titles created by global-setup.ts. */
export const ALPHA = () => process.env.E2E_ALPHA ?? 'E2E Alpha'
export const BETA = () => process.env.E2E_BETA ?? 'E2E Beta'
export const GAMMA = () => process.env.E2E_GAMMA ?? 'E2E Gamma'

export function password(): string {
  const file = process.env.E2E_PASSWORD_FILE
  if (!file) throw new Error('Set E2E_PASSWORD_FILE to the file holding the E2E account password.')
  return readFileSync(file, 'utf8').trim()
}

export function uniqueTitle(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Signs in on Frappe's own login page (client revision 4: Masar has no login page of its own) and
 *  opens `path` of the Workspace afterwards. Returns once the Workspace has rendered that page: its
 *  router replaces the history entry a few times while it starts, and a `page.goto` issued before
 *  that ends is cancelled in WebKit ("interrupted by another navigation"). The page heading is
 *  rendered only after the router's initial navigation has finished. It is awaited as attached, not
 *  visible: on narrow phones a navbar title can be squeezed to zero width. */
export async function signIn(page: Page, email: string, secret = password(), path = '/masar/my-day') {
  await page.goto(`/login?redirect-to=${encodeURIComponent(path)}`)
  await fillFrappeLogin(page, email, secret)
  const expected = new URL(path, 'http://masar.invalid').pathname
  await expect(page).toHaveURL(url => url.pathname === expected)
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached()
}

export async function fillFrappeLogin(page: Page, email: string, secret: string) {
  await page.locator('#login_email').fill(email)
  await page.locator('#login_password').fill(secret)
  await page.locator('#login_password').press('Enter')
}

export async function openSpace(page: Page, title: string) {
  await page.goto('/masar/spaces')
  await page.getByRole('link', { name: new RegExp(`^${escapeRegExp(title)}, `) }).click()
  await expect(page.getByRole('list', { name: 'Tasks' })).toBeVisible()
}

/** Calls the Masar API from inside the signed-in page (same origin, same cookies). */
export async function pageApi<T>(page: Page, method: string, init: { params?: Record<string, string>, body?: unknown, csrf?: boolean } = {}) {
  return page.evaluate(async ({ method, init }) => {
    const query = init.params ? `?${new URLSearchParams(init.params)}` : ''
    // Frappe creates a session's CSRF token on first use; right after sign-in the page's own boot can
    // race this one and win, so a CSRF refusal is retried once with the stored token (as the Workspace does).
    for (let attempt = 0; ; attempt++) {
      let headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (init.body !== undefined && init.csrf !== false) {
        const boot = await fetch('/api/v2/method/masar.api.session.boot').then(r => r.json())
        headers = { ...headers, 'X-Frappe-CSRF-Token': boot.data.csrfToken }
      }
      const response = await fetch(`/api/v2/method/${method}${query}`, {
        method: init.body === undefined ? 'GET' : 'POST',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
      })
      const body = await response.json().catch(() => null)
      const csrfRefused = response.status === 400 && JSON.stringify(body).includes('CSRFTokenError')
      if (csrfRefused && init.csrf !== false && attempt === 0) continue
      return { status: response.status, body: body as T }
    }
  }, { method, init })
}

export async function apiLogin(request: APIRequestContext, email: string) {
  const response = await request.post('/api/method/login', { data: { usr: email, pwd: password() } })
  expect(response.status()).toBe(200)
}

/** Opens the command palette with the platform shortcut the app itself uses (⌘K on Apple, Ctrl+K elsewhere). */
export async function pressPaletteShortcut(page: Page) {
  const apple = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
  await page.keyboard.press(apple ? 'Meta+k' : 'Control+k')
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Picks `iso` (YYYY-MM-DD) in a DatePicker (client revision 3): opens the calendar of the field
 *  labelled `label`, pages to the month, and clicks the day. */
export async function pickDate(scope: Page | ReturnType<Page['locator']>, page: Page, label: string, iso: string) {
  await scope.getByRole('button', { name: label }).click()
  const cells = page.locator('[data-reka-calendar-cell-trigger]:not([data-outside-view])')
  await cells.first().waitFor()
  const day = page.locator(`[data-reka-calendar-cell-trigger][data-value="${iso}"]:not([data-outside-view])`)
  for (let i = 0; i < 24 && !(await day.count()); i++) {
    const shown = await cells.first().getAttribute('data-value')
    await page.getByRole('button', { name: shown! > iso ? 'Previous month' : 'Next month' }).click()
  }
  await day.click()
}
