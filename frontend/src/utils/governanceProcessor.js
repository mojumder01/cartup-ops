import * as XLSX from 'xlsx'
import MAPPINGS from './mappings.json'
import { applyReplacements } from './wordReplacements'

const { cartup_map } = MAPPINGS
const GEMINI_MODEL = 'gemini-3.1-flash-lite'
const DELAY_MS = 2000
const MAX_RETRIES = 3
const BATCH_SIZE = 10
const CHECKPOINT_KEY = 'gov_checkpoint'

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
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
    }
  )
  if (res.status === 429) {
    if (retries > 0) { await sleep(15000); return callGemini(prompt, apiKey, retries - 1) }
    throw new Error('Rate limit — please wait and retry')
  }
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

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
  'can','all','new','one','its','our','use','any','may','accessories','products',
])

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !SKIP_TOKENS.has(t))
}

function scorePath(pathTokens, queryTokens) {
  let score = 0
  for (const q of queryTokens) {
    for (const p of pathTokens) {
      if (p === q) { score += 2; break }
      else if (p.includes(q) || q.includes(p)) { score += 1; break }
    }
  }
  return score
}

function topCandidates(descriptions, n = 15) {
  // descriptions: [{sku, text}] — free-text category descriptions from AI step 1
  // returns {sku → [{id, path}]} top n candidates per product
  const result = {}
  for (const { sku, text } of descriptions) {
    const qTokens = tokenize(text)
    if (!qTokens.length) { result[sku] = ALL_CATS.slice(0, n); continue }
    const scored = ALL_CATS.map(c => ({
      ...c,
      score: scorePath(tokenize(c.path), qTokens),
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
Clean the product name: remove duplicate/repeated words, translate any non-English to English. Keep ALL product info.

PRODUCTS:
${inputBlock}

Return ONLY a JSON array, no markdown:
[{"sku":"...","name":"..."}]`

  try {
    const raw = await callGemini(prompt, apiKey)
    const clean = raw.replace(/```json|```/g, '').trim()
    const arr = JSON.parse(clean.match(/\[[\s\S]*\]/)[0])
    const map = {}
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      const sku = String(item.sku || products[i]?.sku || '')
      if (!sku) continue
      map[sku] = applyReplacements(item.name || products[i]?.name || '')
    }
    for (const p of products) { if (!map[p.sku]) map[p.sku] = p.name }
    return map
  } catch {
    return Object.fromEntries(products.map(p => [p.sku, p.name]))
  }
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

  try {
    const raw = await callGemini(prompt, apiKey)
    const clean = raw.replace(/```json|```/g, '').trim()
    const arr = JSON.parse(clean.match(/\[[\s\S]*\]/)[0])
    const map = {}
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      const sku = String(item.sku || products[i]?.sku || '')
      if (!sku) continue
      map[sku] = { weight_kg: item.weight_kg ?? '', weight_confidence: item.weight_confidence ?? '' }
    }
    for (const p of products) { if (!map[p.sku]) map[p.sku] = { weight_kg: '', weight_confidence: '' } }
    return map
  } catch {
    return Object.fromEntries(products.map(p => [p.sku, { weight_kg: '', weight_confidence: '' }]))
  }
}

async function batchCategory(products, apiKey) {
  // products: [{sku, name}]
  // Step 1: Ask AI to describe the best category in free text
  const step1Input = products.map((p, i) =>
    `Product ${i + 1} (sku:"${p.sku}"):\nName: ${p.name || '(empty)'}`
  ).join('\n\n')

  const step1Prompt = `For EACH product below, write the most specific e-commerce category it belongs to in plain English (e.g. "uninterrupted power supply", "fishing line", "baby hip carrier"). Be specific, not generic.

PRODUCTS:
${step1Input}

Return ONLY a JSON array, no markdown:
[{"sku":"...","category_description":"..."}]`

  let descriptions = []
  try {
    const raw1 = await callGemini(step1Prompt, apiKey)
    const clean1 = raw1.replace(/```json|```/g, '').trim()
    const arr1 = JSON.parse(clean1.match(/\[[\s\S]*\]/)[0])
    descriptions = arr1.map((item, i) => ({
      sku: String(item.sku || products[i]?.sku || ''),
      text: item.category_description || products[i]?.name || '',
    }))
  } catch {
    descriptions = products.map(p => ({ sku: p.sku, text: p.name }))
  }

  // Step 2: Local token-match to get top 15 candidates per product
  const candidates = topCandidates(descriptions)

  // Step 3: Ask AI to pick best from the small candidate list
  const step2Input = products.map((p, i) => {
    const pool = candidates[p.sku] || []
    return `Product ${i + 1} (sku:"${p.sku}"):\nName: ${p.name}\nCandidates (ID|Path):\n${pool.map(c => `${c.id}|${c.path}`).join('\n')}`
  }).join('\n\n')

  const step2Prompt = `For EACH product, pick the single best matching category from its candidate list.

${step2Input}

Return ONLY a JSON array, no markdown:
[{"sku":"...","category_id":"...","category_path":"..."}]`

  try {
    const raw2 = await callGemini(step2Prompt, apiKey)
    const clean2 = raw2.replace(/```json|```/g, '').trim()
    const arr2 = JSON.parse(clean2.match(/\[[\s\S]*\]/)[0])
    const map = {}
    for (let i = 0; i < arr2.length; i++) {
      const item = arr2[i]
      const sku = String(item.sku || products[i]?.sku || '')
      if (!sku) continue
      const catId = String(item.category_id || '')
      const pool = candidates[sku] || []
      const validCat = ALL_CATS.find(c => c.id === catId) || pool.find(c => c.id === catId)
      map[sku] = {
        category_id:    validCat ? catId : '',
        category_path:  validCat ? validCat.path : '',
        category_error: validCat ? '' : (catId ? `Unknown ID: ${catId}` : 'No match'),
      }
    }
    for (const p of products) {
      if (!map[p.sku]) map[p.sku] = { category_id: '', category_path: '', category_error: 'Missing from response' }
    }
    return map
  } catch (err) {
    return Object.fromEntries(products.map(p => [p.sku, { category_id: '', category_path: '', category_error: err.message }]))
  }
}

async function batchHighlights(products, apiKey) {
  // products: [{sku, cleanedName, description}]
  const inputBlock = products.map((p, i) =>
    `Product ${i + 1} (sku:"${p.sku}"):\nName: ${p.cleanedName || '(empty)'}\nDescription: ${p.description || '(empty)'}`
  ).join('\n\n')

  const prompt = `You are a product data governance assistant. For EACH product:
Recreate highlights as clean <ul><li> HTML bullet points.
- Use ONLY information present in Name and Description.
- DO NOT add any information not in the source.
- DO NOT remove any specification, feature, or information.
- Fix formatting only.

PRODUCTS:
${inputBlock}

Return ONLY a JSON array, no markdown:
[{"sku":"...","highlights":"..."}]`

  try {
    const raw = await callGemini(prompt, apiKey)
    const clean = raw.replace(/```json|```/g, '').trim()
    const arr = JSON.parse(clean.match(/\[[\s\S]*\]/)[0])
    const map = {}
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      const sku = String(item.sku || products[i]?.sku || '')
      if (!sku) continue
      map[sku] = applyReplacements(item.highlights || '')
    }
    for (const p of products) { if (!map[p.sku]) map[p.sku] = '' }
    return map
  } catch {
    return Object.fromEntries(products.map(p => [p.sku, '']))
  }
}

async function batchDescription(products, apiKey) {
  // products: [{sku, cleanedName, fixedHighlights}]
  const inputBlock = products.map((p, i) =>
    `Product ${i + 1} (sku:"${p.sku}"):\nName: ${p.cleanedName || '(empty)'}\nHighlights: ${p.fixedHighlights || '(empty)'}`
  ).join('\n\n')

  const prompt = `You are a product data governance assistant. For EACH product:
Recreate description as clean <p> HTML paragraph(s).
- Use ONLY information present in Name and Highlights.
- DO NOT add any information not in the source.
- DO NOT remove any specification, feature, or information.
- Fix formatting only.

PRODUCTS:
${inputBlock}

Return ONLY a JSON array, no markdown:
[{"sku":"...","description":"..."}]`

  try {
    const raw = await callGemini(prompt, apiKey)
    const clean = raw.replace(/```json|```/g, '').trim()
    const arr = JSON.parse(clean.match(/\[[\s\S]*\]/)[0])
    const map = {}
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      const sku = String(item.sku || products[i]?.sku || '')
      if (!sku) continue
      map[sku] = applyReplacements(item.description || '')
    }
    for (const p of products) { if (!map[p.sku]) map[p.sku] = '' }
    return map
  } catch {
    return Object.fromEntries(products.map(p => [p.sku, '']))
  }
}

// ── Run a single pass with batching + checkpoint + pause ──────────────────────
async function runPass(passNum, totalPasses, label, products, batchFn, alreadyDone, file, checks, cpState, total, signal, onProgress) {
  const pending = products.filter(p => !alreadyDone.has(p.sku))
  const results = {}
  const batches = []
  for (let i = 0; i < pending.length; i += BATCH_SIZE) batches.push(pending.slice(i, i + BATCH_SIZE))

  let done = products.length - pending.length

  onProgress({ pass: passNum, totalPasses, label, done, total })

  for (const batch of batches) {
    if (signal?.paused) {
      saveCheckpoint(file, checks, { ...cpState, passCompleted: passNum - 1 })
      return { paused: true, results, done, total }
    }

    const batchResult = await batchFn(batch)
    Object.assign(results, batchResult)
    done += batch.length

    onProgress({ pass: passNum, totalPasses, label, done, total })

    const passKey = `pass${passNum}Results`
    saveCheckpoint(file, checks, {
      ...cpState,
      passCompleted: passNum - 1,
      [passKey]: { ...(cpState[passKey] || {}), ...results },
    })
  }

  return { paused: false, results }
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function processGovernanceFile(file, checks, apiKey, onProgress, signal) {
  onProgress({ pass: 0, totalPasses: 0, label: 'Reading file...', done: 0, total: 0 })
  const rows = await readSheet(file)
  if (!rows.length) throw new Error('File is empty')

  // Parse products
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

  if (!products.length) throw new Error('No valid rows found (Name and SKU ID required)')
  const total = products.length

  // Build ordered pass list based on enabled checks
  // Ordered: name → weight → category → highlights → description
  // highlights uses cleanedName; description uses cleanedName + fixedHighlights
  const PASS_ORDER = ['name', 'weight', 'category', 'highlights', 'description']
  const enabledPasses = PASS_ORDER.filter(k => checks[k])
  const totalPasses = enabledPasses.length

  // Load checkpoint
  const cp = loadCheckpoint(file) || {}
  const passCompleted = cp.passCompleted || 0

  // Results keyed by check name
  const results = {
    name:        cp.nameResults       || {},
    weight:      cp.weightResults     || {},
    category:    cp.categoryResults   || {},
    highlights:  cp.highlightsResults || {},
    description: cp.descriptionResults|| {},
  }

  let passNum = 0

  for (const checkKey of enabledPasses) {
    passNum++
    if (passCompleted >= passNum) continue  // already done

    const alreadyDone = new Set(Object.keys(results[checkKey]))
    const label = { name:'Name', weight:'Weight', category:'Category', highlights:'Highlights', description:'Description' }[checkKey]

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
    } else {
      passProducts = products.map(p => ({ sku: p.sku, name: results.name[p.sku] || p.name }))
    }

    const batchFn = {
      name:        batch => batchName(batch, apiKey),
      weight:      batch => batchWeight(batch, apiKey),
      category:    batch => batchCategory(batch, apiKey),
      highlights:  batch => batchHighlights(batch, apiKey),
      description: batch => batchDescription(batch, apiKey),
    }[checkKey]

    const cpState = {
      total,
      passCompleted: passNum - 1,
      nameResults:        results.name,
      weightResults:      results.weight,
      categoryResults:    results.category,
      highlightsResults:  results.highlights,
      descriptionResults: results.description,
    }

    const res = await runPass(passNum, totalPasses, label, passProducts, batchFn, alreadyDone, file, checks, cpState, total, signal, onProgress)
    Object.assign(results[checkKey], res.results)

    if (res.paused) return { paused: true, done: res.done, total }

    saveCheckpoint(file, checks, {
      total,
      passCompleted: passNum,
      nameResults:        results.name,
      weightResults:      results.weight,
      categoryResults:    results.category,
      highlightsResults:  results.highlights,
      descriptionResults: results.description,
    })
  }

  // All passes done
  clearCheckpoint()
  onProgress({ pass: totalPasses, totalPasses, label: 'Building output...', done: total, total })

  return { paused: false, output: buildOutput(products, checks, results, invalidRows) }
}

function buildOutput(products, checks, results, invalidRows) {
  const cols = ['SKU ID', 'Original Name']
  if (checks.name)        cols.push('Name (Cleaned)')
  if (checks.weight)      cols.push('Weight (kg)', 'Weight Confidence')
  if (checks.highlights)  cols.push('Highlights')
  if (checks.description) cols.push('Description')
  if (checks.category)    cols.push('Category ID', 'Category Path', 'Category Note')
  cols.push('Report')

  const outputRows = products.map(p => {
    const w = results.weight[p.sku] || {}
    const cat = results.category[p.sku] || {}
    const row = { 'SKU ID': p.sku, 'Original Name': p.name, 'Report': 'OK' }
    if (checks.name)        row['Name (Cleaned)']     = results.name[p.sku] || p.name
    if (checks.weight)      { row['Weight (kg)'] = w.weight_kg ?? ''; row['Weight Confidence'] = w.weight_confidence ?? '' }
    if (checks.highlights)  row['Highlights']         = results.highlights[p.sku] || ''
    if (checks.description) row['Description']        = results.description[p.sku] || ''
    if (checks.category) {
      row['Category ID']   = cat.category_id || ''
      row['Category Path'] = cat.category_path || ''
      row['Category Note'] = cat.category_error || 'Matched'
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
