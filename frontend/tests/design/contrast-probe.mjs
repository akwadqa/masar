// Colour-contrast probe for every theme and appearance: lists each failing element with its colours
// and ratio. Read-only (boot preferences are patched in the browser).
// Usage: node tests/design/contrast-probe.mjs <base> <email> <password-file> <path> [<path> …]
import AxeBuilder from '@axe-core/playwright'
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const [BASE, EMAIL, passwordFile, ...PATHS] = process.argv.slice(2)
const password = readFileSync(passwordFile, 'utf8').trim()
const browser = await chromium.launch()
let failures = 0
for (const theme of ['ink', 'violet', 'teal']) {
  for (const appearance of ['light', 'dark']) {
    const context = await browser.newContext({ colorScheme: appearance, viewport: { width: 1280, height: 800 } })
    await context.route('**/api/v2/method/masar.api.session.boot*', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      if (body.data?.preferences) body.data.preferences = { ...body.data.preferences, theme, appearance }
      await route.fulfill({ response, json: body })
    })
    const page = await context.newPage()
    await page.goto(`${BASE}/login`)
    await page.getByLabel('Email').fill(EMAIL)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(url => !url.pathname.startsWith('/login'))
    for (const path of PATHS) {
      await page.goto(`${BASE}${path}`)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(400)
      const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
      for (const node of result.violations.flatMap(v => v.nodes)) {
        failures++
        const data = node.any[0]?.data ?? {}
        console.log(`${theme}-${appearance} ${path} | ${node.target.join(' ')} | ${data.fgColor} on ${data.bgColor} = ${data.contrastRatio} | "${node.html.slice(0, 90)}"`)
      }
    }
    await context.close()
  }
}
console.log(`${failures} contrast failures`)
await browser.close()
