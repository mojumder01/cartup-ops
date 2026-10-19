import * as XLSX from 'xlsx'
import MAPPINGS from './mappings.json'
import { applyReplacements } from './wordReplacements'
import { callAI } from './aiPool'
import { stripImagesFromHighlights, fixDescriptionImages, enforceImageRules, IMAGE_RULE_PROMPT } from './contentRules'

const { cartup_map } = MAPPINGS
// batch size is user-configurable (smaller = better accuracy, more API calls)
export function getGovBatchSize() {
  const v = parseInt(localStorage.getItem('gov_batch_size'), 10)
  return isNaN(v) ? 10 : Math.min(20, Math.max(1, v))
}
export function saveGovBatchSize(v) {
  try { localStorage.setItem('gov_batch_size', String(Math.min(20, Math.max(1, v)))) } catch {}
}
const CHECKPOINT_KEY = 'gov_checkpoint'

// Through the key pool: provider from Profile, keys and models used in turn.
function callGemini(prompt) {
  return callAI(prompt, { maxOutputTokens: 8192 })
}
// The JSON list in an AI answer — or an error saying the answer was unreadable.
function parseList(raw) {
  const clean = String(raw || '').replace(/```json|```/g, '').trim()
  const m = clean.match(/\[[\s\S]*\]/)
  if (!m) throw new Error(`unreadable AI answer: ${clean.slice(0, 60) || '(empty)'}`)
  try { return JSON.parse(m[0]) } catch { throw new Error('unreadable AI answer (broken JSON)') }
}
// AI errors that stop the run (saved like a pause, Resume continues later).
const STOP = /limit is used|at their limit|No Gemini API key|Network error/i

function readSheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        resolve(XLSX.utils.sheet_to_json(ws, { defval: '' }))
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

function col(row, ...keys) {
  for (const k of keys) {
    const found = Object.keys(row).find(h => h.toLowerCase().trim() === k.toLowerCase())
    if (found && row[found] !== undefined && row[found] !== '') return String(row[found]).trim()
  }
  return ''
}

function fileKey(file) { return `${file.name}__${file.size}` }

// ── Checkpoint ────────────────────────────────────────────────────────────────
export function loadCheckpoint(file) {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY)
    if (!raw) return null
    const cp = JSON.parse(raw)
    if (cp.fileKey !== fileKey(file)) return null
    return cp
  } catch { return null }
}

export function clearCheckpoint() { localStorage.removeItem(CHECKPOINT_KEY) }

function saveCheckpoint(file, checks, state) {
  try {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({ fileKey: fileKey(file), checks, savedAt: Date.now(), ...state }))
  } catch {}
}

// ── Category helpers ──────────────────────────────────────────────────────────
const ALL_CATS = Object.entries(cartup_map).map(([id, v]) => ({ id, path: v.path }))

const SKIP_TOKENS = new Set([
  'the','and','for','with','from','this','that','are','was','has','not','but',
  'can','all','new','one','its','our','use','any','may','products','other',
  'size','color','type','pack','pcs','piece','pieces','set','kit',
])

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 1 && !SKIP_TOKENS.has(t))
}

function scorePathWeighted(cat, queryTokens) {
  const segments = cat.path.split('>').map(s => s.trim())
  const leaf = segments[segments.length - 1]
  const leafTokens = tokenize(leaf)
  const fullTokens = tokenize(cat.path)

  let score = 0
  for (const q of queryTokens) {
    // Exact match in leaf: highest weight
    if (leafTokens.includes(q)) { score += 6; continue }
    // Partial match in leaf
    if (leafTokens.some(t => t.includes(q) || q.includes(t))) { score += 3; continue }
    // Exact match anywhere in path
    if (fullTokens.includes(q)) { score += 2; continue }
    // Partial match in path
    if (fullTokens.some(t => t.includes(q) || q.includes(t))) { score += 1 }
  }
  return score
}

function topCandidates(items, n = 25) {
  // items: [{sku, queries: [string, ...]}] — multiple search queries per product
  const result = {}
  for (const { sku, queries } of items) {
    const allQueryTokens = [...new Set(queries.flatMap(q => tokenize(q)))]
    if (!allQueryTokens.length) { result[sku] = ALL_CATS.slice(0, n); continue }
    const scored = ALL_CATS.map(c => ({
      ...c,
      score: scorePathWeighted(c, allQueryTokens),
    })).sort((a, b) => b.score - a.score)
    result[sku] = scored.slice(0, n)
  }
  return result
}

