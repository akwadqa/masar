// Puts the generated Workspace into the Frappe app (client revision 4), so the app is complete on its
// own and can be installed on any Frappe / ERPNext site:
//   backend/masar/www/masar.html      the page Frappe serves at /masar (and /masar/..., hooks.py)
//   backend/masar/public/frontend/    scripts, styles, fonts and icons, served at /assets/masar/frontend/
//   backend/masar/public/frontend/build.json   a hash of the Workspace sources this build came from
// Usage (from frontend/):  npm run build:app          generate, then install
//                          node scripts/install-into-app.mjs --check   fail if the installed build is
//                                                                       older than the sources
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..')
// The Frappe app: backend/masar in the development repository, masar/ at the root of the release repository.
const APP = existsSync(join(FRONTEND, '..', 'backend', 'masar')) ? join(FRONTEND, '..', 'backend', 'masar') : join(FRONTEND, '..', 'masar')
const OUTPUT = join(FRONTEND, '.output', 'public')
const ASSETS = join(APP, 'public', 'frontend')
const PAGE = join(APP, 'www', 'masar.html')
const SOURCES = ['app', 'public', 'nuxt.config.ts', 'package-lock.json', 'tsconfig.json']

function files(path) {
  if (!existsSync(path)) return []
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path).sort().flatMap(name => files(join(path, name)))
}

function sourceHash() {
  const hash = createHash('sha256')
  for (const file of SOURCES.flatMap(source => files(join(FRONTEND, source)))) {
    hash.update(relative(FRONTEND, file).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

if (process.argv.includes('--check')) {
  const installed = existsSync(join(ASSETS, 'build.json')) ? JSON.parse(readFileSync(join(ASSETS, 'build.json'), 'utf8')).sources : null
  if (installed !== sourceHash() || !existsSync(PAGE)) {
    console.error('The Workspace in backend/masar is not built from the current frontend sources. Run: cd frontend && npm run build:app')
    process.exit(1)
  }
  console.log('Workspace build in backend/masar matches the frontend sources.')
  process.exit(0)
}

const index = join(OUTPUT, 'index.html')
if (!existsSync(index)) throw new Error('No build found: run nuxt generate first.')
const html = readFileSync(index, 'utf8')
if (html.includes('{% endraw %}')) throw new Error('The page contains a Jinja raw terminator.')

rmSync(ASSETS, { recursive: true, force: true })
mkdirSync(ASSETS, { recursive: true })
for (const name of readdirSync(OUTPUT)) {
  // Pages (and the folders of route pages) are served by Frappe from www/; the rest are static assets.
  if (name.endsWith('.html') || files(join(OUTPUT, name)).every(file => file.endsWith('.html'))) continue
  cpSync(join(OUTPUT, name), join(ASSETS, name), { recursive: true })
}
writeFileSync(join(ASSETS, 'build.json'), `${JSON.stringify({ sources: sourceHash(), builtAt: new Date().toISOString() }, null, 2)}\n`)
mkdirSync(dirname(PAGE), { recursive: true })
// Frappe renders www pages with Jinja: the whole page is raw text to it.
writeFileSync(PAGE, `{% raw %}${html}{% endraw %}\n`)
console.log(`Installed the Workspace into ${relative(join(FRONTEND, '..'), APP)} (${files(ASSETS).length} asset files).`)
