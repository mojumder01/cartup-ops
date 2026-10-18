// Gemini API keys and models, used in turn. Every key is its own Google
// project with its own per-minute and per-day limit for each model, so each
// request goes to the next ticked key that still has room on the first model
// that has room — a run spreads over all keys and never knocks on a key that
// is known to be full. A key that still gets a 429 cools down, an invalid key
// is skipped, and a model that doesn't exist or is overloaded gives way to the
// next one. Keys, usage and settings live in this browser only — never on our
// server.

const KEYS_STORE = 'gemini_keys_v2', SETTINGS_STORE = 'gemini_settings_v2'
const USAGE_STORE = 'gemini_usage_v2', STATUS_STORE = 'gemini_status_v2'
const API = 'https://generativelanguage.googleapis.com/v1beta'

// Free-tier limits per key, per model (Google AI Studio). They can be changed
// per model in Profile if Google changes them or a key is on a paid plan.
export const MODEL_CATALOG = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', rpm: 15, rpd: 500 },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', rpm: 15, rpd: 500 },
  { id: 'gemini-3.8-flash',      label: 'Gemini 3.8 Flash',      rpm: 5,  rpd: 20 },
  { id: 'gemini-3.7-flash',      label: 'Gemini 3.7 Flash',      rpm: 5,  rpd: 20 },
  { id: 'gemini-3.6-flash',      label: 'Gemini 3.6 Flash',      rpm: 5,  rpd: 20 },
  { id: 'gemini-3.5-flash',      label: 'Gemini 3.5 Flash',      rpm: 5,  rpd: 20 },
  { id: 'gemini-3-flash',        label: 'Gemini 3 Flash',        rpm: 5,  rpd: 20 },
  { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',      rpm: 5,  rpd: 20 },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', rpm: 10, rpd: 20 },
]
export const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']
// parallel: requests sent at the same time · rpmGuard: keep each key under its per-minute limit
const DEFAULT_SETTINGS = { models: DEFAULT_MODELS, limits: {}, aliases: {}, delaySec: 1, remember: true, parallel: 3, rpmGuard: true }

const storage = kind => { try { return kind === 'session' ? window.sessionStorage : window.localStorage } catch { return null } }
const read = (k, fallback, kind = 'local') => { try { return JSON.parse(storage(kind).getItem(k)) ?? fallback } catch { return fallback } }
const write = (k, v, kind = 'local') => { try { storage(kind).setItem(k, JSON.stringify(v)) } catch { /* storage unavailable */ } }
const drop = (k, kind = 'local') => { try { storage(kind).removeItem(k) } catch { /* storage unavailable */ } }

// Pages showing keys or usage listen for changes with onAiChange.
const emit = () => { try { window.dispatchEvent(new Event('cartup-ai')) } catch { /* no window */ } }
export function onAiChange(fn) {
  window.addEventListener('cartup-ai', fn)
  return () => window.removeEventListener('cartup-ai', fn)
}

// Usage and cool-downs are stored under a short fingerprint of the key, so the
// key itself is only ever saved in one place (and not at all when the browser
// shouldn't remember it).
export function fp(key) {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

// ── Settings & models ─────────────────────────────────────────────────────────
export function loadSettings() {
  const s = read(SETTINGS_STORE, null)
  if (s) return { ...DEFAULT_SETTINGS, ...s, models: s.models?.length ? s.models : DEFAULT_MODELS }
  // First run: keep a model list someone set in the earlier version.
  const OLD_DEFAULT = 'gemini-3.1-flash-lite|gemini-2.5-flash-lite|gemini-2.5-flash'
  const old = read('ai_models_v1', {})?.gemini
  return { ...DEFAULT_SETTINGS, models: old?.length && old.join('|') !== OLD_DEFAULT ? old : DEFAULT_MODELS }
}
export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch }
  next.models = [...new Set(next.models.map(m => m.trim()).filter(Boolean))]
  if (!next.models.length) next.models = DEFAULT_MODELS
  write(SETTINGS_STORE, next)
  emit()
  return next
}
// A model's name and limits (catalog numbers unless changed in Profile).
export function modelInfo(id, settings = loadSettings()) {
  const base = MODEL_CATALOG.find(m => m.id === id) || { id, label: id, rpm: 5, rpd: 20, custom: true }
  return { ...base, ...settings.limits[id] }
}
export function knownModels(settings = loadSettings()) {
  const custom = [...settings.models, ...Object.keys(settings.limits)].filter(id => !MODEL_CATALOG.some(m => m.id === id))
  return [...MODEL_CATALOG.map(m => m.id), ...new Set(custom)].map(id => modelInfo(id, settings))
}