// ── Individual pass batch functions ──────────────────────────────────────────

async function batchName(products, apiKey) {
  // products: [{sku, name}]
  const inputBlock = products.map((p, i) =>
    `Product ${i + 1} (sku:"${p.sku}"):\nName: ${p.name || '(empty)'}`
  ).join('\n\n')

  const prompt = `You are a product data governance assistant. For EACH product:
Clean the product name: remove duplicate/repeated words, translate any non-English to English, fix ALL spelling mistakes (zero tolerance — every misspelled word must be corrected). Keep ALL product info. Do not change brand names or model codes.

PRODUCTS:
${inputBlock}

Return ONLY a JSON array, no markdown:
[{"sku":"...","name":"..."}]`

  const arr = parseList(await callGemini(prompt, apiKey))
  const map = {}
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    const sku = String(item.sku || products[i]?.sku || '')
    if (!sku) continue
    map[sku] = applyReplacements(item.name || products[i]?.name || '')
  }
  for (const p of products) { if (!map[p.sku]) map[p.sku] = p.name }
  return map
}

async function batchWeight(products, apiKey) {
  // products: [{sku, name}]
  const inputBlock = products.map((p, i) =>
    `Product ${i + 1} (sku:"${p.sku}"):\nName: ${p.name || '(empty)'}`
  ).join('\n\n')

  const prompt = `You are a product data governance assistant. For EACH product:
Estimate realistic shipping weight in kg based on the product name.

PRODUCTS:
${inputBlock}

Return ONLY a JSON array, no markdown:
[{"sku":"...","weight_kg":0.0,"weight_confidence":0}]`

  const arr = parseList(await callGemini(prompt, apiKey))
  const map = {}
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    const sku = String(item.sku || products[i]?.sku || '')
    if (!sku) continue
    map[sku] = { weight_kg: item.weight_kg ?? '', weight_confidence: item.weight_confidence ?? '' }
  }
  for (const p of products) { if (!map[p.sku]) map[p.sku] = { weight_kg: '', weight_confidence: '' } }
  return map
}

function descExcerpt(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)
}

