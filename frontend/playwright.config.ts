import { defineConfig, devices } from '@playwright/test'

// E2E against a running Workspace + Frappe (local dev server or the deployed domain).
//   E2E_BASE_URL       default http://localhost:3000
//   E2E_PASSWORD_FILE  file containing the shared password of the E2E accounts (never committed)
// Projects: `npm run e2e` (Chromium) and `npm run e2e:webkit` (WebKit, Safari's engine). Run each
// against fresh fixtures: several specs change the shared global-setup Tasks.
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: false
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The push-only service worker (ADR-064) is blocked here: page.route() does not see requests that
    // pass through it, so the failed-save specs could not fail a request, and in Playwright's WebKit
    // pushManager.getSubscription() (run when the bell opens) freezes the page. R10 allows it again.
    { name: 'webkit', use: { ...devices['Desktop Safari'], serviceWorkers: 'block' } }
  ]
})
