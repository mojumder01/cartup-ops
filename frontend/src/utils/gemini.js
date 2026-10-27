import { callAI, firstKey, loadSettings } from './aiPool'
import { enforceImageRules, IMAGE_RULE_PROMPT } from './contentRules'

// What pages check (and pass along) for "AI is on": the first ticked Gemini
// key. The calls themselves use every ticked key (aiPool.js).
export function getActiveApiKey() {
  return firstKey()
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

// Every AI pass goes through the key pool: provider from Profile, keys and
// models used in turn (apiKey is only the "AI is on" flag the pages pass).
function callGemini(prompt) {
  return callAI(prompt, { maxOutputTokens: 4096 })
}

// The JSON array in an AI answer (it may come wrapped in ``` fences or text).
export function jsonArray(raw) {
  const clean = String(raw || '').replace(/```json|```/g, '').trim()
  const m = clean.match(/\[[\s\S]*\]/)
  if (!m) throw new Error(`The AI answer had no JSON list: ${clean.slice(0, 80) || '(empty)'}`)
  const arr = JSON.parse(m[0])
  if (!Array.isArray(arr)) throw new Error('The AI answer was not a list')
  return arr
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
export async function processProductsBatch(products, apiKey, onError, fields = {}) {
  // products: [{pid, name, highlights, description}]
  // returns: {pid: {name, highlights, description}}
  // onError(message, pids): the AI call failed, so these products got the
  // local spelling fix only.
  // fields: { name, highlights, description } — false leaves that field out of
  // the AI's work: the name keeps the local spelling fix, highlights or
  // description come back empty (the caller fills them locally).
  const on = { name: fields.name !== false, highlights: fields.highlights !== false, description: fields.description !== false }
  if (!products.length) return {}
  const localFixed = products.map(p => ({ ...p, name: localFixName(p.name || '') }))
  if (!apiKey) {
    return Object.fromEntries(localFixed.map(p => [p.pid, { name: p.name, highlights: p.highlights, description: p.description }]))
  }
  const inputBlock = localFixed.map((p, i) => [`Product ${i + 1} (id: "${p.pid}"):`, `Name: ${p.name || '(empty)'}`,
    on.highlights && `Highlights: ${p.highlights || '(empty)'}`, on.description && `Description: ${p.description || '(empty)'}`].filter(Boolean).join('\n')
  ).join('\n\n')
  const rules = [
    on.name ? 'name: fix ALL spelling mistakes (zero tolerance), remove duplicate words. Brand names and model codes stay unchanged.' : '',
    on.highlights ? 'highlights: <ul><li> HTML — use ONLY given information, DO NOT add any AI-generated info/marketing/invented specs, DO NOT remove any spec/feature/measurement/detail, fix ALL spelling+grammar (zero tolerance), remove only non-Latin chars/hashtags/empty items; if empty create bullets from name.' : '',
    on.description ? 'description: <p> HTML — use ONLY given information, DO NOT add anything AI-generated, DO NOT remove any spec/detail, fix ALL spelling+grammar (zero tolerance), remove only non-Latin chars and obvious boilerplate ("click add to cart" etc); if empty write 2 sentences from name.' : '',
  ].filter(Boolean).map((r, i) => `${i + 1}. ${r}`).join('\n')
  const keys = ['pid', ...['name', 'highlights', 'description'].filter(k => on[k])]
  const prompt = `You are cleaning e-commerce product data. Process ALL ${products.length} products below and return ONLY a JSON array, no markdown, no explanation.
STRICT RULES:
${rules}${on.name ? '' : '\n(The name is given for context only — do not return it.)'}
${on.highlights || on.description ? IMAGE_RULE_PROMPT : ''}
${inputBlock}
Return ONLY: [{${keys.map(k => `"${k}":"..."`).join(',')}},...]`
  try {
    const parsed = jsonArray(await callGemini(prompt, apiKey))
    const map = {}
    parsed.forEach((item, i) => {
      const pid = String(item?.pid ?? item?.id ?? localFixed[i]?.pid ?? '')
      if (!pid || !localFixed.some(p => p.pid === pid)) return
      const { highlights, description } = enforceImageRules(on.highlights ? String(item.highlights || '') : '', on.description ? String(item.description || '') : '')
      map[pid] = { name: on.name ? String(item.name || '').trim() : localFixed.find(p => p.pid === pid).name, highlights, description }
    })
    // Products the answer left out keep the local fix — and are reported.
    const missing = localFixed.filter(p => !map[p.pid])
    for (const p of missing) map[p.pid] = { name: p.name, highlights: p.highlights, description: p.description }
    if (missing.length) onError?.('The AI answer left some products out', missing.map(p => p.pid))
    return map
  } catch (e) {
    onError?.(e.message || 'Unknown error', localFixed.map(p => p.pid))
    return Object.fromEntries(localFixed.map(p => [p.pid, { name: p.name, highlights: p.highlights, description: p.description }]))
  }
}

// ── Variations Combo: a label for each part — never a value ──────────────────
// products: [{ pid, name, category, columns, combos, parts }]
// → { pid: { part: label } } for the products in the answer (the caller
// checks every label — see checkLabels in variantReview.js).
// onError(message, pids): the call failed or left products out.
export async function readVariantCombos(products, onError) {
  if (!products.length) return {}
  const block = products.map((p, i) => [
    `${i + 1}. id "${p.pid}" — ${p.name}`,
    `   Category: ${p.category} · its variant columns: ${p.columns.join(', ') || 'unknown'}`,
    `   Combos: ${p.combos.slice(0, 8).map(c => JSON.stringify(c)).join(' · ')}${p.combos.length > 8 ? ` … (${p.combos.length} in all)` : ''}`,
    `   Parts: ${JSON.stringify(p.parts)}`,
  ].join('\n')).join('\n')
  const prompt = `You label the parts of e-commerce product variants. A product's "Variations Combo" lists one SKU's variant values separated by commas — e.g. "Black, XL" is the colour Black and the size XL.
For EVERY product below, give EVERY part listed under "Parts" exactly one label:
- colour: a colour or colour mix (Black, Navy Blue, Rose Gold, Multicolor, Black & White)
- size: a size — S/M/L/XL, a number size (40, EU:42), Free Size, a size range (37-39), a measurement (6x7 ft, 32 inch)
- age: an age or age group (3-4 Years, 6 Months, Kids, Adult)
- type: any other kind of variant — model, style, design, pattern, flavour, scent, material, body part (Leg, Back), side (Left/Right)
- quantity: a pack, count, weight or volume (2 pcs, Pack of 3, 500 ml, 1 kg)
- none: no information (Not Specified, Default, As picture, N/A)
STRICT RULES:
- Labels only. Never correct, translate, merge, split or invent parts: use each part exactly as written as the key.
- Use the product name: "Orange" is a colour for a T-shirt but a type (flavour) for a juice; "Black" is a type for tea.
- If unsure, answer "type".
${block}
Return ONLY a JSON array, no markdown: [{"id":"<id>","labels":{"<part>":"<label>",...}},...]`
  try {
    const parsed = jsonArray(await callAI(prompt, { maxOutputTokens: 8192, temperature: 0 }))
    const ids = new Set(products.map(p => p.pid)), out = {}
    for (const x of parsed) {
      const pid = String(x?.id ?? x?.pid ?? '')
      if (ids.has(pid) && x.labels && typeof x.labels === 'object' && !Array.isArray(x.labels)) out[pid] = x.labels
    }
    const missing = products.filter(p => !out[p.pid])
    if (missing.length) onError?.('The AI answer left some products out', missing.map(p => p.pid))
    return out
  } catch (e) {
    onError?.(e.message || 'Unknown error', products.map(p => p.pid))
    return {}
  }
}

// ── Variant values the rules couldn't finish: the closest CartUp value ───────
// products: [{ pid, name, category, columns, skus: [{ sku, combo, now: { col: value }, pick: [col] }], candidates: { col: [values] } }]
// → { pid: { sku: { col: value } } } — the caller keeps only candidates that
// are on CartUp's list, made of the seller's own words, and leave every SKU
// different (see applyAIPicks in variantReview.js).
export async function pickVariantValues(products, onError) {
  if (!products.length) return {}
  const block = products.map((p, i) => [
    `Product ${i + 1} (id "${p.pid}") — ${p.name}`,
    `  Category: ${p.category} · its variant columns: ${p.columns.join(', ')}`,
    ...p.skus.map(s => `  SKU ${JSON.stringify(s.sku)}: Variations Combo ${JSON.stringify(s.combo)} · now ${Object.entries(s.now).map(([c, v]) => `${c} = ${JSON.stringify(v)}`).join(', ') || '—'}${s.pick.length ? ` · PICK: ${s.pick.join(', ')}` : ''}`),
    ...Object.entries(p.candidates).map(([c, vs]) => `  Candidates for ${c}: ${JSON.stringify(vs)}`),
  ].join('\n')).join('\n\n')
  const prompt = `You are a careful catalogue editor. CartUp accepts variant values (Color, Size…) only from its own lists. For the products below, the rules could not finish some cells — a value not on CartUp's list, variants numbered apart (Black-1, Black-2), or variants that would be identical.
For every cell marked PICK, choose ONE value from that column's candidates: the one closest to what the seller wrote in the SKU's Variations Combo.
STRICT RULES:
- Only candidate values, copied exactly. Never invent, combine or edit a value.
- Keep to the seller's words: never a colour, size, number or word that is not in that SKU's combo. "L/XL" → "XL" or "L" is fine; a range "37-39" → a range such as "35-39 (EU)", never one size like "37".
- After your picks, all SKUs of a product must be different from each other.
- If no candidate fits a cell, answer "" for it — a person decides then; a wrong value is worse than none.
${block}
Return ONLY a JSON array, no markdown: [{"id":"<product id>","picks":{"<sku>":{"<column>":"<value>"}}},...]`
  try {
    const parsed = jsonArray(await callAI(prompt, { maxOutputTokens: 8192, temperature: 0 }))
    const ids = new Set(products.map(p => p.pid)), out = {}
    for (const x of parsed) {
      const pid = String(x?.id ?? x?.pid ?? '')
      if (ids.has(pid) && x.picks && typeof x.picks === 'object' && !Array.isArray(x.picks)) out[pid] = x.picks
    }
    const missing = products.filter(p => !out[p.pid])
    if (missing.length) onError?.('The AI answer left some products out', missing.map(p => p.pid))
    return out
  } catch (e) {
    onError?.(e.message || 'Unknown error', products.map(p => p.pid))
    return {}
  }
}

// ── CartUp category for products without one (AI category check) ─────────────
// products: [{ pid, name, candidates: [{ id, path }] }] — products whose Daraz
// category has no CartUp mapping.
// → { pid: { verdict: 'pick' | 'none', category } } — the caller takes a pick
// only when its category is one of that product's candidates.
export async function checkProductCategories(products, onError) {
  if (!products.length) return {}
  const block = products.map((p, i) => [
    `${i + 1}. id "${p.pid}" — ${p.name}`,
    ...p.candidates.map(c => `   - ${c.id} | ${c.path}`),
  ].join('\n')).join('\n')
  const prompt = `You pick the marketplace category for e-commerce products that have none yet.
For EVERY product below answer one verdict:
- "pick": the id of the best category from the product's own list (the lines starting with "-") — where a shopper would look for it.
- "none": no category in its list fits the product.
STRICT RULES:
- Judge by what the product IS (from its name), not by words it shares with a category: a phone case is not a phone; a T-shirt with a cartoon is not a toy.
- Who it is for counts: Men / Women / Boys / Girls / Kids — follow the name; when the name doesn't say, any fitting one is right.
- Only an id from that product's own list. Never invent an id.
${block}
Return ONLY a JSON array, no markdown: [{"id":"<product id>","verdict":"pick|none","category":"<category id, or empty>"},...]`
  try {
    const parsed = jsonArray(await callAI(prompt, { maxOutputTokens: 4096, temperature: 0 }))
    const ids = new Set(products.map(p => p.pid)), out = {}
    for (const x of parsed) {
      const pid = String(x?.id ?? x?.pid ?? '')
      const verdict = String(x?.verdict ?? '').trim().toLowerCase()
      if (ids.has(pid) && ['pick', 'change', 'keep', 'none'].includes(verdict)) out[pid] = { verdict: verdict === 'pick' || verdict === 'change' ? 'pick' : 'none', category: String(x.category ?? '').trim() }
    }
    const missing = products.filter(p => !out[p.pid])
    if (missing.length) onError?.('The AI answer left some products out', missing.map(p => p.pid))
    return out
  } catch (e) {
    onError?.(e.message || 'Unknown error', products.map(p => p.pid))
    return {}
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
// Throws when the AI couldn't answer (so the caller can say why there is no match).
export async function matchCategory(productName, cartupCategories, apiKey) {
  if (!apiKey || !productName) return null
  const results = await matchCategoriesBatch([{ pid: '__single__', name: productName }], cartupCategories, apiKey)
  if (results.__error__) throw new Error(results.__error__)
  return results['__single__'] || null
}

// ── Run async tasks with max concurrency ─────────────────────────────────────
// Default: "Requests at the same time" from Profile.
export async function runConcurrent(tasks, concurrency = loadSettings().parallel) {
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
