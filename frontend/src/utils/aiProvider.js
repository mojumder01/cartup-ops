// Which AI provider powers Production, QC and Governance. Keys and models
// for each provider live in the key pool (aiPool.js), which also makes the
// calls — Grok (xAI) and Groq send no CORS headers, so those go through our
// backend's /ai/proxy, with the key passed per request and never stored there.
const VALID_PROVIDERS = ['gemini', 'grok', 'groq']

export function getProvider() {
  let p = null
  try { p = localStorage.getItem('ai_provider') } catch { /* storage unavailable */ }
  return VALID_PROVIDERS.includes(p) ? p : 'gemini'
}
export function saveProvider(p) {
  try { localStorage.setItem('ai_provider', VALID_PROVIDERS.includes(p) ? p : 'gemini') } catch { /* storage unavailable */ }
}
