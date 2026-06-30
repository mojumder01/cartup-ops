const GEMINI_MODEL = 'gemini-2.5-flash'
const DELAY_MS = 1000      // reduced from 7000
const MAX_RETRIES = 3
const CONCURRENCY = 3      // parallel API calls

export function getApiKey() {
  return localStorage.getItem('gemini_api_key') || ''
}

export function saveApiKey(key) {
  localStorage.setItem('gemini_api_key', key)
}

const TYPO_MAP = {
  'Febric':'Fabric','Fabrics':'Fabric','Fabirc':'Fabric',
  'Jearsy':'Jersey','Jersy':'Jersey','Jearsey':'Jersey',
  'Lenth':'Length','Lenght':'Length',
  'Comfotable':'Comfortable','Comfortble':'Comfortable','Confortable':'Comfortable',
  'Cottan':'Cotton','Coton':'Cotton','Cottton':'Cotton',
  'Poleyster':'Polyester','Polister':'Polyester','Polyster':'Polyester','Poliyester':'Polyester',
  'Woaman':'Women','Weman':'Women','Woomen':'Women',
  'Mens':"Men's",'Womens':"Women's",
  'Shrt':'Shirt','Shrit':'Shirt',
  'Troser':'Trouser','Trousar':'Trouser','Trousser':'Trouser',
  'Pent':'Pant','Pents':'Pants',
  'Sleveless':'Sleeveless','Sleevless':'Sleeveless','Slevless':'Sleeveless',
  'Fullsleeve':'Full Sleeve','Halfsleeve':'Half Sleeve',
  'Jeens':'Jeans','Jens':'Jeans',
  'Kurthi':'Kurti','Kurtee':'Kurti',
  'Sari':'Saree','Orgnza':'Organza',
  'Chifon':'Chiffon','Chiffone':'Chiffon',
  'Gorgette':'Georgette','Gorget':'Georgette',
  'Embroidary':'Embroidery','Embrodery':'Embroidery','Embroidrey':'Embroidery',
  'Collor':'Color','Colour':'Color',
  'Desing':'Design','Dezign':'Design',
  'Beautifull':'Beautiful','Beutiful':'Beautiful',
  'Qualiy':'Quality','Qualty':'Quality',
  'Premiun':'Premium','Primium':'Premium',
  'Fashoin':'Fashion','Fassion':'Fashion',
  'Stylesh':'Stylish','Stlyish':'Stylish',
  'Packege':'Package','Pakage':'Package',
  'Orginal':'Original','Orignal':'Original',
  'Guarntee':'Guarantee','Guarentee':'Guarantee',
  'Warrenty':'Warranty','Waranty':'Warranty',
  'Dupata':'Dupatta','Duptta':'Dupatta',
  'Kamiz':'Kameez','Anarkalli':'Anarkali',
  'Lehnga':'Lehenga','Lahenga':'Lehenga','Palaso':'Palazzo',
  'Prited':'Printed','Stiched':'Stitched','Unstiched':'Unstitched',
  'Embelished':'Embellished','Sequened':'Sequined','Nekline':'Neckline',
  'Jaquard':'Jacquard','Viscouse':'Viscose','Rayan':'Rayon',
  'Spandix':'Spandex','Lycre':'Lycra','Deniim':'Denim',
  'Cordruoy':'Corduroy','Flanel':'Flannel','Flece':'Fleece',
  'Hoody':'Hoodie','Sweathshirt':'Sweatshirt','Tracksuite':'Tracksuit',
  'Tshirt':'T-Shirt','Oversize':'Oversized','Ovesized':'Oversized',
  'Boyfreind':'Boyfriend','Streetware':'Streetwear',
  'Bloues':'Blouse','Salwaar':'Salwar','Shalwar':'Salwar',
}

export function localFixName(name) {
  if (!name) return name
  let result = name
  for (const [wrong, right] of Object.entries(TYPO_MAP)) {
    result = result.replace(new RegExp(`\\b${wrong}\\b`, 'gi'), (match) => {
      if (match === match.toUpperCase()) return right.toUpperCase()
      if (match[0] === match[0].toUpperCase()) return right.charAt(0).toUpperCase() + right.slice(1)
      return right
    })
  }
  result = result.replace(/\b(\w+)(\s+\1)+\b/gi, '$1')
  result = result.replace(/\s{2,}/g, ' ').trim()
  result = result.replace(/^[\s\-–—]+|[\s\-–—]+$/g, '').trim()
  return result
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
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
      })
    }
  )
  if (res.status === 429) {
    if (retries > 0) { await sleep(15000); return callGemini(prompt, apiKey, retries - 1) }
    throw new Error('Gemini rate limit — please wait a minute and try again')
  }
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

