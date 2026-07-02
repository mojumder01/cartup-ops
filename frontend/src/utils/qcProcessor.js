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
          for (const c of QC_COLUMNS) o[c] = String(r[c] ?? '').trim()
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
export function basicChecks(row) {
  const issues = []
  if (!row['Product Image1']) issues.push('Image: missing')
  if (/<img[\s>]/i.test(row['HighlightEn'] || '')) issues.push('Highlights: contains image (not allowed)')
  if (!stripHtml(row['HighlightEn'])) issues.push('Highlights: empty/blank')
  if (!stripHtml(row['DescriptionEn'])) issues.push('Description: empty/blank')
  const w = parseFloat(row['Package Weight (kg)'])
  if (!row['Package Weight (kg)'] || isNaN(w)) issues.push('Weight: missing/invalid')
  else if (w <= 0) issues.push('Weight: must be > 0')
  else if (w > 100) issues.push(`Weight: unrealistic (${w} kg)`)
  return issues
}

// ── AI check passes (each column checked in its own pass) ─────────────────────

async function checkNameBatch(rows, apiKey) {
  const input = rows.map((r, i) => `Product ${i + 1} (id:"${r['ProductId']}"): ${r['Name (English)']}`).join('\n')
  const prompt = `You are a QC reviewer. For EACH product name, check English spelling errors only (ignore brand names, model numbers, codes like BLZ-DSEI, sizes). If OK return empty string.

${input}

Return ONLY a JSON array, no markdown:
[{"id":"...","issue":""}]  — issue example: "spelling: 'blander' should be 'blender'"`
  const arr = parseJsonArray(await callGemini(prompt, apiKey))
  const map = {}
  arr.forEach((it, i) => { map[String(it.id || rows[i]?.['ProductId'])] = (it.issue || '').trim() })
  return map
}

async function checkCategoryBatch(rows, apiKey) {
  const input = rows.map((r, i) =>
    `Product ${i + 1} (id:"${r['ProductId']}"):\n Name: ${r['Name (English)']}\n Category: ${r['CategoryPath']}`
  ).join('\n')
  const prompt = `You are a QC reviewer. For EACH product, score how well the assigned category matches the product name (confidence 0-100). If confidence < 60, it's a mismatch.

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

async function checkHighlightsBatch(rows, apiKey) {
  const input = rows.map((r, i) =>
    `Product ${i + 1} (id:"${r['ProductId']}"): ${stripHtml(r['HighlightEn']).slice(0, 500) || '(empty)'}`
  ).join('\n')
  const prompt = `You are a QC reviewer. For EACH product's highlights text, check English grammar and spelling errors only (ignore brand names, model codes). If OK return empty string. Keep issue short.

${input}

Return ONLY a JSON array, no markdown:
[{"id":"...","issue":""}]`
  const arr = parseJsonArray(await callGemini(prompt, apiKey))
  const map = {}
  arr.forEach((it, i) => { map[String(it.id || rows[i]?.['ProductId'])] = (it.issue || '').trim() })
  return map
}

async function checkDescriptionBatch(rows, apiKey) {
  const input = rows.map((r, i) =>
    `Product ${i + 1} (id:"${r['ProductId']}"): ${stripHtml(r['DescriptionEn']).slice(0, 500) || '(empty)'}`
  ).join('\n')
  const prompt = `You are a QC reviewer. For EACH product's description text, check English grammar and spelling errors only (ignore brand names, model codes). If OK return empty string. Keep issue short.

${input}

Return ONLY a JSON array, no markdown:
[{"id":"...","issue":""}]`
  const arr = parseJsonArray(await callGemini(prompt, apiKey))
  const map = {}
  arr.forEach((it, i) => { map[String(it.id || rows[i]?.['ProductId'])] = (it.issue || '').trim() })
  return map
}

export const QC_PASSES = [
  { key:'name',        label:'Name (Spelling)',   fn: checkNameBatch,        prefix:'Name' },
  { key:'category',    label:'Category Match',    fn: checkCategoryBatch,    prefix:'Category' },
  { key:'highlights',  label:'Highlights',        fn: checkHighlightsBatch,  prefix:'Highlights' },
  { key:'description', label:'Description',       fn: checkDescriptionBatch, prefix:'Description' },
]

// ── Run all AI passes sequentially ────────────────────────────────────────────
// onProgress({pass, totalPasses, label, done, total})
// signal: {paused: bool}
// returns { paused, issuesByProduct: {pid → [issues]}, confidence: {pid → n} }
export async function runQcChecks(rows, apiKey, onProgress, signal) {
  const issuesByProduct = {}
  const confidence = {}
  for (const r of rows) issuesByProduct[r['ProductId']] = basicChecks(r)

  const totalPasses = QC_PASSES.length
  const total = rows.length

  for (let p = 0; p < QC_PASSES.length; p++) {
    const pass = QC_PASSES[p]
    let done = 0
    onProgress({ pass: p + 1, totalPasses, label: pass.label, done, total })

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      if (signal?.paused) return { paused: true, issuesByProduct, confidence }
      const batch = rows.slice(i, i + BATCH_SIZE)
      try {
        const map = await pass.fn(batch, apiKey)
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

// ── Output files ──────────────────────────────────────────────────────────────
export function buildQcViewFile(rows, issuesByProduct, manualFlags) {
  const cols = [...QC_COLUMNS, 'Report']
  const data = rows.map(r => {
    const pid = r['ProductId']
    const issues = [...(issuesByProduct[pid] || []), ...(manualFlags[pid] || [])]
    return cols.map(c => c === 'Report' ? (issues.length ? issues.join('; ') : 'OK') : (r[c] ?? ''))
  })
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([cols, ...data])
  ws['!cols'] = cols.map(c =>
    ['HighlightEn','HighlightBn','DescriptionEn','DescriptionBn','Report'].includes(c) ? { wch:60 }
    : ['Name (English)','CategoryPath','Product Image1'].includes(c) ? { wch:45 } : { wch:14 }
  )
  XLSX.utils.book_append_sheet(wb, ws, 'unique_qc')
  return XLSX.write(wb, { bookType:'xlsx', type:'array' })
}

export function buildQcPassFile(rows, issuesByProduct, manualFlags) {
  const cols = ['Seller ID','Product ID','Approval Status','Product Tags','Reject Reason']
  const data = rows.map(r => {
    const pid = r['ProductId']
    const issues = [...(issuesByProduct[pid] || []), ...(manualFlags[pid] || [])]
    return [
      r['SellerId'], pid,
      issues.length ? 2 : 1,
      '',
      issues.join('; '),
    ]
  })
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([cols, ...data])
  ws['!cols'] = [{ wch:12 },{ wch:14 },{ wch:14 },{ wch:16 },{ wch:80 }]
  XLSX.utils.book_append_sheet(wb, ws, 'qc_pass')
  return XLSX.write(wb, { bookType:'xlsx', type:'array' })
}