async function batchCategory(products, apiKey) {
  // products: [{sku, name, description?}]

  // ── Step 1: AI gives 3 targeted search queries per product ────────────────
  // description excerpt gives extra signal for ambiguous names
  const step1Input = products.map((p, i) => {
    const d = descExcerpt(p.description)
    return `Product ${i + 1} (sku:"${p.sku}"): ${p.name || '(empty)'}${d ? `\n  About: ${d}` : ''}`
  }).join('\n')

  const step1Prompt = `You are an e-commerce marketplace category expert for CartUp (Bangladesh, similar to Daraz).

For EACH product, think like a BUYER clicking through the website menu. Give 3 category search phrases:
- "leaf": the most specific sub-category leaf name only (e.g. "trimmers groomers clippers", "uninterrupted power supply", "rechargeable flashlights", "stickers labels", "prayer accessories", "colanders food strainers")
- "branch": the parent department/section (e.g. "mens care shaving grooming", "computer accessories", "work lights", "school office equipment", "muslim wear", "kitchen utensils")
- "alt": one alternative leaf if unsure

CRITICAL RULES:
- Hair Trimmer/Clipper → leaf: "trimmers groomers clippers", NOT "hair accessories"
- USB Rechargeable Lighter → leaf: "lighters", branch: "cigars cigarettes groceries"
- Coin/Button Cell Battery for Watch → leaf: "watch accessories" or "batteries electrical tools"
- Calculator (Citizen, office) → leaf: "calculators", branch: "school office equipment stationery"
- Janamaz/Prayer Mat → leaf: "prayer accessories", branch: "muslim wear fashion"
- PUBG/Mobile Game Controller → leaf: "console accessories other gaming", NOT "playstation"
- Storage Organizer (door/room) → leaf: "space savers storage organisation"
- Sticker/Label (warning/hologram) → leaf: "stickers labels", branch: "school office stationery"
- Water Pump (garden/car wash) → leaf: "hoses pipes fixtures plumbing"
- Rechargeable Battery (12V, UPS) → leaf: "batteries electrical tools diy" NOT automotive

PRODUCTS:
${step1Input}

Return ONLY a JSON array, no markdown:
[{"sku":"...","leaf":"...","branch":"...","alt":"..."}]`

  let queryItems = []
  try {
    const arr1 = parseList(await callGemini(step1Prompt, apiKey))
    queryItems = arr1.map((item, i) => ({
      sku: String(item.sku || products[i]?.sku || ''),
      queries: [item.leaf || '', item.branch || '', item.alt || '', products[i]?.name || ''].filter(Boolean),
    }))
  } catch (e) {
    if (STOP.test(e.message)) throw e
    queryItems = products.map(p => ({ sku: p.sku, queries: [p.name] }))
  }

  // ── Step 2: Local weighted token scoring → top 25 candidates per product ──
  const candidates = topCandidates(queryItems)

  // ── Step 3: AI picks best match from 25 candidates ────────────────────────
  const step2Input = products.map((p, i) => {
    const pool = candidates[p.sku] || []
    return `Product ${i + 1} (sku:"${p.sku}"): ${p.name}\nCandidates:\n${pool.map(c => `  ${c.id} | ${c.path}`).join('\n')}`
  }).join('\n\n')

  const step2Prompt = `For EACH product below, pick the SINGLE most specific and accurate category from its candidate list. Choose the deepest/most specific match. If none fits well, pick the closest.

${step2Input}

Return ONLY a JSON array, no markdown:
[{"sku":"...","category_id":"...","category_path":"..."}]`

  const map = {}
  {
    const arr2 = parseList(await callGemini(step2Prompt, apiKey))
    for (let i = 0; i < arr2.length; i++) {
      const item = arr2[i]
      const sku = String(item.sku || products[i]?.sku || '')
      if (!sku) continue
      const catId = String(item.category_id || '')
      const validCat = ALL_CATS.find(c => c.id === catId)
      map[sku] = {
        category_id:    validCat ? catId : '',
        category_path:  validCat ? validCat.path : '',
        category_error: validCat ? '' : (catId ? `Unknown ID: ${catId}` : 'No match'),
      }
    }
    for (const p of products) {
      if (!map[p.sku]) map[p.sku] = { category_id: '', category_path: '', category_error: 'Missing from response' }
    }
  }

  // ── Step 4: Verify picks — catch wrong matches before they reach output ───
  const picked = products.filter(p => map[p.sku]?.category_id)
  if (picked.length) {
    const verifyInput = picked.map((p, i) =>
      `Item ${i + 1} (sku:"${p.sku}"): Product: "${p.name}" → Assigned: "${map[p.sku].category_path}"`
    ).join('\n')
    const verifyPrompt = `You are a strict category auditor. For EACH item, does the assigned category genuinely fit the product? Answer "yes" or "no". Say "no" ONLY if the category is clearly wrong for this product type.

${verifyInput}

Return ONLY a JSON array, no markdown:
[{"sku":"...","ok":"yes"}]`
    try {
      const arrV = parseList(await callGemini(verifyPrompt, apiKey))
      for (let i = 0; i < arrV.length; i++) {
        const sku = String(arrV[i].sku || picked[i]?.sku || '')
        if (sku && String(arrV[i].ok).toLowerCase() === 'no' && map[sku]) {
          map[sku].category_error = `Low confidence — verify manually (suggested: ${map[sku].category_path})`
        }
      }
    } catch (e) { if (STOP.test(e.message)) throw e /* else: verify failed — keep picks as-is */ }
  }

  return map
}

async function batchHighlights(products, apiKey) {
  // products: [{sku, cleanedName, description}]
  const inputBlock = products.map((p, i) =>
    `Product ${i + 1} (sku:"${p.sku}"):\nName: ${p.cleanedName || '(empty)'}\nDescription: ${p.description || '(empty)'}`
  ).join('\n\n')

  const prompt = `You are a product data governance assistant. For EACH product:
Recreate highlights as clean <ul><li> HTML bullet points.
STRICT RULES:
- Use ONLY information present in the given Name and Description — nothing else.
- DO NOT add ANY AI-generated extra information, marketing phrases, invented specs, or assumptions.
- DO NOT remove ANY specification, feature, measurement, or detail — every piece of source information must appear in the output.
- Fix ALL spelling and grammar mistakes — ZERO TOLERANCE, every error must be corrected (brand names and model codes stay unchanged).
- Fix formatting and HTML structure.
- Highlights must NEVER contain an <img> tag — if the source has an image, drop it entirely.

PRODUCTS:
${inputBlock}

Return ONLY a JSON array, no markdown:
[{"sku":"...","highlights":"..."}]`

  const arr = parseList(await callGemini(prompt, apiKey))
  const map = {}
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    const sku = String(item.sku || products[i]?.sku || '')
    if (!sku || !item.highlights) continue
    map[sku] = stripImagesFromHighlights(applyReplacements(item.highlights))
  }
  return map
}

