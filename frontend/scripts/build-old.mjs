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
  edit('index.html', '<div id="root"></div>', `<div id="root"></div>
  <a href="/cartup-ops/" title="You are using the old version (v${old.version}). The latest version is the main site."
    style="position:fixed;left:12px;bottom:70px;width:200px;box-sizing:border-box;z-index:9999;text-align:center;background:#b45309;color:#fff;padding:7px 10px;border-radius:18px;font:600 11.5px system-ui,sans-serif;text-decoration:none;box-shadow:0 4px 12px rgba(0,0,0,.25)">Old version v${old.version} · Go to the latest →</a>`)
  // Same packages as the latest version → reuse its install; otherwise install the old ones.
  const same = readFileSync(join(fe, 'package.json'), 'utf8') === readFileSync('package.json', 'utf8') && existsSync('node_modules')
  if (same) symlinkSync(resolve('node_modules'), join(fe, 'node_modules'), 'dir')
  else run('npm install --no-audit --no-fund', fe)
  run(`npx vite build --base=${base} --outDir "${out}" --emptyOutDir`, fe)
  console.log(`Old version v${old.version} built into ${out} (served at ${base})`)
} finally {
  run(`git worktree remove --force "${dir}"`)
}
