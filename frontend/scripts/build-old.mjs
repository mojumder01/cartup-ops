// Builds the old version kept online (old-version.json) into dist/old/, served
// at /cartup-ops/old/ next to the latest version: its own source at that
// commit, with the router's base moved to /cartup-ops/old and a small
// "Old version · go to the latest" button added. Runs at every deploy, after
// the main build (.github/workflows/frontend.yml):  node scripts/build-old.mjs
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, symlinkSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const old = JSON.parse(readFileSync('old-version.json', 'utf8'))
const base = old.path.replace(/\/?$/, '/')
const root = execSync('git rev-parse --show-toplevel').toString().trim()
const dir = join(tmpdir(), `cartup-ops-old-${old.version}`)
const out = resolve('dist', base.split('/').filter(Boolean).pop())
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' })

// The commit (a shallow checkout on the build server may not have it yet).
try { execSync(`git cat-file -e ${old.commit}^{commit}`, { cwd: root, stdio: 'ignore' }) }
catch { run(`git fetch --depth=1 origin ${old.commit}`) }
if (existsSync(dir)) { try { run(`git worktree remove --force "${dir}"`) } catch { rmSync(dir, { recursive: true, force: true }); run('git worktree prune') } }
run(`git worktree add --detach "${dir}" ${old.commit}`)

try {
  const fe = join(dir, 'frontend')
  const edit = (file, from, to) => {
    const p = join(fe, file), text = readFileSync(p, 'utf8')
    if (!text.includes(from)) throw new Error(`${file}: "${from}" not found — can't move the old version to ${base}`)
    writeFileSync(p, text.replace(from, to))
  }
  edit('src/main.jsx', 'basename="/cartup-ops"', `basename="${base.replace(/\/$/, '')}"`)
  // The two version buttons, as the latest has them (VersionSwitch.jsx) — here OLD is running.
  const latest = /APP_VERSION = '([^']+)'/.exec(readFileSync('src/version.js', 'utf8'))[1]
  const btn = 'display:flex;align-items:center;justify-content:space-between;gap:6px;box-sizing:border-box;width:100%;padding:6px 10px;border-radius:8px;font:700 11px/1.3 system-ui,sans-serif;text-decoration:none'
  edit('index.html', '<div id="root"></div>', `<div id="root"></div>
  <div data-version-switch style="position:fixed;left:12px;bottom:66px;width:200px;z-index:9999;display:flex;flex-direction:column;gap:6px;padding:6px;border-radius:10px;background:rgba(30,27,75,.92);box-shadow:0 4px 14px rgba(0,0,0,.25)">
    <span data-version="old" aria-current="true" title="You are using the old version" style="${btn};color:#fff;background:#16a34a;border:1px solid #16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.25)"><span>OLD: v${old.version}</span><span style="display:inline-flex;align-items:center;gap:5px;font-weight:600"><span class="vs-dot"></span>Running</span></span>
    <a href="/cartup-ops/" data-version="latest" title="Go to the latest version" style="${btn};color:rgba(255,255,255,.85);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.25)"><span>Latest: v${latest}</span><span style="font-weight:500;opacity:.75">Open →</span></a>
  </div>
  <style>.vs-dot{width:7px;height:7px;border-radius:50%;background:#fff;animation:vs-pulse 1.4s ease-in-out infinite}@keyframes vs-pulse{0%,100%{opacity:1}50%{opacity:.35}}</style>`)
  // Same packages as the latest version → reuse its install; otherwise install the old ones.
  const same = readFileSync(join(fe, 'package.json'), 'utf8') === readFileSync('package.json', 'utf8') && existsSync('node_modules')
  if (same) symlinkSync(resolve('node_modules'), join(fe, 'node_modules'), 'dir')
  else run('npm install --no-audit --no-fund', fe)
  run(`npx vite build --base=${base} --outDir "${out}" --emptyOutDir`, fe)
  console.log(`Old version v${old.version} built into ${out} (served at ${base})`)
} finally {
  run(`git worktree remove --force "${dir}"`)
}