async function batchDescription(products, apiKey) {
  // products: [{sku, cleanedName, fixedHighlights}]
  const inputBlock = products.map((p, i) =>
    `Product ${i + 1} (sku:"${p.sku}"):\nName: ${p.cleanedName || '(empty)'}\nHighlights: ${p.fixedHighlights || '(empty)'}`
  ).join('\n\n')

  const prompt = `You are a product data governance assistant. For EACH product:
Recreate description as clean <p> HTML paragraph(s).
STRICT RULES:
- Use ONLY information present in the given Name and Highlights — nothing else.
- DO NOT add ANY AI-generated extra information, marketing phrases, invented specs, or assumptions.
- DO NOT remove ANY specification, feature, measurement, or detail — every piece of source information must appear in the output.
- Fix ALL spelling and grammar mistakes — ZERO TOLERANCE, every error must be corrected (brand names and model codes stay unchanged).
- Fix formatting and HTML structure.
- If the source contains <img> tag(s), keep ALL of them but move them all to the very end, AFTER the last closing </p> tag. Never place an image inside or between paragraphs.

PRODUCTS:
${inputBlock}

Return ONLY a JSON array, no markdown:
[{"sku":"...","description":"..."}]`

  const arr = parseList(await callGemini(prompt, apiKey))
  const map = {}
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    const sku = String(item.sku || products[i]?.sku || '')
    if (!sku || !item.description) continue
    map[sku] = fixDescriptionImages(applyReplacements(item.description))
  }
  return map
}

// ── Combined pass: when BOTH Highlights and Description are enabled they are
// generated together in ONE call so the two fields stay consistent with each
// other, instead of Description being rebuilt from an already-rewritten
// Highlights (which could silently drop info from the original description).
async function batchHighlightsAndDescription(products, apiKey) {
  // products: [{sku, cleanedName, description, highlights}] — both ORIGINAL fields
  const inputBlock = products.map((p, i) =>
    `Product ${i + 1} (sku:"${p.sku}"):\nName: ${p.cleanedName || '(empty)'}\nHighlights: ${p.highlights || '(empty)'}\nDescription: ${p.description || '(empty)'}`
  ).join('\n\n')

  const prompt = `You are a product data governance assistant. For EACH product, recreate BOTH fields TOGETHER so they stay consistent with each other and don't contradict or duplicate:
1. highlights: clean <ul><li> HTML bullet points.
2. description: clean <p> HTML paragraph(s).
STRICT RULES (apply to both):
- Use ONLY information present in the given Name, Highlights, and Description — nothing else.
- DO NOT add ANY AI-generated extra information, marketing phrases, invented specs, or assumptions.
- DO NOT remove ANY specification, feature, measurement, or detail found in either source field — every piece of source information must appear in at least one of the two outputs.
- Fix ALL spelling and grammar mistakes — ZERO TOLERANCE, every error must be corrected (brand names and model codes stay unchanged).
${IMAGE_RULE_PROMPT}
- Remove: non-Latin characters, hashtags, obvious boilerplate ("click add to cart", "contact us" etc).

PRODUCTS:
${inputBlock}

Return ONLY a JSON array, no markdown:
[{"sku":"...","highlights":"...","description":"..."}]`

  const arr = parseList(await callGemini(prompt, apiKey))
  const map = {}
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    const sku = String(item.sku || products[i]?.sku || '')
    if (!sku || (!item.highlights && !item.description)) continue
    map[sku] = enforceImageRules(applyReplacements(item.highlights || ''), applyReplacements(item.description || ''))
  }
  return map
}