// ── Keys ──────────────────────────────────────────────────────────────────────
// [{ key, on }] — "on" = ticked, used here. Kept in localStorage, or only for
// this browser session when "Remember keys in this browser" is off.
export function loadKeys() {
  const { remember } = loadSettings()
  const saved = read(KEYS_STORE, null, remember ? 'local' : 'session')
  if (saved) return saved
  if (!remember) return []
  // First run: take over the Gemini keys saved by earlier versions.
  let list = read('ai_keys_v1', null)?.gemini || []
  if (!list.length) { try { list = [localStorage.getItem('gemini_api_key')].filter(Boolean) } catch { /* storage unavailable */ } }
  const keys = [...new Set(list)].map(key => ({ key, on: true }))
  write(KEYS_STORE, keys)
  return keys
}
export function saveKeys(keys) {
  const seen = new Set(), clean = []
  for (const k of keys) {
    const key = String(k.key || '').trim()
    if (key && !seen.has(key)) { seen.add(key); clean.push({ key, on: k.on !== false }) }
  }
  write(KEYS_STORE, clean, loadSettings().remember ? 'local' : 'session')
  emit()
  return clean
}
export function setRemember(remember) {
  const keys = loadKeys()
  saveSettings({ remember })
  drop(KEYS_STORE, remember ? 'session' : 'local')
  return saveKeys(keys)
}
export const usableKeys = () => loadKeys().filter(k => k.on).map(k => k.key)
// What pages check (and pass along) for "AI is on". Calls use the whole pool.
export const firstKey = () => usableKeys()[0] || ''

