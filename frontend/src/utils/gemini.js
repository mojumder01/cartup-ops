import { getProvider, callGrok, getGrokApiKey } from './aiProvider'
import { enforceImageRules, IMAGE_RULE_PROMPT } from './contentRules'

const GEMINI_MODEL = 'gemini-3.1-flash-lite'
const DELAY_MS = 2000
const MAX_RETRIES = 3
const CONCURRENCY = 3      // parallel API calls

export function getApiKey() {
  return localStorage.getItem('gemini_api_key') || ''
}

export function saveApiKey(key) {
  localStorage.setItem('gemini_api_key', key)
}

// The key that actually gets used for AI calls — Grok's key when Grok is the
// selected provider, otherwise the Gemini key. Every page reads this (not the
// raw getApiKey above) so switching provider in Profile is enough to re-route
// Production/QC/Governance without touching those pages.
export function getActiveApiKey() {
  return getProvider() === 'grok' ? getGrokApiKey() : getApiKey()
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
  if (getProvider() === 'grok') return callGrok(prompt, apiKey, retries)
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

// ── Combined: clean + categorise in ONE API call ─────────────────────────────
export async function processAndCategoriseBatch(products, cartupCategories, apiKey) {
  // products: [{pid, name, highlights, description}]
  // returns: {pid: {name, highlights, description, categoryId, categoryPath, categoryError}}
  if (!products.length) return {}

  const localFixed = products.map(p => ({ ...p, name: localFixName(p.name || '') }))

  if (!apiKey) {
    return Object.fromEntries(localFixed.map(p => [p.pid, {
      name: p.name, highlights: p.highlights, description: p.description,
      categoryId: '', categoryPath: '', categoryError: 'No API key'
    }]))
  }

  // Build category pool from combined keywords
  const pathToId = {}
  for (const c of cartupCategories) pathToId[c.path.toLowerCase()] = c.id

  const allWords = new Set()
  for (const p of localFixed) {
    p.name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
      .forEach(w => allWords.add(w))
  }
  let filtered = cartupCategories.filter(c => [...allWords].some(w => c.path.toLowerCase().includes(w)))
  if (filtered.length < 10) {
    const shorter = [...allWords].filter(w => w.length > 2 && !STOP_WORDS.has(w))
    filtered = cartupCategories.filter(c => shorter.some(w => c.path.toLowerCase().includes(w)))
  }
  const pool = filtered.length >= 5 ? filtered.slice(0, 150) : cartupCategories.slice(0, 250)
  const catList = pool.map(c => `${c.id}|${c.path}`).join('\n')

  const inputBlock = localFixed.map((p, i) =>
    `Product ${i + 1} (pid:"${p.pid}"):\nName: ${p.name || '(empty)'}\nHighlights: ${p.highlights || '(empty)'}\nDescription: ${p.description || '(empty)'}`
  ).join('\n\n')

  const prompt = `You are an e-commerce product data processor. For EACH product below:
1. Clean the name: fix ALL spelling mistakes (zero tolerance), remove duplicate words, translate non-English to English. Do NOT change product type/color/attributes, brand names, or model codes.
2. highlights: Recreate as <ul><li> HTML bullets. STRICT RULES:
   - Use ONLY information present in the given Name/Highlights/Description — nothing else.
   - DO NOT add ANY AI-generated extra information, marketing phrases, invented specs, or assumptions.
   - DO NOT remove ANY specification, feature, measurement, or detail — every piece of source information must appear in the output.
   - Fix ALL spelling and grammar mistakes — zero tolerance (brand names and model codes stay unchanged).
   - Remove only: non-Latin chars, hashtags, clearly empty items. If input is empty, create bullets from the name only.
3. description: Recreate as clean <p> HTML paragraphs. Same STRICT RULES as highlights:
   - Use ONLY given information. DO NOT add anything AI-generated. DO NOT remove any spec/detail.
   - Fix ALL spelling and grammar — zero tolerance.
   - Remove only: non-Latin chars, obvious boilerplate ("click add to cart", "contact us" etc). If input is empty, write 2 sentences from the name only.
${IMAGE_RULE_PROMPT}
4. category_id + category_path: Pick the BEST matching category from the list below.

PRODUCTS:
${inputBlock}

CATEGORIES (ID|Path):
${catList}

Return ONLY a JSON array, no markdown:
[{"pid":"...","name":"...","highlights":"...","description":"...","category_id":"...","category_path":"..."},...]`

  try {
    const result = await callGemini(prompt, apiKey)
    const clean = result.replace(/```json|```/g, '').trim()
    const arrMatch = clean.match(/\[[\s\S]*\]/)
    if (!arrMatch) throw new Error(`No JSON array. Got: ${clean.slice(0, 80)}`)
    const parsed = JSON.parse(arrMatch[0])
    const map = {}
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i]
      const pid = String(item.pid || localFixed[i]?.pid || '')
      if (!pid) continue
      let catId = String(item.category_id || item.categoryId || item.id || '')
      const catPath = item.category_path || item.categoryPath || item.path || ''
      if (!catId && catPath) catId = pathToId[catPath.toLowerCase()] || ''
      const validCat = pool.find(c => c.id === catId)
      const { highlights, description } = enforceImageRules(item.highlights || '', item.description || '')
      map[pid] = {
        name: item.name || localFixed[i]?.name || '',
        highlights, description,
        categoryId: validCat ? catId : '',
        categoryPath: validCat ? validCat.path : '',
        categoryError: validCat ? '' : (catId ? `Unknown ID: ${catId}` : 'No category returned'),
      }
    }
    // Fill missing pids
    for (const p of localFixed) {
      if (!map[p.pid]) map[p.pid] = { name: p.name, highlights: p.highlights, description: p.description, categoryId: '', categoryPath: '', categoryError: 'Missing from AI response' }
    }
    return map
  } catch (e) {
    const errMsg = e.message || 'Unknown error'
    return Object.fromEntries(localFixed.map(p => [p.pid, {
      name: p.name, highlights: p.highlights, description: p.description,
      categoryId: '', categoryPath: '', categoryError: errMsg
    }]))
  }
}