// ── Run a single pass with batching + checkpoint + pause ──────────────────────
// A batch the AI couldn't answer readably keeps the product's original values
// (never blank) and gets a note in the Report; an AI limit stops the run like
// a pause — progress saved, Resume continues from that batch.
async function runPass(passNum, totalPasses, label, checkKey, products, batchFn, alreadyDone, file, checks, cpState, total, signal, onProgress, fallback, notes) {
  const pending = products.filter(p => !alreadyDone.has(p.sku))
  const results = {}
  const batches = []
  const batchSize = getGovBatchSize()
  for (let i = 0; i < pending.length; i += batchSize) batches.push(pending.slice(i, i + batchSize))

  let done = products.length - pending.length
  // checkpoint key must match what processGovernanceFile reads back on resume
  const passKey = `${checkKey}Results`

  onProgress({ pass: passNum, totalPasses, label, done, total })

  for (const batch of batches) {
    if (signal?.paused) {
      saveCheckpoint(file, checks, {
        ...cpState,
        passCompleted: passNum - 1,
        [passKey]: { ...(cpState[passKey] || {}), ...results },
        notesResults: notes,
      })
      return { paused: true, results, done, total }
    }

    let batchResult
    try {
      batchResult = await batchFn(batch)
    } catch (e) {
      const message = e.message || 'AI error'
      if (STOP.test(message)) {
        saveCheckpoint(file, checks, { ...cpState, passCompleted: passNum - 1, [passKey]: { ...(cpState[passKey] || {}), ...results }, notesResults: notes })
        return { paused: true, stopped: message, results, done, total }
      }
      batchResult = {}
      for (const p of batch) {
        batchResult[p.sku] = fallback(p)
        notes[p.sku] = [...(notes[p.sku] || []), `${label}: AI answer unreadable — original kept (${message.slice(0, 60)})`]
      }
    }
    // A product the answer left out also keeps its original.
    for (const p of batch) {
      if (!(p.sku in batchResult)) {
        batchResult[p.sku] = fallback(p)
        notes[p.sku] = [...(notes[p.sku] || []), `${label}: missing from the AI answer — original kept`]
      }
    }
    Object.assign(results, batchResult)
    done += batch.length

    onProgress({ pass: passNum, totalPasses, label, done, total })

    saveCheckpoint(file, checks, {
      ...cpState,
      passCompleted: passNum - 1,
      [passKey]: { ...(cpState[passKey] || {}), ...results },
      notesResults: notes,
    })
  }

  return { paused: false, results }
}

// ── Main export ───────────────────────────────────────────────────────────────
function parseProducts(rows) {
  const products = []
  const invalidRows = []
  for (const row of rows) {
    const name = col(row, 'name','name*','*name','product name','*product name','**name (english)','name (english)')
    const sku  = col(row, 'sku id','skuid','sku','seller sku','sellersku','id','product id')
    if (!name && !sku) continue
    if (!name) { invalidRows.push({ SKU: sku, Issue: 'Name missing' }); continue }
    if (!sku)  { invalidRows.push({ SKU: '(no SKU)', Issue: 'SKU ID missing' }); continue }
    products.push({
      sku, name,
      description: col(row,'description','main description','product description','desc'),
      highlights:  col(row,'highlights','*highlights','highlight','key features'),
    })
  }
  return { products, invalidRows }
}

// ── Build an output file from whatever progress exists right now — usable
// mid-run or after a pause, so a long job's work-so-far is never stranded.
export async function buildPartialOutput(file, checks) {
  const cp = loadCheckpoint(file)
  if (!cp) throw new Error('No saved progress found for this file yet')

  const rows = await readSheet(file)
  const { products, invalidRows } = parseProducts(rows)
  if (!products.length) throw new Error('No valid rows found (Name and SKU ID required)')

  const results = {
    name:        cp.nameResults       || {},
    weight:      cp.weightResults     || {},
    category:    cp.categoryResults   || {},
    highlights:  cp.highlightsResults || {},
    description: cp.descriptionResults|| {},
    highlights_description: cp.highlights_descriptionResults || {},
  }
  for (const [sku, v] of Object.entries(results.highlights_description)) {
    results.highlights[sku] = v.highlights
    results.description[sku] = v.description
  }

  return buildOutput(products, checks, results, invalidRows, true, cp.notesResults || {})
}