// Import: a .txt / .csv with one key per line ("#" lines are comments; a line
// may carry a label — "Key 1: AIza…" — the key is the longest word on it), or
// a .json holding the keys anywhere (a list, or { keys: [...] }…). Keys of any
// format are taken (AIza…, AQ.…, gen-…), except Grok/Groq ones.
export function parseKeyFile(text) {
  const keys = []
  let skipped = 0
  let lines = String(text).split(/\r?\n/)
  if (/^\s*[[{]/.test(text)) {
    try {
      const found = []
      const walk = v => typeof v === 'string' ? found.push(...v.split(/[\n,]+/)) : v && typeof v === 'object' && Object.values(v).forEach(walk)
      walk(JSON.parse(text))
      lines = found.filter(v => !/\s/.test(v.trim()) && v.trim().length >= 20)
    } catch { /* not JSON after all: read it line by line */ }
  }
  for (const raw of lines) {
    const line = raw.trim().replace(/^gemini\s*[:=,\t]\s*/i, '')
    if (!line || line.startsWith('#')) continue
    const key = line.split(/[\s,;|]+/).sort((a, b) => b.length - a.length)[0].replace(/^["']|["']$/g, '')
    if (key.length < 10 || /^(grok|groq|xai)\s*[:=]/i.test(line) || /^(gsk_|xai-)/.test(key)) { skipped++; continue }
    keys.push(key)
  }
  return { keys: [...new Set(keys)], skipped }
}
export const keyFileText = keys => '# CartUp Ops — Gemini API keys, one per line\n' + keys.map(k => k.key).join('\n') + '\n'
export const maskKey = k => k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '••••'

// ── Today's usage & cool-downs ────────────────────────────────────────────────
// Free-tier daily limits reset at midnight Pacific time.
const PT = 'America/Los_Angeles'
export const quotaDay = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: PT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
export function nextReset(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: PT, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(now).map(x => [x.type, Number(x.value)]))
  const passed = ((p.hour % 24) * 3600 + p.minute * 60 + p.second) * 1000 + now.getMilliseconds()
  return new Date(now.getTime() - passed + 86400_000)
}

// When the daily limits reset, as text: "1:00 PM · in 3h 12m".
export function resetText(now = new Date()) {
  const at = nextReset(now), mins = Math.max(1, Math.round((at - now) / 60000))
  return `${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · in ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}`
}

// { day, used: { [fp]: { [model]: n } }, tokens } — requests and tokens today
function usage() {
  const u = read(USAGE_STORE, null), day = quotaDay()
  return u?.day === day ? { tokens: 0, ...u } : { day, used: {}, tokens: 0 }
}
function countUse(id, model, d, tokens = 0) {
  const u = usage()
  const k = (u.used[id] ||= {})
  k[model] = Math.max(0, (k[model] || 0) + d)
  u.tokens += tokens
  write(USAGE_STORE, u)
  emit()
}
// Today's count for one key and model, set by hand — the number AI Studio
// shows (the same key may be used elsewhere, e.g. another app).
export function setUsed(key, model, n) {
  const u = usage(), id = fp(key)
  ;(u.used[id] ||= {})[model] = Math.max(0, Math.round(Number(n) || 0))
  write(USAGE_STORE, u)
  emit()
}
export const usedToday = (key, model) => usage().used[fp(key)]?.[model] || 0

// This page's AI calls since it was opened: requests, answers, failures,
// tokens, and the key + model in use — for the live line while a run goes.
const session = { calls: 0, ok: 0, failed: 0, tokens: 0, key: '', model: '', at: 0 }
export const sessionStats = () => ({ ...session })
// { ["fp|model" or "fp|*"]: { until, reason } } — reason: 'minute' | 'day' | 'invalid'
export function keyStatus() {
  const s = read(STATUS_STORE, {}), now = Date.now()
  for (const k of Object.keys(s)) if (s[k].until <= now) delete s[k]
  return s
}
function setStatus(slot, until, reason) {
  const s = keyStatus()
  s[slot] = { until, reason }
  write(STATUS_STORE, s)
  emit()
}
export function clearKeyStatus(key) {
  const id = fp(key), s = keyStatus()
  for (const k of Object.keys(s)) if (k.startsWith(`${id}|`)) delete s[k]
  write(STATUS_STORE, s)
  emit()
}

// Session-only state: recent request times (per-minute limit), models that
// don't exist for these keys, and models that are overloaded right now.
const recent = new Map(), deadModels = new Set(), busyUntil = new Map()
let cursor = 0, nextStart = 0
export const unavailableModels = () => new Set(deadModels)

// Each key's state today, for Profile and the pages that run AI.
export function poolSummary() {
  const settings = loadSettings(), u = usage(), st = keyStatus(), now = Date.now()
  const models = settings.models.filter(m => !deadModels.has(m)).map(m => modelInfo(m, settings))
  const keys = loadKeys().map((k, i) => {
    const id = fp(k.key)
    const invalid = st[`${id}|*`]?.reason === 'invalid'
    let used = 0, cap = 0, left = 0, waiting = null, full = 0
    for (const m of models) {
      const n = u.used[id]?.[m.id] || 0, s = st[`${id}|${m.id}`]
      used += n; cap += m.rpd
      if (invalid || s?.reason === 'day' || n >= m.rpd) { full++; continue }
      left += m.rpd - n
      if (s) waiting = Math.min(waiting ?? Infinity, s.until)
    }
    const state = invalid ? 'invalid' : full === models.length && models.length ? 'day' : waiting && waiting > now ? 'minute' : 'ready'
    return { ...k, n: i + 1, id, used, cap, left, state, full, until: state === 'minute' ? waiting : null }
  })
  const on = keys.filter(k => k.on)
  const main = models[0]
  return {
    keys, models, ticked: on.length,
    used: on.reduce((s, k) => s + k.used, 0),
    cap: on.reduce((s, k) => s + k.cap, 0),
    left: on.reduce((s, k) => s + k.left, 0),
    perMinute: main ? on.filter(k => k.state !== 'invalid' && k.state !== 'day').length * main.rpm : 0,
    reset: nextReset(), tokens: u.tokens,
  }
}

// ── Calling ───────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))

// One request with one key and model → { ok, text } or { kind, message, retryMs, perDay }
// kind: 'limit' (rate limit / quota) · 'invalid' (key) · 'model' (no such model) · 'busy' (overloaded) · 'error'
async function requestOnce(model, key, prompt, { maxOutputTokens, temperature }) {
  let res
  try {
    res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens } }),
    })
  } catch (e) { return { kind: 'busy', message: `Network error: ${e.message}` } }
  if (res.ok) {
    const data = await res.json()
    return { ok: true, text: (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''), tokens: data.usageMetadata?.totalTokenCount || 0 }
  }
  const body = await res.json().catch(() => ({}))
  const message = body.error?.message || `Gemini error ${res.status}`
  if (res.status === 429) {
    const delay = body.error?.details?.find(d => d.retryDelay)?.retryDelay
    const perDay = /per[ _-]?day|daily/i.test(JSON.stringify(body))
    return { kind: 'limit', message, perDay, retryMs: parseFloat(delay) * 1000 || 60_000 }
  }
  if (res.status === 400 && /api[ _]?key/i.test(message)) return { kind: 'invalid', message }
  if (res.status === 401 || res.status === 403) return { kind: 'invalid', message }
  if (res.status === 404) return { kind: 'model', message }
  if (res.status >= 500) return { kind: 'busy', message }
  return { kind: 'error', message }
}

