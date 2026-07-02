import * as XLSX from 'xlsx'

const GEMINI_MODEL = 'gemini-3.1-flash-lite'
const DELAY_MS = 2000
const MAX_RETRIES = 3
const BATCH_SIZE = 10

export const QC_COLUMNS = [
  'ProductId','SellerId','ShopName','CategoryId','CategoryPath','Name (English)',
  'Product Image1','HighlightEn','HighlightBn','DescriptionEn','DescriptionBn',
  'Package Weight (kg)','Parent Sku','Price(MRP)',
]
// extra columns parsed for the variant check tab
const EXTRA_COLUMNS = ['VariantName','Variant Image1']

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

function parseJsonArray(raw) {
  const clean = raw.replace(/```json|```/g, '').trim()
  return JSON.parse(clean.match(/\[[\s\S]*\]/)[0])
}

export function readQcFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        resolve(rows.map(r => {
          const o = {}
          for (const c of [...QC_COLUMNS, ...EXTRA_COLUMNS]) o[c] = String(r[c] ?? '').trim()
          return o
        }).filter(r => r['ProductId']))
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

export function uniqueByProductId(rows) {
  const seen = new Set()
  const out = []
  for (const r of rows) {
    if (seen.has(r['ProductId'])) continue
    seen.add(r['ProductId'])
    out.push(r)
  }
  return out
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── Basic (non-AI) checks — instant ───────────────────────────────────────────
export function basicChecks(row, checks) {
  const issues = []
  if (checks.image && !row['Product Image1']) issues.push('Image: missing')
  if (checks.highlights) {
    if (/<img[\s>]/i.test(row['HighlightEn'] || '')) issues.push('Highlights: contains image (not allowed)')
    if (!stripHtml(row['HighlightEn'])) issues.push('Highlights: empty/blank')
  }
  if (checks.description && !stripHtml(row['DescriptionEn'])) issues.push('Description: empty/blank')
  if (checks.weight) {
    const w = parseFloat(row['Package Weight (kg)'])
    if (!row['Package Weight (kg)'] || isNaN(w)) issues.push('Weight: missing/invalid')
    else if (w <= 0) issues.push('Weight: must be > 0')
    else if (w > 100) issues.push(`Weight: unrealistic (${w} kg)`)
  }
  return issues
}

// ── AI check passes ───────────────────────────────────────────────────────────

const SPELLING_RULES = `SPELLING RULES (zero tolerance for REAL mistakes, but):
- Report format exactly: "Spelling mistake: 'wrong' = 'correct'"
- IGNORE plural/singular differences (e/es/s endings), brand names, model numbers, codes, abbreviations, transliterated Bangla words
- IGNORE stylistic choices (colour/color, litre/liter)
- Only flag words that are genuinely misspelled`

const GRAMMAR_RULES = `GRAMMAR RULES (light touch):
- Only flag SERIOUS grammar errors that damage readability or meaning
- IGNORE minor issues: missing articles, comma usage, sentence fragments in bullet lists, capitalization style
- If grammar is understandable, return empty string`

async function checkNameBatch(rows, apiKey, context) {
  const input = rows.map((r, i) => `Product ${i + 1} (id:"${r['ProductId']}"): ${r['Name (English)']}`).join('\n')
  const prompt = `You are a QC reviewer.${context ? ` These products are: ${context}.` : ''} For EACH product name check spelling only.
${SPELLING_RULES}

${input}

Return ONLY a JSON array, no markdown:
[{"id":"...","issue":""}]`
  const arr = parseJsonArray(await callGemini(prompt, apiKey))
  const map = {}
  arr.forEach((it, i) => { map[String(it.id || rows[i]?.['ProductId'])] = (it.issue || '').trim() })
  return map
}

async function checkCategoryBatch(rows, apiKey, context) {
  const input = rows.map((r, i) =>
    `Product ${i + 1} (id:"${r['ProductId']}"):\n Name: ${r['Name (English)']}\n Category: ${r['CategoryPath']}`
  ).join('\n')
  const prompt = `You are a QC reviewer.${context ? ` These products are: ${context}.` : ''} For EACH product, score how well the assigned category matches the product name (confidence 0-100). If confidence < 60, it's a mismatch.

${input}

Return ONLY a JSON array, no markdown:
[{"id":"...","confidence":0,"suggested":""}] — "suggested" only when mismatch (short category description)`
  const arr = parseJsonArray(await callGemini(prompt, apiKey))
  const map = {}
  arr.forEach((it, i) => {
    const id = String(it.id || rows[i]?.['ProductId'])
    const conf = Number(it.confidence ?? 0)
    map[id] = conf < 60
      ? `category mismatch (confidence ${conf}%${it.suggested ? `, suggest: ${it.suggested}` : ''})`
      : ''
    map[id + '__conf'] = conf
  })
  return map
}

async function checkHighlightsBatch(rows, apiKey, context) {
  const input = rows.map((r, i) =>
    `Product ${i + 1} (id:"${r['ProductId']}"): ${stripHtml(r['HighlightEn']).slice(0, 500) || '(empty)'}`
  ).join('\n')
  const prompt = `You are a QC reviewer.${context ? ` These products are: ${context}.` : ''} For EACH product's highlights text, check spelling and serious grammar.
${SPELLING_RULES}
${GRAMMAR_RULES}
If a spelling mistake is found report: "Spelling mistake: 'wrong' = 'correct'". If OK return empty string.

${input}

Return ONLY a JSON array, no markdown:
[{"id":"...","issue":""}]`
  const arr = parseJsonArray(await callGemini(prompt, apiKey))
  const map = {}
  arr.forEach((it, i) => { map[String(it.id || rows[i]?.['ProductId'])] = (it.issue || '').trim() })
  return map
}

async function checkDescriptionBatch(rows, apiKey, context) {
  const input = rows.map((r, i) =>
    `Product ${i + 1} (id:"${r['ProductId']}"): ${stripHtml(r['DescriptionEn']).slice(0, 500) || '(empty)'}`
  ).join('\n')
  const prompt = `You are a QC reviewer.${context ? ` These products are: ${context}.` : ''} For EACH product's description text, check spelling and serious grammar.
${SPELLING_RULES}
${GRAMMAR_RULES}
If a spelling mistake is found report: "Spelling mistake: 'wrong' = 'correct'". If OK return empty string.

${input}

Return ONLY a JSON array, no markdown:
[{"id":"...","issue":""}]`
  const arr = parseJsonArray(await callGemini(prompt, apiKey))
  const map = {}
  arr.forEach((it, i) => { map[String(it.id || rows[i]?.['ProductId'])] = (it.issue || '').trim() })
  return map
}

export const QC_PASS_DEFS = [
  { key:'name',        label:'Name (Spelling)', fn: checkNameBatch,        prefix:'Name' },
  { key:'category',    label:'Category Match',  fn: checkCategoryBatch,    prefix:'Category' },
  { key:'highlights',  label:'Highlights',      fn: checkHighlightsBatch,  prefix:'Highlights' },
  { key:'description', label:'Description',     fn: checkDescriptionBatch, prefix:'Description' },
]

// ── Run enabled AI passes sequentially ────────────────────────────────────────
export async function runQcChecks(rows, apiKey, checks, context, onProgress, signal) {
  const issuesByProduct = {}
  const confidence = {}
  for (const r of rows) issuesByProduct[r['ProductId']] = basicChecks(r, checks)

  const passes = QC_PASS_DEFS.filter(p => checks[p.key])
  const totalPasses = passes.length
  const total = rows.length

  for (let p = 0; p < passes.length; p++) {
    const pass = passes[p]
    let done = 0
    onProgress({ pass: p + 1, totalPasses, label: pass.label, done, total })

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      if (signal?.paused) return { paused: true, issuesByProduct, confidence }
      const batch = rows.slice(i, i + BATCH_SIZE)
      try {
        const map = await pass.fn(batch, apiKey, context)
        for (const r of batch) {
          const pid = r['ProductId']
          const issue = map[pid]
          if (issue) issuesByProduct[pid].push(`${pass.prefix}: ${issue.replace(new RegExp(`^${pass.prefix}:?\\s*`, 'i'), '')}`)
          if (map[pid + '__conf'] !== undefined) confidence[pid] = map[pid + '__conf']
        }
      } catch {
        // batch failed — skip, don't block the pipeline
      }
      done += batch.length
      onProgress({ pass: p + 1, totalPasses, label: pass.label, done, total })
    }
  }

  return { paused: false, issuesByProduct, confidence }
}

