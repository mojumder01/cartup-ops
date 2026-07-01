import * as XLSX from 'xlsx'
import MAPPINGS from './mappings.json'
import { applyReplacements } from './wordReplacements'

const { cartup_map } = MAPPINGS
const GEMINI_MODEL = 'gemini-3.1-flash-lite'
const DELAY_MS = 2000
const MAX_RETRIES = 3

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

function getCartupCategories() {
  return Object.entries(cartup_map).map(([id, v]) => ({ id, path: v.path }))
}

const STOP_WORDS = new Set([
  'the','and','for','with','from','this','that','are','was','has',
  'not','but','can','all','new','one','its','our','use','any','may',
  'dry','wet','hot','cold','cell','smart','mini','plus','pro','max',
  'set','kit','box','bag','top','big','fit','air','oil','gel','pad',
])

function buildCategoryPool(names, cartupCategories) {
  const allWords = new Set()
  for (const name of names) {
    name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w)).forEach(w => allWords.add(w))
  }
  let filtered = cartupCategories.filter(c => [...allWords].some(w => c.path.toLowerCase().includes(w)))
  if (filtered.length < 10) {
    const shorter = [...allWords].filter(w => w.length > 2 && !STOP_WORDS.has(w))
    filtered = cartupCategories.filter(c => shorter.some(w => c.path.toLowerCase().includes(w)))
  }
  return filtered.length >= 5 ? filtered.slice(0, 150) : cartupCategories.slice(0, 250)
}

// One combined AI call per batch handling only enabled checks
async function governanceBatch(products, checks, apiKey) {
  // products: [{sku, name, description, highlights, existingCategory}]
  // checks: {name, weight, highlights, description, category}
  // returns: {sku: {name?, weight_kg?, weight_score?, weight_confidence?, highlights?, description?, category_id?, category_path?, category_error?}}

  const cartupCategories = getCartupCategories()
  const pathToId = {}
  for (const c of cartupCategories) pathToId[c.path.toLowerCase()] = c.id

  let pool = []
  if (checks.category) {
    pool = buildCategoryPool(products.map(p => p.name), cartupCategories)
  }

  const inputBlock = products.map((p, i) => {
    const lines = [`Product ${i + 1} (sku:"${p.sku}"):`]
    lines.push(`Name: ${p.name || '(empty)'}`)
    if (checks.highlights || checks.description) lines.push(`Description: ${p.description || '(empty)'}`)
    if (checks.description) lines.push(`Highlights: ${p.highlights || '(empty)'}`)
    if (checks.category) lines.push(`Current Category: ${p.existingCategory || '(empty)'}`)
    return lines.join('\n')
  }).join('\n\n')

  const tasks = []
  if (checks.name) tasks.push(`name: Fix duplicate words, remove redundant repeated phrases, translate any non-English words to English. KEEP all product information. Return cleaned English name only.`)
  if (checks.weight) tasks.push(`weight_kg: Estimate realistic shipping weight in kg based on the product name (number only, e.g. 0.5).
weight_confidence: Confidence score 0-100 for the weight estimate.`)
  if (checks.highlights) tasks.push(`highlights: Using ONLY information from Name and Description — recreate as clean <ul><li> HTML bullet points. DO NOT add any information not present in the source. DO NOT remove any specification/feature/information. Fix formatting only.`)
  if (checks.description) tasks.push(`description: Using ONLY information from Name and Highlights — recreate as clean <p> HTML paragraph(s). DO NOT add any information not present in the source. DO NOT remove any specification/feature/information. Fix formatting only.`)
  if (checks.category) tasks.push(`category_id: Best matching category ID from the list below.
category_path: Full path of the matched category.`)

  const catSection = checks.category
    ? `\nCATEGORIES (ID|Path):\n${pool.map(c => `${c.id}|${c.path}`).join('\n')}`
    : ''

  const prompt = `You are a product data governance assistant. For EACH product below, perform ONLY the following tasks:
${tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}

PRODUCTS:
${inputBlock}
${catSection}

Return ONLY a JSON array, no markdown:
[{"sku":"...",${checks.name ? '"name":"...",' : ''}${checks.weight ? '"weight_kg":0.0,"weight_confidence":0,' : ''}${checks.highlights ? '"highlights":"...",' : ''}${checks.description ? '"description":"...",' : ''}${checks.category ? '"category_id":"...","category_path":"...",' : ''}}]`

  try {
    const result = await callGemini(prompt, apiKey)
    const clean = result.replace(/```json|```/g, '').trim()
    const arrMatch = clean.match(/\[[\s\S]*\]/)
    if (!arrMatch) throw new Error(`No JSON array in response`)
    const parsed = JSON.parse(arrMatch[0])
    const map = {}

    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i]
      const sku = String(item.sku || products[i]?.sku || '')
      if (!sku) continue

      const entry = {}
      if (checks.name) entry.name = applyReplacements(item.name || products[i]?.name || '')
      if (checks.weight) {
        entry.weight_kg = item.weight_kg ?? ''
        entry.weight_confidence = item.weight_confidence ?? ''
      }
      if (checks.highlights) entry.highlights = applyReplacements(item.highlights || '')
      if (checks.description) entry.description = applyReplacements(item.description || '')
      if (checks.category) {
        let catId = String(item.category_id || '')
        const catPath = item.category_path || ''
        if (!catId && catPath) catId = pathToId[catPath.toLowerCase()] || ''
        const validCat = pool.find(c => c.id === catId)
        entry.category_id    = validCat ? catId : ''
        entry.category_path  = validCat ? validCat.path : ''
        entry.category_error = validCat ? '' : (catId ? `Unknown ID: ${catId}` : 'No category returned')
      }
      map[sku] = entry
    }

    // Fill missing
    for (const p of products) {
      if (!map[p.sku]) {
        const entry = {}
        if (checks.name)        entry.name = p.name
        if (checks.weight)      { entry.weight_kg = ''; entry.weight_confidence = '' }
        if (checks.highlights)  entry.highlights = p.highlights || ''
        if (checks.description) entry.description = p.description || ''
        if (checks.category)    { entry.category_id = ''; entry.category_path = ''; entry.category_error = 'Missing from AI response' }
        map[p.sku] = entry
      }
    }
    return map
  } catch (e) {
    const errMsg = e.message
    const map = {}
    for (const p of products) {
      const entry = { _error: errMsg }
      if (checks.name)        entry.name = p.name
      if (checks.weight)      { entry.weight_kg = ''; entry.weight_confidence = '' }
      if (checks.highlights)  entry.highlights = p.highlights || ''
      if (checks.description) entry.description = p.description || ''
      if (checks.category)    { entry.category_id = ''; entry.category_path = ''; entry.category_error = errMsg }
      map[p.sku] = entry
    }
    return map
  }
}

