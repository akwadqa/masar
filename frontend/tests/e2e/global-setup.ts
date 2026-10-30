import { request, type FullConfig } from '@playwright/test'
import { USERS, password } from './helpers'

/**
 * Creates a fresh, isolated pair of Spaces for this run as the E2E administrator, so isolation
 * assertions never depend on shared fixture Spaces that people may edit on pre-production:
 *   Alpha: e2e.manager (owner, Manager) + e2e.member (Member)
 *   Beta:  e2e.outsider (owner, Manager)
 *   Gamma: e2e.manager (owner, Manager) + e2e.outsider (Member)
 * Titles are exported through environment variables (inherited by the test workers).
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!
  const api = await request.newContext({ baseURL })
  const login = await api.post('/api/method/login', { data: { usr: USERS.admin, pwd: password() } })
  if (!login.ok()) throw new Error(`E2E admin login failed: ${login.status()}`)
  const boot = await (await api.get('/api/v2/method/masar.api.session.boot')).json()
  const headers = { 'X-Frappe-CSRF-Token': boot.data.csrfToken }
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)

  async function call(method: string, data: Record<string, unknown>) {
    const response = await api.post(`/api/v2/method/${method}`, { data, headers })
    if (!response.ok()) throw new Error(`${method} failed: ${response.status()} ${await response.text()}`)
    return (await response.json()).data
  }

  const alphaTitle = `E2E Run ${stamp} Alpha`
  const betaTitle = `E2E Run ${stamp} Beta`
  const alpha = await call('masar.api.spaces.create', { data: { title: alphaTitle, owner: USERS.manager, category: 'Verification' } })
  await call('masar.api.spaces.add_member', { space: alpha.name, user: USERS.member, role: 'Member' })
  await call('masar.api.spaces.create', { data: { title: betaTitle, owner: USERS.outsider, category: 'Verification' } })
  // Gamma (Phase 5): a second Space managed by e2e.manager, with e2e.outsider as its only Member, so one
  // Batch can span Alpha and Gamma while each Member sees only their own Space's part.
  const gammaTitle = `E2E Run ${stamp} Gamma`
  const gamma = await call('masar.api.spaces.create', { data: { title: gammaTitle, owner: USERS.manager, category: 'Verification' } })
  await call('masar.api.spaces.add_member', { space: gamma.name, user: USERS.outsider, role: 'Member' })
  process.env.E2E_GAMMA = gammaTitle
  process.env.E2E_ALPHA = alphaTitle
  process.env.E2E_BETA = betaTitle
  await api.dispose()
}
