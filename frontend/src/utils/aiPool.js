// Several API keys and models per AI provider, used in turn. A key is used
// until it hits its limit (429 / quota) — then the next one takes over while
// it cools down; an invalid key is skipped. When a model is unavailable or
// overloaded, the next model in the list is tried. Keys, models and cool-downs
// live in this browser only (localStorage) — keys are never stored on our server.
import { getProvider } from './aiProvider'

const API_URL = 'https://cartup-ops.onrender.com'
const KEYS_STORE = 'ai_keys_v1', MODELS_STORE = 'ai_models_v1', STATUS_STORE = 'ai_key_status_v1'
const DELAY_MS = 2000

export const PROVIDERS = ['gemini', 'grok', 'groq']
export const PROVIDER_LABEL = { gemini: 'Gemini', grok: 'Grok (xAI)', groq: 'Groq' }
export const DEFAULT_MODELS = {
  gemini: ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'],
  grok: ['grok-4-fast-non-reasoning'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
}

// Which provider a key belongs to, from its prefix.
export function providerOfKey(key) {
  if (/^AIza/.test(key)) return 'gemini'
  if (/^gsk_/.test(key)) return 'groq'
  if (/^xai-/.test(key)) return 'grok'
  return null
}

const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage unavailable */ } }

// ── Keys ──────────────────────────────────────────────────────────────────────
export function loadKeys() {
  const keys = read(KEYS_STORE, null)
  if (keys) return Object.fromEntries(PROVIDERS.map(p => [p, keys[p] || []]))
  // First run: take over the single keys saved by earlier versions.
  const legacy = { gemini: 'gemini_api_key', grok: 'grok_api_key', groq: 'groq_api_key' }
  const out = Object.fromEntries(PROVIDERS.map(p => {
    let k = ''
    try { k = localStorage.getItem(legacy[p]) || '' } catch { /* storage unavailable */ }
    return [p, k ? [k] : []]
  }))
  write(KEYS_STORE, out)
  return out
}
export function saveKeys(keys) {
  const clean = Object.fromEntries(PROVIDERS.map(p => [p, [...new Set((keys[p] || []).map(k => k.trim()).filter(Boolean))]]))
  write(KEYS_STORE, clean)
  return clean
}
// The key pages pass around as "AI is on" — the first key of the chosen provider.
export const firstKey = (provider = getProvider()) => loadKeys()[provider][0] || ''

// .txt import: one key per line; "#" lines are comments. A key's provider comes
// from its prefix, or "provider: key" / "provider,key"; otherwise `fallback`.
export function parseKeyFile(text, fallback) {
  const found = Object.fromEntries(PROVIDERS.map(p => [p, []]))
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(gemini|grok|groq)\s*[:,=\t]\s*(\S+)/i.exec(line)
    const key = (m ? m[2] : line.split(/[\s,;]+/)[0]).trim()
    const p = m ? m[1].toLowerCase() : (providerOfKey(key) || fallback)
    if (key && p) found[p].push(key)
  }
  return found
}
export function keyFileText(keys) {
  return PROVIDERS.flatMap(p => (keys[p] || []).map(k => providerOfKey(k) === p ? k : `${p}: ${k}`)).join('\n') + '\n'
}
export const maskKey = k => k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-4)}` : '••••'

// ── Models ────────────────────────────────────────────────────────────────────
export function loadModels() {
  const m = read(MODELS_STORE, {})
  return Object.fromEntries(PROVIDERS.map(p => [p, m[p]?.length ? m[p] : DEFAULT_MODELS[p]]))
}
export function saveModels(models) {
  const clean = Object.fromEntries(PROVIDERS.map(p => [p, [...new Set((models[p] || []).map(s => s.trim()).filter(Boolean))]]))
  write(MODELS_STORE, clean)
  return loadModels()
}

// ── Key status (cool-downs) ───────────────────────────────────────────────────
// { [key]: { until, reason } } — reason: 'limit' | 'quota' | 'invalid'
export function keyStatus() {
  const s = read(STATUS_STORE, {})
  const now = Date.now()
  for (const k of Object.keys(s)) if (s[k].until <= now) delete s[k]
  return s
}
function coolDown(key, ms, reason) {
  const s = keyStatus()
  s[key] = { until: Date.now() + ms, reason }
  write(STATUS_STORE, s)
}
export function clearKeyStatus(key) {
  const s = keyStatus()
  delete s[key]
  write(STATUS_STORE, s)
}

// ── Calling ───────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))
const cursor = {}            // provider → index of the key in use
const deadModels = new Set() // "provider|model" found unavailable this session

// One request with one key and model → { ok, text } or { kind, message, retryMs }
// kind: 'limit' (rate limit / quota) · 'invalid' (key) · 'model' (no such model) · 'busy' (overloaded) · 'error'
async function requestOnce(provider, model, key, prompt, { maxOutputTokens, temperature }) {
  if (provider === 'gemini') {
    let res
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens } }),
      })
    } catch (e) { return { kind: 'busy', message: `Network error: ${e.message}` } }
    if (res.ok) {
      const data = await res.json()
      return { ok: true, text: data.candidates?.[0]?.content?.parts?.[0]?.text || '' }
    }
    const body = await res.json().catch(() => ({}))
    const message = body.error?.message || `Gemini error ${res.status}`
    if (res.status === 429) {
      const delay = body.error?.details?.find(d => d.retryDelay)?.retryDelay
      const perDay = /per[ _-]?day|daily/i.test(JSON.stringify(body))
      return { kind: 'limit', message, quota: perDay, retryMs: perDay ? 3600_000 : (parseFloat(delay) * 1000 || 60_000) }
    }
    if (res.status === 400 && /api key/i.test(message)) return { kind: 'invalid', message }
    if (res.status === 401 || res.status === 403) return { kind: 'invalid', message }
    if (res.status === 404) return { kind: 'model', message }
    if (res.status >= 500) return { kind: 'busy', message }
    return { kind: 'error', message }
  }

  // Grok / Groq: their APIs send no CORS headers, so calls go through our backend.
  const token = (() => { try { return localStorage.getItem('token') || '' } catch { return '' } })()
  if (!token) return { kind: 'error', message: 'Not logged in — please sign in again' }
  let res
  try {
    res = await fetch(`${API_URL}/ai/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ provider, api_key: key, prompt, model }),
    })
  } catch (e) { return { kind: 'busy', message: `Network error: ${e.message}` } }
  if (res.ok) return { ok: true, text: (await res.json()).text || '' }
  const err = await res.json().catch(() => ({}))
  const detail = err.detail
  const upstream = typeof detail === 'object' ? detail?.upstream_status : Number(/error: (\d{3})/.exec(String(detail))?.[1])
  const message = typeof detail === 'object' ? detail?.message : String(detail || `${provider} error ${res.status}`)
  if (res.status === 429 || upstream === 429) return { kind: 'limit', message, retryMs: 60_000 }
  if (res.status === 401 && /invalid token/i.test(message)) return { kind: 'error', message: 'Not logged in — please sign in again' }
  if (upstream === 401 || upstream === 403) return { kind: 'invalid', message }
  if (upstream === 404 || (upstream === 400 && /model/i.test(message))) return { kind: 'model', message }
  if (upstream >= 500 || res.status >= 500) return { kind: 'busy', message }
  return { kind: 'error', message }
}

