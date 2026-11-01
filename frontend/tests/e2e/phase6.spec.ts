import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import type { SpaceSummary, TaskComment, TaskDetail, TimelinePage } from '../../app/types/api'
import { ALPHA, USERS, pageApi, signIn, uniqueTitle } from './helpers'

// Phase 6 acceptance (docs/phases/phase-6.md §2): comments, mentions, reactions, links, private files,
// timeline, notifications. Alpha: e2e.manager (Manager) + e2e.member (Member); e2e.spare joins and leaves.
test.describe.configure({ mode: 'serial' })

let alpha = ''
let task = ''
const run = uniqueTitle('P6').replace(/\s+/g, '-')
const taskTitle = `${run} discussion`
// A real 1×1 PNG (valid signature); unique bytes per run so Frappe never reuses another file.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function asUser(browser: Browser, email: string, viewport?: { width: number, height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage()
  await signIn(page, email)
  return page
}
async function api<T>(page: Page, method: string, body?: Record<string, unknown>, params?: Record<string, string>) {
  return pageApi<{ data: T }>(page, method, { body, params })
}
const editor = (page: Page) => page.getByTestId('comment-editor')
const comments = (page: Page) => page.locator('[data-comment]')
async function postComment(page: Page, text: string) {
  await editor(page).click()
  await page.keyboard.type(text)
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(comments(page).filter({ hasText: text })).toBeVisible()
}
async function timeline(page: Page, view = 'comments') {
  return (await api<TimelinePage>(page, 'masar.api.comments.timeline', undefined, { task, view, limit: '100' })).body.data
}

test.beforeAll(async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  alpha = (await api<SpaceSummary[]>(manager, 'masar.api.spaces.list')).body.data.find(s => s.title === ALPHA())!.name
  task = (await api<{ task: TaskDetail }>(manager, 'masar.api.tasks.create', { space: alpha, title: taskTitle, client_request_id: crypto.randomUUID() })).body.data.task.name
  await manager.context().close()
})

test('1–3: two members discuss with rich text and a mention that resolves to the account', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  await member.goto(`/masar/tasks/${task}`)
  await editor(member).click()
  await member.keyboard.type('Plan: ')
  await member.getByRole('region', { name: 'Activity' }).getByRole('button', { name: 'Bold' }).click()
  await member.keyboard.type('ship it')
  await member.getByRole('region', { name: 'Activity' }).getByRole('button', { name: 'Bold' }).click()
  await member.keyboard.type(' — over to @Manag')
  await member.getByRole('option', { name: /E2E Manager/ }).click()
  await member.keyboard.type(' <script>alert(1)</script>')
  await member.getByRole('button', { name: 'Comment', exact: true }).click()
  const posted = comments(member).filter({ hasText: 'ship it' })
  await expect(posted).toBeVisible()

  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/tasks/${task}`)
  const seen = comments(manager).filter({ hasText: 'ship it' })
  await expect(seen.locator('strong')).toHaveText('ship it')
  await expect(seen.locator(`[data-type="mention"][data-id="${USERS.manager}"]`)).toHaveText('@E2E Manager')
  await expect(seen).toContainText('<script>alert(1)</script>') // typed text stays text
  expect(await seen.locator('script').count()).toBe(0)
  await postComment(manager, `${run} reply from the manager`)
  await member.reload()
  await expect(comments(member).filter({ hasText: 'reply from the manager' })).toBeVisible()
  for (const page of [member, manager]) await page.context().close()
})

test('4–6: authors edit their own words, Managers moderate, reactions stay consistent', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  await member.goto(`/masar/tasks/${task}`)
  await postComment(member, `${run} draft wording`)
  const mine = comments(member).filter({ hasText: 'draft wording' })
  await mine.getByRole('button', { name: /Comment actions/ }).click()
  await member.getByRole('menuitem', { name: 'Edit' }).click()
  await mine.getByTestId('comment-editor').click()
  await member.keyboard.press('End')
  await member.keyboard.type(' (final)')
  await mine.getByRole('button', { name: 'Save' }).click()
  await expect(comments(member).filter({ hasText: 'draft wording (final)' })).toContainText('(edited)')
  // Members cannot edit or delete someone else's comment.
  const managersComment = comments(member).filter({ hasText: 'reply from the manager' })
  await managersComment.getByRole('button', { name: /Comment actions/ }).click()
  await expect(member.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0)
  await expect(member.getByRole('menuitem', { name: /Delete|Remove/ })).toHaveCount(0)
  await member.keyboard.press('Escape')

  // Reactions from two people; counts survive a reload.
  await managersComment.getByRole('button', { name: 'Add reaction' }).click()
  await member.getByRole('button', { name: 'Thumbs up' }).click()
  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/tasks/${task}`)
  const own = comments(manager).filter({ hasText: 'reply from the manager' })
  await own.getByRole('button', { name: /Thumbs up: 1/ }).click()
  await expect(own.getByRole('button', { name: /Thumbs up: 2, including you/ })).toBeVisible()
  await manager.reload()
  await expect(comments(manager).filter({ hasText: 'reply from the manager' }).getByRole('button', { name: /Thumbs up: 2/ })).toBeVisible()

  // Moderation: the Manager removes the Member's comment; author and evidence are kept.
  const target = comments(manager).filter({ hasText: 'draft wording (final)' })
  await target.getByRole('button', { name: /Comment actions/ }).click()
  await expect(manager.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0) // never edits others' words
  await manager.getByRole('menuitem', { name: 'Remove (moderation)' }).click()
  await manager.getByRole('button', { name: 'Remove comment' }).click()
  await expect(manager.getByText('This comment was removed by E2E Manager.')).toBeVisible()
  const removed = (await timeline(manager)).items.find(i => i.kind === 'comment' && i.comment.isDeleted)
  expect(removed && removed.kind === 'comment' && [removed.comment.author?.name, removed.comment.content]).toEqual([USERS.member, null])
  await manager.getByRole('tab', { name: 'History' }).click()
  await expect(manager.getByText('E2E Manager removed a comment by E2E Member')).toBeVisible()
  for (const page of [member, manager]) await page.context().close()
})