// ── Output files (mergedIssues: {pid → [issue strings]}) ─────────────────────
export function buildQcViewFile(rows, mergedIssues) {
  const cols = ['SL', ...QC_COLUMNS, 'Report']
  const data = rows.map((r, i) => {
    const issues = mergedIssues[r['ProductId']] || []
    return cols.map(c =>
      c === 'SL' ? i + 1
      : c === 'Report' ? (issues.length ? issues.join('; ') : 'OK')
      : (r[c] ?? ''))
  })
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([cols, ...data])
  ws['!cols'] = cols.map(c =>
    ['HighlightEn','HighlightBn','DescriptionEn','DescriptionBn','Report'].includes(c) ? { wch:60 }
    : ['Name (English)','CategoryPath','Product Image1'].includes(c) ? { wch:45 }
    : c === 'SL' ? { wch:6 } : { wch:14 }
  )
  XLSX.utils.book_append_sheet(wb, ws, 'unique_qc')
  return XLSX.write(wb, { bookType:'xlsx', type:'array' })
}

export function buildQcPassFile(rows, mergedIssues) {
  const cols = ['Seller ID','Product ID','Approval Status','Product Tags','Reject Reason']
  const data = rows.map(r => {
    const pid = r['ProductId']
    const issues = mergedIssues[pid] || []
    return [r['SellerId'], pid, issues.length ? 2 : 1, '', issues.join('; ')]
  })
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([cols, ...data])
  ws['!cols'] = [{ wch:12 },{ wch:14 },{ wch:14 },{ wch:16 },{ wch:80 }]
  XLSX.utils.book_append_sheet(wb, ws, 'qc_pass')
  return XLSX.write(wb, { bookType:'xlsx', type:'array' })
}