export async function processGovernanceFile(file, checks, apiKey, onProgress, signal) {
  onProgress({ pass: 0, totalPasses: 0, label: 'Reading file...', done: 0, total: 0 })
  const rows = await readSheet(file)
  if (!rows.length) throw new Error('File is empty')

  const { products, invalidRows } = parseProducts(rows)

  if (!products.length) throw new Error('No valid rows found (Name and SKU ID required)')
  const total = products.length

  // Build ordered pass list based on enabled checks
  // Ordered: name → weight → category → highlights → description
  // When BOTH Highlights and Description are checked, they run as ONE combined
  // pass instead of two sequential ones, so the two fields stay consistent
  // (no risk of description losing info that only survived in the rewritten
  // highlights). Single-toggle Highlights or Description still run alone.
  const bothHD = !!(checks.highlights && checks.description)
  const PASS_ORDER = bothHD
    ? ['name', 'weight', 'category', 'highlights_description']
    : ['name', 'weight', 'category', 'highlights', 'description']
  const enabledPasses = PASS_ORDER.filter(k => k === 'highlights_description' ? bothHD : checks[k])
  const totalPasses = enabledPasses.length

  if (!apiKey) throw new Error('No Gemini key ticked — every Governance check uses AI. Add or tick a key in Profile.')
  // Load checkpoint
  const cp = loadCheckpoint(file) || {}
  const notes = cp.notesResults || {}   // sku → report notes (AI answers that couldn't be used)

  // Results keyed by check name
  const results = {
    name:        cp.nameResults       || {},
    weight:      cp.weightResults     || {},
    category:    cp.categoryResults   || {},
    highlights:  cp.highlightsResults || {},
    description: cp.descriptionResults|| {},
    highlights_description: cp.highlights_descriptionResults || {},
  }
  // unpack any combined-pass results carried over from a resumed checkpoint
  const syncCombined = () => {
    for (const [sku, v] of Object.entries(results.highlights_description)) {
      results.highlights[sku] = v.highlights
      results.description[sku] = v.description
    }
  }
  syncCombined()

  let passNum = 0

  for (const checkKey of enabledPasses) {
    passNum++
    // Done when every product has its result (checks may have been switched since the pause).
    const alreadyDone = new Set(Object.keys(results[checkKey]))
    if (products.every(p => alreadyDone.has(p.sku))) continue
    const label = {
      name:'Name', weight:'Weight', category:'Category',
      highlights:'Highlights', description:'Description',
      highlights_description:'Highlights + Description',
    }[checkKey]

    // Build input list for this pass
    let passProducts
    if (checkKey === 'highlights') {
      passProducts = products.map(p => ({
        sku: p.sku,
        cleanedName: results.name[p.sku] || p.name,
        description: p.description,
      }))
    } else if (checkKey === 'description') {
      passProducts = products.map(p => ({
        sku: p.sku,
        cleanedName:    results.name[p.sku] || p.name,
        fixedHighlights: results.highlights[p.sku] || p.highlights,
      }))
    } else if (checkKey === 'highlights_description') {
      passProducts = products.map(p => ({
        sku: p.sku,
        cleanedName: results.name[p.sku] || p.name,
        description: p.description,
        highlights: p.highlights,
      }))
    } else if (checkKey === 'category') {
      passProducts = products.map(p => ({
        sku: p.sku,
        name: results.name[p.sku] || p.name,
        description: p.description,
      }))
    } else {
      passProducts = products.map(p => ({ sku: p.sku, name: results.name[p.sku] || p.name }))
    }

    const batchFn = {
      name:        batch => batchName(batch, apiKey),
      weight:      batch => batchWeight(batch, apiKey),
      category:    batch => batchCategory(batch, apiKey),
      highlights:  batch => batchHighlights(batch, apiKey),
      description: batch => batchDescription(batch, apiKey),
      highlights_description: batch => batchHighlightsAndDescription(batch, apiKey),
    }[checkKey]

    const cpState = {
      total,
      passCompleted: passNum - 1,
      nameResults:        results.name,
      weightResults:      results.weight,
      categoryResults:    results.category,
      highlightsResults:  results.highlights,
      descriptionResults: results.description,
      highlights_descriptionResults: results.highlights_description,
    }

    const original = Object.fromEntries(products.map(p => [p.sku, p]))
    const fallback = {
      name:        p => original[p.sku].name,
      weight:      () => ({ weight_kg: '', weight_confidence: '' }),
      category:    () => ({ category_id: '', category_path: '', category_error: 'AI answer unreadable — match by hand' }),
      highlights:  p => original[p.sku].highlights,
      description: p => original[p.sku].description,
      highlights_description: p => ({ highlights: original[p.sku].highlights, description: original[p.sku].description }),
    }[checkKey]

    const res = await runPass(passNum, totalPasses, label, checkKey, passProducts, batchFn, alreadyDone, file, checks, { ...cpState, notesResults: notes }, total, signal, onProgress, fallback, notes)
    Object.assign(results[checkKey], res.results)
    if (checkKey === 'highlights_description') syncCombined()

    if (res.paused) return { paused: true, stopped: res.stopped, done: res.done, total }

    saveCheckpoint(file, checks, {
      total,
      passCompleted: passNum,
      nameResults:        results.name,
      weightResults:      results.weight,
      categoryResults:    results.category,
      highlightsResults:  results.highlights,
      descriptionResults: results.description,
      highlights_descriptionResults: results.highlights_description,
      notesResults: notes,
    })
  }

  // All passes done
  clearCheckpoint()
  onProgress({ pass: totalPasses, totalPasses, label: 'Building output...', done: total, total })

  const noted = Object.keys(notes).length
  return { paused: false, noted, output: buildOutput(products, checks, results, invalidRows, false, notes) }
}