test('7, 11: a comment link opens the comment in a new session; timeline filters', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const first = (await timeline(manager)).items.find(i => i.kind === 'comment' && !i.comment.isDeleted)
  const commentName = first && first.kind === 'comment' ? first.comment.name : ''
  // Push it off the newest page: the whole timeline is loaded, so the link still finds it (client revision 6, R3).
  for (let i = 0; i < 35; i++) {
    await api(manager, 'masar.api.comments.create', { task, content: `<p>${run} filler ${i}</p>`, client_request_id: crypto.randomUUID() })
  }
  await manager.context().close()

  const member = await asUser(browser, USERS.member)
  await member.goto(`/masar/tasks/${task}?comment=${commentName}`)
  const target = member.locator(`[data-comment="${commentName}"]`)
  await expect(target).toBeInViewport()
  await expect(target).toHaveClass(/ring-2/)
  await expect(member.getByRole('button', { name: /Show (newer|earlier) activity/ })).toHaveCount(0)
  await member.goto(`/masar/tasks/${task}`)
  await member.getByRole('tab', { name: 'History' }).click()
  await expect(member.getByText(/created the task/)).toBeVisible()
  await member.getByRole('tab', { name: 'Worklog' }).click()
  await expect(member.getByText('No time logged yet.')).toBeVisible() // Phase 7: a real Worklog
  await member.context().close()
})

