// Provider selection + Grok (xAI) / Groq (groqcloud) support — shared by
// gemini.js, qcProcessor.js, governanceProcessor.js so every AI pass
// (Production, QC, Governance) can be switched to Grok/Groq without touching
// each file's call sites.
//
// IMPORTANT: unlike Gemini, neither xAI's nor Groq's API sends CORS headers,
// so a direct browser fetch() to them is always blocked. Calls are relayed
// through the CartUp backend (which already exists for auth/production) —
// the key is sent per-request only, never stored server-side.
const API_URL = 'https://cartup-content.onrender.com'
const DELAY_MS = 2000
const MAX_RETRIES = 3

const VALID_PROVIDERS = ['gemini', 'grok', 'groq']

export function getProvider() {
  const p = localStorage.getItem('ai_provider')
  return VALID_PROVIDERS.includes(p) ? p : 'gemini'
}
export function saveProvider(p) {
  localStorage.setItem('ai_provider', VALID_PROVIDERS.includes(p) ? p : 'gemini')
}

export function getGrokApiKey() {
  return localStorage.getItem('grok_api_key') || ''
}
export function saveGrokApiKey(key) {
  localStorage.setItem('grok_api_key', key)
}

// Groq (groqcloud.com — fast LPU inference) — NOT the same as Grok/xAI.
// Groq keys start with "gsk_"; Grok/xAI keys start with "xai-".
export function getGroqApiKey() {
  return localStorage.getItem('groq_api_key') || ''
}
export function saveGroqApiKey(key) {
  localStorage.setItem('groq_api_key', key)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function authToken() { return localStorage.getItem('token') || '' }

async function callViaProxy(provider, prompt, apiKey, retries = MAX_RETRIES) {
  await sleep(DELAY_MS)
  const token = authToken()
  if (!token) throw new Error('Not logged in — please sign in again')

  const res = await fetch(`${API_URL}/ai/proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ provider, api_key: apiKey, prompt }),
  })
  if (res.status === 429) {
    if (retries > 0) { await sleep(15000); return callViaProxy(provider, prompt, apiKey, retries - 1) }
    throw new Error('Rate limit — please wait and retry')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `${provider} error: ${res.status}`)
  }
  const data = await res.json()
  return data.text || ''
}

async function testViaProxy(provider, apiKey) {
  const token = authToken()
  if (!token) return 'fail'
  try {
    const res = await fetch(`${API_URL}/ai/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ provider, api_key: apiKey, prompt: 'Say "ok"' }),
    })
    if (res.status === 429) return 'rate_limited'
    if (res.ok) return 'ok'
    return 'fail'
  } catch { return 'fail' }
}

export function callGrok(prompt, apiKey, retries = MAX_RETRIES) {
  return callViaProxy('grok', prompt, apiKey, retries)
}
export function testGrokConnection(apiKey) {
  return testViaProxy('grok', apiKey)
}
export function callGroq(prompt, apiKey, retries = MAX_RETRIES) {
  return callViaProxy('groq', prompt, apiKey, retries)
}
export function testGroqConnection(apiKey) {
  return testViaProxy('groq', apiKey)
}