function buildOutput(products, checks, results, invalidRows, partial = false, notes = {}) {
  const cols = ['SKU ID', 'Original Name']
  if (checks.name)        cols.push('Name (Cleaned)')
  if (checks.weight)      cols.push('Weight (kg)', 'Weight Confidence')
  if (checks.highlights)  cols.push('Highlights')
  if (checks.description) cols.push('Description')
  if (checks.category)    cols.push('Category ID', 'Category Path', 'Category Note')
  if (partial) cols.push('Processing Status')
  cols.push('Report')

  const outputRows = products.map(p => {
    const w = results.weight[p.sku] || {}
    const cat = results.category[p.sku] || {}
    const row = { 'SKU ID': p.sku, 'Original Name': p.name, 'Report': (notes[p.sku] || []).join('; ') || 'OK' }
    if (checks.name)        row['Name (Cleaned)']     = results.name[p.sku] || p.name
    if (checks.weight)      { row['Weight (kg)'] = w.weight_kg ?? ''; row['Weight Confidence'] = w.weight_confidence ?? '' }
    // Not processed yet (partial output) → the original, never an empty cell.
    if (checks.highlights)  row['Highlights']         = results.highlights[p.sku] || p.highlights || ''
    if (checks.description) row['Description']        = results.description[p.sku] || p.description || ''
    if (checks.category) {
      row['Category ID']   = cat.category_id || ''
      row['Category Path'] = cat.category_path || ''
      row['Category Note'] = cat.category_error || 'Matched'
    }
    if (partial) {
      const pending = []
      if (checks.name        && !(p.sku in results.name))        pending.push('Name')
      if (checks.weight      && !(p.sku in results.weight))      pending.push('Weight')
      if (checks.category    && !(p.sku in results.category))    pending.push('Category')
      if (checks.highlights  && !(p.sku in results.highlights))  pending.push('Highlights')
      if (checks.description && !(p.sku in results.description)) pending.push('Description')
      row['Processing Status'] = pending.length ? `Pending: ${pending.join(', ')}` : 'Done'
    }
    return row
  })

  const wb = XLSX.utils.book_new()
  const wsData = [cols, ...outputRows.map(r => cols.map(c => r[c] ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = cols.map(c =>
    c.includes('Name') || c.includes('Path') || c.includes('Highlights') || c.includes('Description') ? { wch: 60 }
    : c === 'SKU ID' ? { wch: 24 } : { wch: 18 }
  )
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }
  XLSX.utils.book_append_sheet(wb, ws, 'governance')

  if (invalidRows.length) {
    const invCols = ['SKU', 'Issue']
    const wsInv = XLSX.utils.aoa_to_sheet([invCols, ...invalidRows.map(r => invCols.map(c => r[c] ?? ''))])
    XLSX.utils.book_append_sheet(wb, wsInv, 'invalid')
  }

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}
