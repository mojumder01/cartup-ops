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
    // shape: { fileKey, checks, passCompleted, pass1:{sku→entry}, pass2:{sku→hl}, pass3:{sku→desc}, total }
  } catch { return null }
}

export function clearCheckpoint() { localStorage.removeItem(CHECKPOINT_KEY) }

function saveCheckpoint(file, checks, state) {
  try {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({ fileKey: fileKey(file), checks, savedAt: Date.now(), ...state }))
  } catch {}
}

// ── Category helpers ──────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  'the','and','for','with','from','this','that','are','was','has',
  'not','but','can','all','new','one','its','our','use','any','may',
  'dry','wet','hot','cold','cell','smart','mini','plus','pro','max',
  'set','kit','box','bag','top','big','fit','air','oil','gel','pad',
])

function getCartupCategories() {
  return Object.entries(cartup_map).map(([id, v]) => ({ id, path: v.path }))
}

function buildCategoryPool(names, cats) {
  const allWords = new Set()
  for (const n of names) {
    n.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w)).forEach(w => allWords.add(w))
  }
  let filtered = cats.filter(c => [...allWords].some(w => c.path.toLowerCase().includes(w)))
  if (filtered.length < 10) {
    const shorter = [...allWords].filter(w => w.length > 2 && !STOP_WORDS.has(w))
    filtered = cats.filter(c => shorter.some(w => c.path.toLowerCase().includes(w)))
  }
  return filtered.length >= 5 ? filtered.slice(0, 150) : cats.slice(0, 250)
}

// ── Pass 1: Name + Weight + Category ─────────────────────────────────────────
async function pass1Batch(products, checks, apiKey) {
  // products: [{sku, name, existingCategory}]
  const cats = getCartupCategories()
  const pathToId = {}
  for (const c of cats) pathToId[c.path.toLowerCase()] = c.id
  const pool = checks.category ? buildCategoryPool(products.map(p => p.name), cats) : []

  const tasks = []
  if (checks.name)     tasks.push(`name: Remove duplicate/repeated words, translate any non-English to English. Keep ALL product info. Return cleaned English name only.`)
  if (checks.weight)   tasks.push(`weight_kg: Realistic shipping weight in kg (number only e.g. 0.5).\nweight_confidence: Confidence 0-100.`)
  if (checks.category) tasks.push(`category_id: Best matching ID from category list.\ncategory_path: Full path of matched category.`)

  const inputBlock = products.map((p, i) =>
    `Product ${i + 1} (sku:"${p.sku}"):\nName: ${p.name || '(empty)'}`
  ).join('\n\n')

  const catSection = checks.category ? `\nCATEGORIES (ID|Path):\n${pool.map(c => `${c.id}|${c.path}`).join('\n')}` : ''

  const fieldTemplate = [
    '"sku":"..."',
    checks.name     && '"name":"..."',
    checks.weight   && '"weight_kg":0.0,"weight_confidence":0',
    checks.category && '"category_id":"...","category_path":"..."',
  ].filter(Boolean).join(',')

  const prompt = `You are a product data governance assistant. For EACH product perform ONLY:
${tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}

PRODUCTS:
${inputBlock}
${catSection}

Return ONLY a JSON array, no markdown:
[{${fieldTemplate}}]`

  try {
    const raw = await callGemini(prompt, apiKey)
    const clean = raw.replace(/```json|```/g, '').trim()
    const arr = JSON.parse(clean.match(/\[[\s\S]*\]/)[0])
    const map = {}
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      const sku = String(item.sku || products[i]?.sku || '')
      if (!sku) continue
      const entry = {}
      if (checks.name)     entry.name = applyReplacements(item.name || products[i]?.name || '')
      if (checks.weight)   { entry.weight_kg = item.weight_kg ?? ''; entry.weight_confidence = item.weight_confidence ?? '' }
      if (checks.category) {
        let catId = String(item.category_id || '')
        const catPath = item.category_path || ''
        if (!catId && catPath) catId = pathToId[catPath.toLowerCase()] || ''
        const validCat = pool.find(c => c.id === catId)
        entry.category_id    = validCat ? catId : ''
        entry.category_path  = validCat ? validCat.path : ''
        entry.category_error = validCat ? '' : (catId ? `Unknown: ${catId}` : 'No category returned')
      }
      map[sku] = entry
    }
    for (const p of products) {
      if (!map[p.sku]) {
        const e = {}
        if (checks.name)     e.name = p.name
        if (checks.weight)   { e.weight_kg = ''; e.weight_confidence = '' }
        if (checks.category) { e.category_id = ''; e.category_path = ''; e.category_error = 'Missing from response' }
        map[p.sku] = e
      }
    }
    return map
  } catch (err) {
    const map = {}
    for (const p of products) {
      const e = { _error: err.message }
      if (checks.name)     e.name = p.name
      if (checks.weight)   { e.weight_kg = ''; e.weight_confidence = '' }
      if (checks.category) { e.category_id = ''; e.category_path = ''; e.category_error = err.message }
      map[p.sku] = e
    }
    return map
  }
}