// The one AI call every feature uses (Production, QC, Governance).
export async function callAI(prompt, { maxOutputTokens = 4096, temperature = 0.1 } = {}) {
  const provider = getProvider()
  const keys = loadKeys()[provider]
  const label = PROVIDER_LABEL[provider]
  if (!keys.length) throw new Error(`No ${label} API key — add one in Profile`)
  const models = loadModels()[provider]
  const problems = new Map()
  for (let round = 0; round < 3; round++) {
    for (const model of models) {
      if (deadModels.has(`${provider}|${model}`)) continue
      let nextModel = false
      for (let n = 0; n < keys.length && !nextModel; n++) {
        const i = ((cursor[provider] || 0) + n) % keys.length
        const key = keys[i]
        if (keyStatus()[key]) continue
        await sleep(DELAY_MS)
        const r = await requestOnce(provider, model, key, prompt, { maxOutputTokens, temperature })
        if (r.ok) { cursor[provider] = i; return r.text }
        problems.set(`${maskKey(key)} · ${model}`, r.message)
        if (r.kind === 'limit') coolDown(key, r.retryMs, r.quota ? 'quota' : 'limit')
        else if (r.kind === 'invalid') coolDown(key, 24 * 3600_000, 'invalid')
        else if (r.kind === 'model') { deadModels.add(`${provider}|${model}`); nextModel = true }
        else if (r.kind === 'busy') nextModel = true
        else throw new Error(r.message)
      }
    }
    // Every key is cooling down (or every model busy): wait for the soonest key, briefly.
    const until = Object.entries(keyStatus()).filter(([k, s]) => keys.includes(k) && s.reason !== 'invalid').map(([, s]) => s.until)
    const wait = until.length ? Math.min(...until) - Date.now() : 15_000
    if (wait > 90_000 || models.every(m => deadModels.has(`${provider}|${m}`))) break
    await sleep(Math.max(wait, 5_000))
  }
  const detail = [...problems].slice(-3).map(([k, m]) => `${k}: ${m}`).join(' | ')
  throw new Error(`All ${label} keys/models are at their limit or unavailable — add more keys or models in Profile, or wait. ${detail}`)
}

// Test one key with the first model that answers → 'ok' | 'rate_limited' | 'invalid' | 'fail'
export async function testKey(provider, key) {
  for (const model of loadModels()[provider]) {
    const r = await requestOnce(provider, model, key, 'Say "ok"', { maxOutputTokens: 10, temperature: 0 })
    if (r.ok) { clearKeyStatus(key); return 'ok' }
    if (r.kind === 'limit') return 'rate_limited'
    if (r.kind === 'invalid') return 'invalid'
    if (r.kind !== 'model' && r.kind !== 'busy') return 'fail'
  }
  return 'fail'
}
