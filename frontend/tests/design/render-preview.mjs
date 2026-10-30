// Renders docs/design/client-revision/preview/directions.html: one PNG per preview frame.
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../../docs/design/client-revision/preview/', import.meta.url))
const names = ['a-list', 'a-detail', 'a-plan', 'a-roadmap', 'a-phone', 'b-list', 'b-detail', 'b-plan', 'b-roadmap', 'b-phone',
  'c-list', 'c-detail', 'c-plan', 'c-roadmap', 'c-phone', 'a-dark-list', 'a-dark-detail']
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`file://${root}directions.html`)
await page.waitForLoadState('networkidle')
await page.waitForTimeout(800)
for (const [i, name] of names.entries()) await page.locator(`#f${i}`).screenshot({ path: `${root}${name}.png` })
await browser.close()
console.log('rendered', names.length)