// ── Pass 2: Highlights (uses cleaned name + original description) ─────────────
async function pass2Batch(products, apiKey) {
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
    for (const p of products) {
      if (!map[p.sku]) map[p.sku] = ''
    }
    return map
  } catch {
    return Object.fromEntries(products.map(p => [p.sku, '']))
  }
}

// ── Pass 3: Description (uses cleaned name + fixed highlights) ────────────────
async function pass3Batch(products, apiKey) {
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
    for (const p of products) {
      if (!map[p.sku]) map[p.sku] = ''
    }
    return map
  } catch {
    return Object.fromEntries(products.map(p => [p.sku, '']))
  }
}

// ── Run a pass with batching + checkpoint + pause support ─────────────────────
async function runPass(passNum, totalPasses, label, products, batchFn, alreadyDone, file, checks, cpState, total, signal, onProgress) {
  const pending = products.filter(p => !alreadyDone.has(p.sku))
  const results = {}
  const batches = []
  for (let i = 0; i < pending.length; i += BATCH_SIZE) batches.push(pending.slice(i, i + BATCH_SIZE))

  let done = products.length - pending.length

  for (const batch of batches) {
    if (signal?.paused) {
      saveCheckpoint(file, checks, { ...cpState, passCompleted: passNum - 1 })
      return { paused: true, results, done, total }
    }

    onProgress({
      pass: passNum, totalPasses, label,
      done: done + (products.length - pending.length),
      total,
    })

    const batchResult = await batchFn(batch)
    Object.assign(results, batchResult)
    done += batch.length

    saveCheckpoint(file, checks, { ...cpState, passCompleted: passNum - 1, [`pass${passNum}Results`]: { ...cpState[`pass${passNum}Results`], ...results } })
  }

  return { paused: false, results }
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function processGovernanceFile(file, checks, apiKey, onProgress, signal) {
  onProgress({ pass:0, totalPasses:0, label:'Reading file...', done:0, total:0 })
  const rows = await readSheet(file)
  if (!rows.length) throw new Error('File is empty')

  // Parse
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
      description:      col(row,'description','main description','product description','desc'),
      highlights:       col(row,'highlights','*highlights','highlight','key features'),
      existingCategory: col(row,'category','category id','category path','catid'),
    })
  }

  if (!products.length) throw new Error('No valid rows found (Name and SKU ID required)')
  const total = products.length

  // Determine how many passes are needed
  const needPass1 = checks.name || checks.weight || checks.category
  const needPass2 = checks.highlights
  const needPass3 = checks.description
  const totalPasses = [needPass1, needPass2, needPass3].filter(Boolean).length

  // Load checkpoint
  const cp = loadCheckpoint(file) || {}
  const passCompleted = cp.passCompleted || 0
  let pass1Results = cp.pass1Results || {}
  let pass2Results = cp.pass2Results || {}
  let pass3Results = cp.pass3Results || {}

  let passNum = 0

  // ── Pass 1: Name / Weight / Category ─────────────────────────────────────
  if (needPass1) {
    passNum++
    if (passCompleted < 1) {
      const done1 = new Set(Object.keys(pass1Results))
      const res = await runPass(
        passNum, totalPasses, 'Name / Weight / Category',
        products,
        batch => pass1Batch(batch, checks, apiKey),
        done1, file, checks,
        { total, pass1Results, pass2Results, pass3Results },
        total, signal, onProgress,
      )
      Object.assign(pass1Results, res.results)
      if (res.paused) return { paused: true, done: res.done, total }
      saveCheckpoint(file, checks, { total, passCompleted: 1, pass1Results, pass2Results, pass3Results })
    }
  }

  // ── Pass 2: Highlights ────────────────────────────────────────────────────
  if (needPass2) {
    passNum++
    if (passCompleted < 2) {
      const done2 = new Set(Object.keys(pass2Results))
      const pass2Products = products.map(p => ({
        sku: p.sku,
        cleanedName:  (checks.name ? pass1Results[p.sku]?.name : null) || p.name,
        description:  p.description,
      }))
      const res = await runPass(
        passNum, totalPasses, 'Highlights',
        pass2Products,
        batch => pass2Batch(batch, apiKey),
        done2, file, checks,
        { total, passCompleted: 1, pass1Results, pass2Results, pass3Results },
        total, signal, onProgress,
      )
      Object.assign(pass2Results, res.results)
      if (res.paused) return { paused: true, done: res.done, total }
      saveCheckpoint(file, checks, { total, passCompleted: 2, pass1Results, pass2Results, pass3Results })
    }
  }

  // ── Pass 3: Description ───────────────────────────────────────────────────
  if (needPass3) {
    passNum++
    if (passCompleted < 3) {
      const done3 = new Set(Object.keys(pass3Results))
      const pass3Products = products.map(p => ({
        sku: p.sku,
        cleanedName:    (checks.name ? pass1Results[p.sku]?.name : null) || p.name,
        fixedHighlights:(checks.highlights ? pass2Results[p.sku] : null) || p.highlights,
      }))
      const res = await runPass(
        passNum, totalPasses, 'Description',
        pass3Products,
        batch => pass3Batch(batch, apiKey),
        done3, file, checks,
        { total, passCompleted: 2, pass1Results, pass2Results, pass3Results },
        total, signal, onProgress,
      )
      Object.assign(pass3Results, res.results)
      if (res.paused) return { paused: true, done: res.done, total }
    }
  }

  // All passes done
  clearCheckpoint()
  onProgress({ pass: totalPasses, totalPasses, label: 'Building output...', done: total, total })

  return { paused: false, output: buildOutput(products, checks, pass1Results, pass2Results, pass3Results, invalidRows) }
}

