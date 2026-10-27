// Team settings: data and rules the team changes from the Settings page,
// shared through the backend (Supabase, routers/settings.py) — category
// attributes, Daraz → CartUp categories, CartUp categories, rules & defaults.
// A key nobody has saved uses the copy built into the app (catalog.js).
// Values are kept in this browser (IndexedDB) by version, so a sleeping
// server never holds up work: the last copy is used at once and refreshed in
// the background; only keys whose version changed are downloaded again.
import { API_URL } from './api'

export const TEAM_KEYS = ['category_attributes', 'daraz_categories', 'cartup_categories', 'rules']
const DB_NAME = 'cartup-ops', STORE = 'files', CACHE_KEY = 'team-settings'

// values: key → value · meta: key → { version, updated_at, updated_by }
// status: 'cached' | 'loading' | 'ready' | 'offline' | 'setup' (tables not created yet)
let state = { values: {}, meta: {}, status: 'cached', error: '', checkedAt: null }
const listeners = new Set()
const emit = () => listeners.forEach(f => f(state))
export const onTeamSettings = fn => { listeners.add(fn); return () => listeners.delete(fn) }
export const teamState = () => state
export const teamValue = key => state.values[key]
export const teamMeta = key => state.meta[key] || { version: 0 }
const set = patch => { state = { ...state, ...patch }; emit() }

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return resolve(undefined)
    const open = indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => { db.close(); resolve(req?.result) }
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error) }
    }
  })
}
const saveCache = () => idb('readwrite', s => s.put({ values: state.values, meta: state.meta }, CACHE_KEY)).catch(() => {})

// Values straight in (the cache, a download — and tests).
export function applyTeamSettings(values, meta = {}) {
  set({ values: { ...values }, meta: { ...meta } })
}

const token = () => { try { return localStorage.getItem('token') } catch { return null } }
async function call(path, options = {}) {
  let res
  try {
    res = await fetch(`${API_URL}/settings${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...options.headers } })
  } catch {
    throw Object.assign(new Error('The server can\'t be reached (it may be waking up — about a minute)'), { code: 'offline' })
  }
  const body = await res.json().catch(() => ({}))
  if (res.ok) return body
  const detail = body.detail
  const message = typeof detail === 'string' ? detail : detail?.message || `HTTP ${res.status}`
  throw Object.assign(new Error(message), { code: res.status === 503 ? 'setup' : res.status === 409 ? 'conflict' : res.status === 404 ? 'missing' : 'error', status: res.status, detail })
}

let loading = null
// The last copy from this browser, then what changed on the server.
export function loadTeamSettings() {
  return loading ||= (async () => {
    try {
      const cached = await idb('readonly', s => s.get(CACHE_KEY)).catch(() => null)
      if (cached && !Object.keys(state.meta).length) set({ values: cached.values || {}, meta: cached.meta || {} })
    } catch { /* no cache */ }
    await refreshTeamSettings()
  })().finally(() => { loading = null })
}

export async function refreshTeamSettings() {
  if (!token()) return
  set({ status: 'loading', error: '' })
  try {
    const list = await call('')
    const values = { ...state.values }, meta = {}
    for (const m of list) {
      if (!TEAM_KEYS.includes(m.key)) continue
      meta[m.key] = m
      if (state.meta[m.key]?.version !== m.version || !(m.key in values)) values[m.key] = (await call(`/${m.key}`)).value
    }
    for (const k of Object.keys(values)) if (!meta[k]) delete values[k]   // reset to built-in by someone
    set({ values, meta, status: 'ready', checkedAt: Date.now() })
    saveCache()
  } catch (e) {
    // 503: the tables aren't created yet · 404 on the list: the server isn't the new version yet
    const setup = e.code === 'setup' || e.status === 404
    set({ status: setup ? 'setup' : 'offline', error: e.status === 404 ? 'The server doesn\'t have team settings yet — it updates from main (Render)' : e.message })
  }
}

// Saves a new version. base: the version the change started from — someone
// else's save since then is refused (code 'conflict') instead of overwritten.
export async function saveTeamSetting(key, value, note = '') {
  const m = await call(`/${key}`, { method: 'PUT', body: JSON.stringify({ value, base_version: teamMeta(key).version || 0, note }) })
  set({ values: { ...state.values, [key]: value }, meta: { ...state.meta, [key]: m }, status: 'ready' })
  saveCache()
  return m
}
export const teamHistory = key => call(`/${key}/history`)
export async function restoreTeamSetting(key, id) {
  await call(`/${key}/restore/${id}`, { method: 'POST', body: JSON.stringify({ base_version: teamMeta(key).version || 0 }) })
  await refreshTeamSettings()
}
export async function resetTeamSetting(key) {
  await call(`/${key}/reset`, { method: 'POST', body: JSON.stringify({ base_version: teamMeta(key).version || 0 }) })
  const values = { ...state.values }, meta = { ...state.meta }
  delete values[key]; delete meta[key]
  set({ values, meta })
  saveCache()
}
