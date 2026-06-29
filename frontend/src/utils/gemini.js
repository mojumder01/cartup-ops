const GEMINI_MODEL = 'gemini-2.0-flash-lite'

export function getApiKey() {
  return localStorage.getItem('gemini_api_key') || ''
}

export function saveApiKey(key) {
  localStorage.setItem('gemini_api_key', key)
}

async function callGemini(prompt, apiKey) {
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
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

// Fix name: spelling + remove duplicate words
export async function fixName(name, apiKey) {
  if (!apiKey || !name) return name
  const prompt = `Fix spelling errors in this product name. Remove only exact duplicate consecutive words. Do NOT change anything else. Return ONLY the fixed name, nothing else.

Product name: "${name}"`
  try {
    const result = await callGemini(prompt, apiKey)
    return result.trim().replace(/^["']|["']$/g, '')
  } catch { return name }
}

// Match category by product name
export async function matchCategory(productName, cartupCategories, apiKey) {
  if (!apiKey || !productName) return null
  const catList = cartupCategories.slice(0, 200).map(c => `${c.id}|${c.path}`).join('\n')
  const prompt = `Match this product to the best category. Reply ONLY with JSON: {"id":"...","path":"...","reason":"..."}

Product: "${productName}"

Categories (ID|Path):
${catList}`
  try {
    const result = await callGemini(prompt, apiKey)
    const clean = result.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch { return null }
}

// Fix highlights HTML
export async function fixHighlights(highlights, name, description, apiKey) {
  if (!apiKey) return highlights

  let prompt = ''
  if (!highlights && !description) {
    prompt = `Create product highlights using ONLY this product name. Use only given information, do NOT add specifications.
Return ONLY: <ul><li>point</li><li>point</li>...</ul>
Product name: "${name}"`
  } else if (!highlights && description) {
    prompt = `Create highlights from product name and description. Use only given info, do NOT add specs.
Return ONLY: <ul><li>point</li><li>point</li>...</ul>
Name: "${name}"
Description: "${description}"`
  } else {
    prompt = `Fix this HTML highlights: fix grammar/spelling, keep only <ul><li> tags, remove <img> tags, remove unused HTML tags.
Return ONLY the fixed HTML.
Input: ${highlights}`
  }

  try {
    const result = await callGemini(prompt, apiKey)
    return result.trim().replace(/```html|```/g, '').trim()
  } catch { return highlights }
}

// Fix description HTML
export async function fixDescription(description, name, highlights, apiKey) {
  if (!apiKey) return description

  let prompt = ''
  if (!description && !highlights) {
    prompt = `Create product description using ONLY this name. Use only given info, do NOT add specifications.
Return ONLY: <p>text</p>
Product name: "${name}"`
  } else if (!description && highlights) {
    prompt = `Create description from name and highlights. Use only given info, do NOT add specs.
Return ONLY: <p>text</p><p>text</p>...
Name: "${name}"
Highlights: "${highlights}"`
  } else {
    prompt = `Fix this HTML description: fix grammar/spelling, keep only <p> tags, remove <img> tags, remove <pre> tags (convert to <p>), remove unused tags.
Return ONLY the fixed HTML.
Input: ${description}`
  }

  try {
    const result = await callGemini(prompt, apiKey)
    return result.trim().replace(/```html|```/g, '').trim()
  } catch { return description }
}

export async function testConnection(apiKey) {
  try {
    await callGemini('Say "ok"', apiKey)
    return true
  } catch { return false }
}