export async function processGovernanceFile(file, checks, apiKey, onProgress) {
  onProgress('Reading file...')
  const rows = await readSheet(file)
  if (!rows.length) throw new Error('File is empty')

  // Parse rows
  const products = []
  const invalidRows = []
  for (const row of rows) {
    const name = col(row, 'name', 'name*', '*name', 'product name', '*product name', '**name (english)', 'name (english)')
    const sku  = col(row, 'sku id', 'skuid', 'sku', 'seller sku', 'sellersku', 'id', 'product id')
    if (!name && !sku) continue
    if (!name) { invalidRows.push({ SKU: sku, Issue: 'Name missing' }); continue }
    if (!sku)  { invalidRows.push({ SKU: sku || '(no SKU)', Issue: 'SKU ID missing' }); continue }

    products.push({
      sku,
      name,
      description:      col(row, 'description', 'main description', 'product description', 'desc'),
      highlights:       col(row, 'highlights', '*highlights', 'highlight', 'key features'),
      existingCategory: col(row, 'category', 'category id', 'category path', 'catid'),
    })
  }

  if (!products.length) throw new Error('No valid rows found (Name and SKU ID required)')

  const BATCH_SIZE = 5
  const resultCache = {}

  if (apiKey) {
    const batches = []
    for (let i = 0; i < products.length; i += BATCH_SIZE) batches.push(products.slice(i, i + BATCH_SIZE))

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi]
      onProgress(`Processing ${bi * BATCH_SIZE + 1}–${Math.min((bi + 1) * BATCH_SIZE, products.length)} of ${products.length}...`)
      const results = await governanceBatch(batch, checks, apiKey)
      Object.assign(resultCache, results)
    }
  } else {
    for (const p of products) {
      const entry = {}
      if (checks.name)        entry.name = p.name
      if (checks.weight)      { entry.weight_kg = ''; entry.weight_confidence = '' }
      if (checks.highlights)  entry.highlights = p.highlights || ''
      if (checks.description) entry.description = p.description || ''
      if (checks.category)    { entry.category_id = ''; entry.category_path = ''; entry.category_error = 'No API key' }
      resultCache[p.sku] = entry
    }
  }

  // Build output columns
  onProgress('Building output...')
  const baseCols = ['SKU ID', 'Original Name']
  if (checks.name)        baseCols.push('Name (Cleaned)')
  if (checks.weight)      baseCols.push('Weight (kg)', 'Weight Confidence')
  if (checks.highlights)  baseCols.push('Highlights')
  if (checks.description) baseCols.push('Description')
  if (checks.category)    baseCols.push('Category ID', 'Category Path', 'Category Note')
  baseCols.push('Report')

  const outputRows = products.map(p => {
    const r = resultCache[p.sku] || {}
    const row = {
      'SKU ID':        p.sku,
      'Original Name': p.name,
      'Report':        r._error || 'OK',
    }
    if (checks.name)        row['Name (Cleaned)']     = r.name || p.name
    if (checks.weight)      { row['Weight (kg)'] = r.weight_kg; row['Weight Confidence'] = r.weight_confidence }
    if (checks.highlights)  row['Highlights']         = r.highlights || ''
    if (checks.description) row['Description']        = r.description || ''
    if (checks.category)    {
      row['Category ID']   = r.category_id || ''
      row['Category Path'] = r.category_path || ''
      row['Category Note'] = r.category_error || 'Matched'
    }
    return row
  })

  // Build Excel
  const wb = XLSX.utils.book_new()
  const wsData = [baseCols, ...outputRows.map(r => baseCols.map(c => r[c] ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = baseCols.map(c => {
    if (c.includes('Name') || c.includes('Path') || c.includes('Highlights') || c.includes('Description')) return { wch: 60 }
    if (c === 'SKU ID') return { wch: 24 }
    return { wch: 18 }
  })
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }
  XLSX.utils.book_append_sheet(wb, ws, 'governance')

  if (invalidRows.length) {
    const invCols = ['SKU', 'Issue']
    const wsInv = XLSX.utils.aoa_to_sheet([invCols, ...invalidRows.map(r => invCols.map(c => r[c] ?? ''))])
    XLSX.utils.book_append_sheet(wb, wsInv, 'invalid')
  }

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}
