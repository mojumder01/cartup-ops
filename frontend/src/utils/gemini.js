const GEMINI_MODEL = 'gemini-2.0-flash-lite'
const DELAY_MS = 4500  // ~13 requests/min, safe under free tier (15 RPM)
const MAX_RETRIES = 3

export function getApiKey() {
  return localStorage.getItem('gemini_api_key') || ''
}

export function saveApiKey(key) {
  localStorage.setItem('gemini_api_key', key)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function callGemini(prompt, apiKey, retries = MAX_RETRIES) {
  await sleep(DELAY_MS)

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
      })
    }
  )

  if (res.status === 429) {
    if (retries > 0) {
      await sleep(15000) // wait 15s on rate limit before retry
      return callGemini(prompt, apiKey, retries - 1)
    }
    throw new Error('Gemini rate limit — please wait a minute and try again')
  }

  if (!res.ok) throw new Error(`Gemini error: ${res.status}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

// Combined single-call processor: fixes name + highlights + description together
// This cuts 3-4 API calls per product down to 1
export async function processProductAI(name, highlights, description, apiKey) {
  if (!apiKey) return { name, highlights, description }

  const prompt = `You are cleaning e-commerce product data. Process this product and return ONLY a JSON object, no markdown, no explanation.

RULES:
1. "name": Fix spelling errors in the product name. Remove only exact duplicate consecutive words. Do NOT change anything else, do NOT add words.
2. "highlights": Return HTML using only <ul><li> tags, no <img> tags, no other tags.
   - If highlights input is empty and description is empty: create highlights using ONLY the name. Do not invent specifications.
   - If highlights input is empty but description exists: create highlights from name + description. Use only given info, do not add specs.
   - If highlights input exists: fix grammar/spelling, strip to only <ul><li> tags, remove <img> tags.
3. "description": Return HTML using only <p> tags, no <img> tags, no other tags.
   - If description input is empty and highlights is empty: create description using ONLY the name.
   - If description input is empty but highlights exists: create description from name + highlights. Use only given info, do not add specs.
   - If description input exists: fix grammar/spelling, strip to only <p> tags, remove <img> tags.

Never invent specifications, materials, sizes, or features not present in the given inputs.

Input:
Name: ${name || '(empty)'}
Highlights: ${highlights || '(empty)'}
Description: ${description || '(empty)'}

Return ONLY this JSON shape: {"name":"...","highlights":"...","description":"..."}`

  try {
    const result = await callGemini(prompt, apiKey)
    const clean = result.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    return {
      name: parsed.name || name,
      highlights: parsed.highlights || highlights,
      description: parsed.description || description,
    }
  } catch {
    return { name, highlights, description }
  }
}

// Match category by product name
export async function matchCategory(productName, cartupCategories, apiKey) {
  if (!apiKey || !productName) return null
  const catList = cartupCategories.slice(0, 150).map(c => `${c.id}|${c.path}`).join('\n')
  const prompt = `Match this product to the best category. Reply ONLY with JSON, no markdown: {"id":"...","path":"...","reason":"..."}

Product: "${productName}"

Categories (ID|Path):
${catList}`
  try {
    const result = await callGemini(prompt, apiKey)
    const clean = result.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch { return null }
}

export async function testConnection(apiKey) {
  try {
    await callGemini('Say "ok"', apiKey, 0)
    return true
  } catch { return false }
}
