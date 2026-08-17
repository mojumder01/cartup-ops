// Provider selection + Grok (xAI) support — shared by gemini.js, qcProcessor.js,
// governanceProcessor.js so every AI pass (Production, QC, Governance) can be
// switched to Grok without touching each file's call sites.
const GROK_MODEL = 'grok-4-fast-non-reasoning'
const DELAY_MS = 2000
const MAX_RETRIES = 3

export function getProvider() {
  return localStorage.getItem('ai_provider') || 'gemini'
}
export function saveProvider(p) {
  localStorage.setItem('ai_provider', p === 'grok' ? 'grok' : 'gemini')
}

export function getGrokApiKey() {
  return localStorage.getItem('grok_api_key') || ''
}
export function saveGrokApiKey(key) {
  localStorage.setItem('grok_api_key', key)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

export async function callGrok(prompt, apiKey, retries = MAX_RETRIES) {
  await sleep(DELAY_MS)
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROK_MODEL,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (res.status === 429) {
    if (retries > 0) { await sleep(15000); return callGrok(prompt, apiKey, retries - 1) }
    throw new Error('Rate limit — please wait and retry')
  }
  if (!res.ok) throw new Error(`Grok error: ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

export async function testGrokConnection(apiKey) {
  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: GROK_MODEL, max_tokens: 10, messages: [{ role: 'user', content: 'Say "ok"' }] }),
    })
    if (res.status === 429) return 'rate_limited'
    if (res.ok) return 'ok'
    return 'fail'
  } catch { return 'fail' }
}