function buildOutput(products, checks, pass1, pass2, pass3, invalidRows) {
  const cols = ['SKU ID', 'Original Name']
  if (checks.name)        cols.push('Name (Cleaned)')
  if (checks.weight)      cols.push('Weight (kg)', 'Weight Confidence')
  if (checks.highlights)  cols.push('Highlights')
  if (checks.description) cols.push('Description')
  if (checks.category)    cols.push('Category ID', 'Category Path', 'Category Note')
  cols.push('Report')

  const outputRows = products.map(p => {
    const r1 = pass1[p.sku] || {}
    const row = { 'SKU ID': p.sku, 'Original Name': p.name, 'Report': r1._error || 'OK' }
    if (checks.name)        row['Name (Cleaned)']   = r1.name || p.name
    if (checks.weight)      { row['Weight (kg)'] = r1.weight_kg; row['Weight Confidence'] = r1.weight_confidence }
    if (checks.highlights)  row['Highlights']       = pass2[p.sku] || ''
    if (checks.description) row['Description']      = pass3[p.sku] || ''
    if (checks.category) {
      row['Category ID']   = r1.category_id || ''
      row['Category Path'] = r1.category_path || ''
      row['Category Note'] = r1.category_error || 'Matched'
    }
    return row
  })

  const wb = XLSX.utils.book_new()
  const wsData = [cols, ...outputRows.map(r => cols.map(c => r[c] ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = cols.map(c =>
    c.includes('Name') || c.includes('Path') || c.includes('Highlights') || c.includes('Description') ? { wch:60 }
    : c === 'SKU ID' ? { wch:24 } : { wch:18 }
  )
  ws['!freeze'] = { xSplit:0, ySplit:1 }
  XLSX.utils.book_append_sheet(wb, ws, 'governance')

  if (invalidRows.length) {
    const invCols = ['SKU','Issue']
    const wsInv = XLSX.utils.aoa_to_sheet([invCols, ...invalidRows.map(r => invCols.map(c => r[c] ?? ''))])
    XLSX.utils.book_append_sheet(wb, wsInv, 'invalid')
  }

  return XLSX.write(wb, { bookType:'xlsx', type:'array' })
}