// ── Batch process up to 5 products in ONE API call (no category) ──────────────
export async function processProductsBatch(products, apiKey) {
  // products: [{pid, name, highlights, description}]
  // returns: {pid: {name, highlights, description}}
  if (!products.length) return {}
  const localFixed = products.map(p => ({ ...p, name: localFixName(p.name || '') }))
  if (!apiKey) {
    return Object.fromEntries(localFixed.map(p => [p.pid, { name: p.name, highlights: p.highlights, description: p.description }]))
  }
  const inputBlock = localFixed.map((p, i) =>
    `Product ${i + 1} (id: "${p.pid}"):\nName: ${p.name || '(empty)'}\nHighlights: ${p.highlights || '(empty)'}\nDescription: ${p.description || '(empty)'}`
  ).join('\n\n')
  const prompt = `You are cleaning e-commerce product data. Process ALL ${products.length} products below and return ONLY a JSON array, no markdown, no explanation.
STRICT RULES:
1. name: fix ALL spelling mistakes (zero tolerance), remove duplicate words. Brand names and model codes stay unchanged.
2. highlights: <ul><li> HTML — use ONLY given information, DO NOT add any AI-generated info/marketing/invented specs, DO NOT remove any spec/feature/measurement/detail, fix ALL spelling+grammar (zero tolerance), remove only non-Latin chars/hashtags/empty items; if empty create bullets from name.
3. description: <p> HTML — use ONLY given information, DO NOT add anything AI-generated, DO NOT remove any spec/detail, fix ALL spelling+grammar (zero tolerance), remove only non-Latin chars and obvious boilerplate ("click add to cart" etc); if empty write 2 sentences from name.
${IMAGE_RULE_PROMPT}
${inputBlock}
Return ONLY: [{"pid":"...","name":"...","highlights":"...","description":"..."},...]`
  try {
    const result = await callGemini(prompt, apiKey)
    const clean = result.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    const map = {}
    for (const item of parsed) {
      if (item.pid) {
        const { highlights, description } = enforceImageRules(item.highlights || '', item.description || '')
        map[item.pid] = { name: item.name, highlights, description }
      }
    }
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

// Common English words that match too many unrelated category paths
const STOP_WORDS = new Set([
  'the','and','for','with','from','this','that','are','was','has',
  'not','but','can','all','new','one','its','our','use','any','may',
  'dry','wet','hot','cold','cell','smart','mini','plus','pro','max',
  'set','kit','box','bag','top','big','fit','air','oil','gel','pad',
])

// ── Batch category match — one API call for up to 10 products ────────────────
export async function matchCategoriesBatch(products, cartupCategories, apiKey) {
  // returns: {pid: {id, path} | {__error__: msg}}
  if (!apiKey || !products.length) return {}

  // Build path-to-id lookup for fallback matching
  const pathToId = {}
  for (const c of cartupCategories) pathToId[c.path.toLowerCase()] = c.id

  // Collect meaningful keywords (exclude stop words and short words)
  const allWords = new Set()
  for (const p of products) {
    p.name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
      .forEach(w => allWords.add(w))
  }

  // Filter categories by keyword match
  let filtered = cartupCategories.filter(c =>
    [...allWords].some(w => c.path.toLowerCase().includes(w))
  )
  // Broaden if too few matches
  if (filtered.length < 10) {
    const shorter = [...allWords].filter(w => w.length > 2 && !STOP_WORDS.has(w))
    filtered = cartupCategories.filter(c =>
      shorter.some(w => c.path.toLowerCase().includes(w))
    )
  }
  const pool = filtered.length >= 5 ? filtered.slice(0, 200) : cartupCategories.slice(0, 300)
  const catList = pool.map(c => `${c.id}|${c.path}`).join('\n')

  const productBlock = products.map((p, i) => `${i + 1}. (pid:"${p.pid}") "${p.name}"`).join('\n')

  const prompt = `You are a product categorization assistant.
Match each product to the single BEST category ID from the list.
Respond ONLY with a JSON array. No markdown, no explanation.

Products:
${productBlock}

Category list (ID|Full Path):
${catList}

Required output format — one object per product:
[{"pid":"<exact pid from above>","id":"<category ID number>","path":"<full category path>"}]`

  try {
    const result = await callGemini(prompt, apiKey)
    if (!result) return { __error__: 'Empty response from Gemini' }

    const clean = result.replace(/```json|```/g, '').trim()
    const match = clean.match(/\[[\s\S]*?\]/)
    if (!match) return { __error__: `No JSON array found. Response: ${clean.slice(0, 80)}` }

    const parsed = JSON.parse(match[0])
    const out = {}
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i]
      const pid = String(item.pid || products[i]?.pid || '')
      if (!pid) continue

      // Accept id from response, or look up by path if id missing/invalid
      let id = String(item.id || item.category_id || item.categoryId || '')
      const path = item.path || item.category_path || ''

      if (!id && path) {
        id = pathToId[path.toLowerCase()] || ''
      }
      // Verify id exists in our category list
      const validCat = pool.find(c => c.id === id)
      if (validCat) {
        out[pid] = { id, path: validCat.path }
      } else if (path) {
        // Try fuzzy path match
        const lower = path.toLowerCase()
        const found = pool.find(c => c.path.toLowerCase() === lower)
        if (found) out[pid] = { id: found.id, path: found.path }
      }
    }
    return out
  } catch (e) {
    return { __error__: e.message || 'Unknown error' }
  }
}

// ── Single category match (kept for compatibility) ────────────────────────────
export async function matchCategory(productName, cartupCategories, apiKey) {
  if (!apiKey || !productName) return null
  const results = await matchCategoriesBatch([{ pid: '__single__', name: productName }], cartupCategories, apiKey)
  return results['__single__'] || null
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
