// Client revision 3 evidence: the Spaces menu, avatar colours in the People column and the Batch header,
// in light and dark. Read-only. Usage: node tests/design/capture-cr3.mjs <base> <email> <password-file> <out>
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const [BASE, EMAIL, passwordFile, OUT] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
for (const scheme of ['light', 'dark']) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, timezoneId: 'Asia/Qatar' })).newPage()
  await page.goto(`${BASE}/login`)
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(readFileSync(passwordFile, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  const api = method => page.evaluate(async m => (await fetch(`/api/v2/method/masar.api.${m}`).then(r => r.json())).data, method)
  const settle = async () => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(700) }

  await page.goto(`${BASE}/my-day`); await settle()
  await page.getByRole('button', { name: /Browse all Spaces/ }).click(); await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/${scheme}-spaces-menu.png`, clip: { x: 0, y: 0, width: 760, height: 620 } })
  await page.keyboard.press('Escape')

  const spaces = await api('spaces.list')
  const busy = [...spaces].sort((a, b) => (b.openTaskCount ?? 0) - (a.openTaskCount ?? 0))[0]
  await page.goto(`${BASE}/spaces/${busy.name}/tasks`); await settle()
  await page.screenshot({ path: `${OUT}/${scheme}-people-column.png`, clip: { x: 760, y: 250, width: 680, height: 420 } })

  const batches = (await api('batches.list')).items
  const batch = batches.find(b => b.status === 'Active') ?? batches[0]
  if (batch) {
    await page.goto(`${BASE}/batches/${batch.name}`); await settle()
    await page.screenshot({ path: `${OUT}/${scheme}-batch-header.png`, clip: { x: 0, y: 0, width: 1440, height: 320 } })
  }
  await page.context().close()
}
await browser.close()