// ── Batch process up to 5 products in ONE API call ───────────────────────────
export async function processProductsBatch(products, apiKey) {
  // products: [{pid, name, highlights, description}]
  // returns: {pid: {name, highlights, description}}
  if (!products.length) return {}

  // Local fix first
  const localFixed = products.map(p => ({ ...p, name: localFixName(p.name || '') }))

  if (!apiKey) {
    return Object.fromEntries(localFixed.map(p => [p.pid, { name: p.name, highlights: p.highlights, description: p.description }]))
  }

  const inputBlock = localFixed.map((p, i) =>
    `Product ${i + 1} (id: "${p.pid}"):\nName: ${p.name || '(empty)'}\nHighlights: ${p.highlights || '(empty)'}\nDescription: ${p.description || '(empty)'}`
  ).join('\n\n')

  const prompt = `You are cleaning e-commerce product data. Process ALL ${products.length} products below and return ONLY a JSON array, no markdown, no explanation.

RULES for each product:
1. "name": Fix remaining spelling errors. Remove only exact duplicate consecutive words. Do NOT add words or change product type/color/attributes.
2. "highlights": Return HTML using ONLY <ul><li> tags.
   - Remove ALL non-Latin characters (Bengali, Chinese, Japanese, Arabic, etc.)
   - Remove encoding artifacts: Â, â€™, Ã, â€", ï¿½, etc.
   - Remove hashtags (#word) and keyword-spam items
   - Remove duplicate <li> items and empty <li> items. Remove all <img> tags.
   - If empty after cleaning or was empty: create 3-5 bullets from name + description ONLY. Never invent specs.
3. "description": Return HTML using ONLY <p> tags.
   - Remove ALL non-Latin characters and encoding artifacts. Remove all <img> tags.
   - If contains boilerplate ("The seller offers...", "We provide...", "Contact us..."): replace with 2-3 sentence product-specific text from name + highlights ONLY.
   - If empty: create 2-3 sentences from name + highlights ONLY.

CRITICAL: NEVER add info not in the given inputs. NEVER invent materials, specs, features.

${inputBlock}

Return ONLY a JSON array with ${products.length} objects, preserving the "pid" field:
[{"pid":"...","name":"...","highlights":"...","description":"..."},...]`

  try {
    const result = await callGemini(prompt, apiKey)
    const clean = result.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    const map = {}
    for (const item of parsed) {
      if (item.pid) map[item.pid] = { name: item.name, highlights: item.highlights, description: item.description }
    }
    // Fill any missing with local-fixed version
    for (const p of localFixed) {
      if (!map[p.pid]) map[p.pid] = { name: p.name, highlights: p.highlights, description: p.description }
    }
    return map
  } catch {
    return Object.fromEntries(localFixed.map(p => [p.pid, { name: p.name, highlights: p.highlights, description: p.description }]))
  }
}

// ── Single product (used by manualProcessor) ──────────────────────────────────
export async function processProductAI(name, highlights, description, apiKey) {
  const localName = localFixName(name || '')
  if (!apiKey) return { name: localName, highlights, description }
  const result = await processProductsBatch([{ pid: '__single__', name: localName, highlights, description }], apiKey)
  const r = result['__single__'] || {}
  return { name: r.name || localName, highlights: r.highlights || highlights, description: r.description || description }
}

// ── Category match ────────────────────────────────────────────────────────────
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

// ── Run async tasks with max concurrency ─────────────────────────────────────
export async function runConcurrent(tasks, concurrency = CONCURRENCY) {
  const results = []
  let idx = 0
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++
      results[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return results
}

export async function fixName(name, apiKey) {
  const local = localFixName(name || '')
  if (!apiKey) return local
  const { name: fixed } = await processProductAI(local, '', '', apiKey)
  return fixed || local
}

export async function fixHighlights(highlights, name, description, apiKey) {
  if (!apiKey) return highlights
  const { highlights: fixed } = await processProductAI(name, highlights, description, apiKey)
  return fixed || highlights
}

export async function fixDescription(description, name, highlights, apiKey) {
  if (!apiKey) return description
  const { description: fixed } = await processProductAI(name, highlights, description, apiKey)
  return fixed || description
}

export async function testConnection(apiKey) {
  try {
    await sleep(DELAY_MS)
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Say "ok"' }] }], generationConfig: { maxOutputTokens: 10 } })
      }
    )
    if (res.status === 429) return 'rate_limited'
    if (res.ok) return 'ok'
    return 'fail'
  } catch { return 'fail' }
}