// The models a key can call (generateContent), e.g. to check the list in Profile.
const listed = new Map()
export function listModels(key) {
  if (!listed.has(key)) {
    listed.set(key, fetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Gemini error ${r.status}`)))
      .then(d => (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, '')))
      .catch(e => { listed.delete(key); throw e }))
  }
  return listed.get(key)
}
// A catalog name Google publishes under a longer one (gemini-3-flash →
// gemini-3-flash-preview, -001…) — but never another model (-lite).
const versionOf = (name, model) => name === model || (name.startsWith(`${model}-`) && /^(preview|exp|latest|\d)/.test(name.slice(model.length + 1)))
const findVersion = (names, model) => names.includes(model) ? model : names.filter(n => versionOf(n, model)).sort((a, b) => a.length - b.length)[0] || null
// Which models a key's list has (model → true/false); names published under
// a longer name are remembered, so requests go straight to them.
export function applyModelList(names, ids) {
  const { aliases } = loadSettings()
  const next = { ...aliases }, found = {}
  for (const id of ids) {
    const v = findVersion(names, id)
    found[id] = !!v
    if (v && v !== id) next[id] = v
  }
  saveSettings({ aliases: next })
  return found
}
async function resolveModel(model, key) {
  try {
    const alt = findVersion(await listModels(key), model)
    if (!alt || alt === model) return null
    const { aliases } = loadSettings()
    saveSettings({ aliases: { ...aliases, [model]: alt } })
    return alt
  } catch { return null }
}
const apiName = (model, settings) => settings.aliases[model] || model

// The next ticked key + model with room, or how long until one has room.
function pickSlot(keys, settings) {
  const now = Date.now(), st = keyStatus(), u = usage()
  let wait = Infinity
  for (const model of settings.models) {
    if (deadModels.has(model)) continue
    const busy = busyUntil.get(model) || 0
    if (busy > now) { wait = Math.min(wait, busy - now); continue }
    const { rpm, rpd } = modelInfo(model, settings)
    for (let n = 0; n < keys.length; n++) {
      const i = (cursor + n) % keys.length, id = fp(keys[i]), slot = `${id}|${model}`
      if (st[`${id}|*`]) continue
      const s = st[slot]
      if (s) { if (s.reason !== 'day') wait = Math.min(wait, s.until - now); continue }
      if ((u.used[id]?.[model] || 0) >= rpd) continue
      const times = (recent.get(slot) || []).filter(t => t > now - 60_000)
      recent.set(slot, times)
      if (settings.rpmGuard && times.length >= rpm) { wait = Math.min(wait, times[0] + 60_000 - now); continue }
      cursor = i + 1
      times.push(now)
      return { key: keys[i], id, model }
    }
  }
  return { wait }
}

// The one AI call every feature uses (Production, Daraz Upload, QC, Governance).
export async function callAI(prompt, { maxOutputTokens = 4096, temperature = 0.1 } = {}) {
  const keys = usableKeys()
  if (!keys.length) throw new Error('No Gemini API key ticked — add or tick one in Profile')
  const problems = []
  const deadline = Date.now() + 5 * 60_000
  for (;;) {
    const settings = loadSettings()
    const slot = pickSlot(keys, settings)
    if (!slot.key) {
      if (slot.wait === Infinity) break
      if (Date.now() + slot.wait > deadline) break
      await sleep(Math.max(slot.wait, 300) + 50)
      continue
    }
    const { key, id, model } = slot
    // Pause between requests (Profile setting), shared by parallel calls.
    const start = Math.max(Date.now(), nextStart)
    nextStart = start + settings.delaySec * 1000
    if (start > Date.now()) await sleep(start - Date.now())

    countUse(id, model, 1)
    Object.assign(session, { calls: session.calls + 1, key, model, at: Date.now() })
    let r = await requestOnce(apiName(model, settings), key, prompt, { maxOutputTokens, temperature })
    if (r.kind === 'model' && !settings.aliases[model]) {
      const alt = await resolveModel(model, key)
      if (alt) r = await requestOnce(alt, key, prompt, { maxOutputTokens, temperature })
    }
    if (r.ok) {
      session.ok++; session.tokens += r.tokens
      countUse(id, model, 0, r.tokens)
      return r.text
    }
    session.failed++
    problems.push(`${maskKey(key)} · ${model}: ${r.message}`)
    if (r.kind === 'limit') {
      countUse(id, model, -1)
      if (r.perDay) setStatus(`${id}|${model}`, nextReset().getTime(), 'day')
      else setStatus(`${id}|${model}`, Date.now() + r.retryMs, 'minute')
    } else if (r.kind === 'invalid') {
      countUse(id, model, -1)
      setStatus(`${id}|*`, Date.now() + 24 * 3600_000, 'invalid')
    } else if (r.kind === 'model') {
      countUse(id, model, -1)
      deadModels.add(model)
      emit()
    } else if (r.kind === 'busy') {
      busyUntil.set(model, Date.now() + 15_000)
    } else throw new Error(r.message)
  }
  const { left } = poolSummary()
  if (!left) throw new Error(`Today's Gemini limit is used on every ticked key and model — add or tick more keys or models in Profile, or wait for the daily reset (${resetText()})`)
  throw new Error(`Gemini keys/models are at their limit or unavailable right now. ${problems.slice(-3).join(' | ')}`)
}

// Test one key with the first model that answers → { result: 'ok' | 'rate_limited' | 'invalid' | 'fail', model, message }
export async function testKey(key) {
  const settings = loadSettings()
  let last = ''
  for (const model of settings.models) {
    if (deadModels.has(model)) continue
    let name = apiName(model, settings)
    let r = await requestOnce(name, key, 'Say "ok"', { maxOutputTokens: 10, temperature: 0 })
    if (r.kind === 'model' && !settings.aliases[model]) {
      const alt = await resolveModel(model, key)
      if (alt) { name = alt; r = await requestOnce(alt, key, 'Say "ok"', { maxOutputTokens: 10, temperature: 0 }) }
    }
    if (r.ok) { countUse(fp(key), model, 1); clearKeyStatus(key); return { result: 'ok', model: name } }
    last = r.message
    if (r.kind === 'limit') {
      if (r.perDay) setStatus(`${fp(key)}|${model}`, nextReset().getTime(), 'day')
      else setStatus(`${fp(key)}|${model}`, Date.now() + r.retryMs, 'minute')
      return { result: 'rate_limited', model: name, message: r.message }
    }
    if (r.kind === 'invalid') { setStatus(`${fp(key)}|*`, Date.now() + 24 * 3600_000, 'invalid'); return { result: 'invalid', message: r.message } }
    if (r.kind !== 'model' && r.kind !== 'busy') return { result: 'fail', message: r.message }
  }
  return { result: 'fail', message: last }
}