test('8–9: private attachments upload, download, and a pasted image persists', async ({ browser }) => {
  const member = await asUser(browser, USERS.member)
  await member.goto(`/masar/tasks/${task}`)
  const bytes = Buffer.concat([Buffer.from(PNG_BASE64, 'base64'), Buffer.from(run)])
  await member.getByTestId('attachment-input').setInputFiles({ name: `${run}-spec.png`, mimeType: 'image/png', buffer: bytes })
  const link = member.getByRole('link', { name: `${run}-spec.png`, exact: true })
  await expect(link).toBeVisible()
  const url = await link.getAttribute('href')
  expect(url).toMatch(/^\/private\/files\//)
  const download = await member.evaluate(async u => { const r = await fetch(u!); return { status: r.status, size: (await r.arrayBuffer()).byteLength } }, url)
  expect(download).toEqual({ status: 200, size: bytes.length })

  // Paste an image into the composer, submit, reload: the image is stored privately and shown.
  await editor(member).click()
  await member.keyboard.type(`${run} pasted screenshot `)
  await member.evaluate(async ({ b64, name }) => {
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const file = new File([data, new TextEncoder().encode(name)], `${name}.png`, { type: 'image/png' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    document.querySelector('[data-testid="comment-editor"]')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  }, { b64: PNG_BASE64, name: `${run}-paste` })
  await expect(editor(member).locator('img')).toHaveAttribute('src', /^\/private\/files\//)
  await member.getByRole('button', { name: 'Comment', exact: true }).click()
  await member.reload()
  const pasted = comments(member).filter({ hasText: 'pasted screenshot' })
  const img = pasted.locator('img')
  await expect(img).toBeVisible()
  expect(await img.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(1)
  await member.context().close()
})

test('10, G: a removed member loses comments, links and private files', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  await api(manager, 'masar.api.spaces.add_member', { space: alpha, user: USERS.spare, role: 'Member' })
  const spare = await asUser(browser, USERS.spare)
  await spare.goto(`/masar/tasks/${task}`)
  const bytes = Buffer.concat([Buffer.from(PNG_BASE64, 'base64'), Buffer.from(`${run}-spare`)])
  await spare.getByTestId('attachment-input').setInputFiles({ name: `${run}-spare.png`, mimeType: 'image/png', buffer: bytes })
  const url = await spare.getByRole('link', { name: `${run}-spare.png`, exact: true }).getAttribute('href')
  await postComment(spare, `${run} written by spare`)
  const mine = (await timeline(spare)).items.find(i => i.kind === 'comment' && i.comment.content?.includes('written by spare'))
  const commentName = mine && mine.kind === 'comment' ? mine.comment.name : ''
  expect(await spare.evaluate(async u => (await fetch(u!)).status, url)).toBe(200)

  await api(manager, 'masar.api.spaces.remove_member', { space: alpha, user: USERS.spare })
  await manager.context().close()
  // Same session, same saved links: everything is refused by the server now.
  expect(await spare.evaluate(async u => (await fetch(u!, { cache: 'no-store' })).status, url)).toBe(403)
  expect((await pageApi(spare, 'masar.api.comments.get', { params: { comment: commentName } })).status).toBe(404)
  expect((await pageApi(spare, 'masar.api.comments.timeline', { params: { task } })).status).toBe(404)
  const fileList = await spare.evaluate(async u => (await fetch(`/api/resource/File?filters=${encodeURIComponent(JSON.stringify([['file_url', '=', u]]))}`)).json(), url)
  expect(fileList.data ?? []).toEqual([])
  await spare.goto(`/masar/tasks/${task}?comment=${commentName}`)
  await expect(spare.getByText('Task not found')).toBeVisible()
  await expect(spare.getByText('written by spare')).toHaveCount(0)
  await spare.context().close()
})

test('I, J, P: outsiders cannot read, write or download anything', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const files = (await api<Array<{ url: string }>>(manager, 'masar.api.attachments.list', undefined, { task })).body.data
  const someComment = (await timeline(manager)).items.find(i => i.kind === 'comment')!
  await manager.context().close()
  const outsider = await asUser(browser, USERS.outsider)
  expect(await outsider.evaluate(async u => (await fetch(u)).status, files[0]!.url)).toBe(403)
  expect((await pageApi(outsider, 'masar.api.comments.timeline', { params: { task } })).status).toBe(404)
  expect((await pageApi(outsider, 'masar.api.comments.create', { body: { task, content: '<p>x</p>', client_request_id: crypto.randomUUID() } })).status).toBe(404)
  const commentName = someComment.kind === 'comment' ? someComment.comment.name : ''
  expect((await pageApi(outsider, 'masar.api.comments.react', { body: { comment: commentName, emoji: 'heart', active: true } })).status).toBe(404)
  const generic = await outsider.evaluate(async c => (await fetch(`/api/resource/Masar Comment/${c}`)).status, commentName)
  expect(generic).toBe(403)
  const upload = await outsider.evaluate(async t => {
    const token = (await fetch('/api/v2/method/masar.api.session.boot').then(r => r.json())).data.csrfToken
    const body = new FormData()
    body.append('task', t)
    body.append('file', new File(['hello'], 'x.txt', { type: 'text/plain' }))
    return (await fetch('/api/v2/method/masar.api.attachments.upload', { method: 'POST', headers: { 'X-Frappe-CSRF-Token': token }, body })).status
  }, task)
  expect(upload).toBe(404)
  await outsider.context().close()
  // Signed out: private files are refused too.
  const anonymous = await (await browser.newContext()).newPage()
  await anonymous.goto('/login')
  expect(await anonymous.evaluate(async u => (await fetch(u)).status, files[0]!.url)).toBe(403)
  await anonymous.context().close()
})

test('12: one notification per member, verified in the isolated mail sink', async ({ browser }) => {
  const mailpit = process.env.E2E_MAILPIT_URL
  test.skip(!mailpit, 'No mail sink configured for this environment (external SMTP pending).')
  const manager = await asUser(browser, USERS.manager)
  const marker = `${run} notify-${Date.now()}`
  const since = Date.now() - 2000
  await api(manager, 'masar.api.comments.create', {
    task,
    content: `<p>${marker} <span data-type="mention" data-id="${USERS.member}" data-label="E2E Member">@E2E Member</span></p>`,
    client_request_id: crypto.randomUUID()
  })
  await manager.context().close()
  const search = async () => {
    // Match this comment's own marker (in the body): mail for earlier comments may still be arriving.
    const response = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`subject:"${taskTitle}" "${marker}"`)}&limit=200`)
    return ((await response.json()).messages ?? []) as Array<{ Subject: string, To: Array<{ Address: string }>, Created: string }>
  }
  await expect.poll(async () => (await search()).filter(m => new Date(m.Created).getTime() >= since && m.Subject.includes('mentioned you')).length, { timeout: 30_000 }).toBeGreaterThan(0)
  // Only mail for this comment; one message per recipient.
  const messages = (await search()).filter(m => new Date(m.Created).getTime() >= since)
  const latest = new Map<string, string>()
  for (const m of messages) {
    expect(latest.has(m.To[0]!.Address), `duplicate mail to ${m.To[0]!.Address}`).toBe(false)
    latest.set(m.To[0]!.Address, m.Subject)
  }
  expect(latest.get(USERS.member)).toContain('mentioned you')
  expect(latest.get(USERS.manager)).toContain('commented on')
  expect(latest.has(USERS.outsider)).toBe(false)
  expect(latest.has(USERS.spare)).toBe(false) // removed in scenario 10
})

test('13: simultaneous comments and duplicate reactions stay consistent', async ({ browser }) => {
  const manager = await asUser(browser, USERS.manager)
  const member = await asUser(browser, USERS.member)
  const key = crypto.randomUUID()
  const posts = await Promise.all([
    api<{ comment: TaskComment }>(manager, 'masar.api.comments.create', { task, content: `<p>${run} race A</p>`, client_request_id: key }),
    api<{ comment: TaskComment }>(manager, 'masar.api.comments.create', { task, content: `<p>${run} race A</p>`, client_request_id: key }),
    api<{ comment: TaskComment }>(member, 'masar.api.comments.create', { task, content: `<p>${run} race B</p>`, client_request_id: crypto.randomUUID() })
  ])
  expect(posts.map(p => p.status)).toEqual([200, 200, 200])
  expect(posts[0]!.body.data.comment.name).toBe(posts[1]!.body.data.comment.name)
  const target = posts[2]!.body.data.comment.name
  await Promise.all([1, 2, 3].map(() => api(manager, 'masar.api.comments.react', { comment: target, emoji: 'tada', active: true })))
  const after = (await api<TaskComment>(member, 'masar.api.comments.get', undefined, { comment: target })).body.data
  expect(after.reactions.find(r => r.emoji === 'tada')?.count).toBe(1)
  const items = (await timeline(member)).items.filter(i => i.kind === 'comment' && i.comment.content?.includes(`${run} race A`))
  expect(items).toHaveLength(1)
  for (const page of [manager, member]) await page.context().close()
})

test('15: phone layout and keyboard submit work; accessibility', async ({ browser }) => {
  const member = await asUser(browser, USERS.member, { width: 360, height: 740 })
  await member.goto(`/masar/spaces/${alpha}/tasks?task=${task}&q=${encodeURIComponent(taskTitle)}`)
  await editor(member).click()
  await member.keyboard.type(`${run} sent from a phone`)
  await member.keyboard.press('ControlOrMeta+Enter')
  await expect(comments(member).filter({ hasText: 'sent from a phone' })).toBeVisible()
  const overflow = await member.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await member.context().close()

  const manager = await asUser(browser, USERS.manager)
  await manager.goto(`/masar/tasks/${task}`)
  await manager.waitForLoadState('networkidle')
  const results = await new AxeBuilder({ page: manager }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)
  expect(serious).toEqual([])
  await manager.context().close()
})
