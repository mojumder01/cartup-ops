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

// ── Editable lists (localStorage) ─────────────────────────────────────────────
const LISTS_KEY = 'qc_lists'
export const DEFAULT_LISTS = {
  competitors: [
    'daraz','pickaboo','ajkerdeal','rokomari','evaly','othoba','bagdoom',
    'alibaba','aliexpress','amazon','flipkart','ebay','shein','temu','walmart','lazada','shopee',
  ],
  restrictedKeywords: [
    'viagra','sex toy','vibrator','dildo','condom','cigarette','vape','e-cigarette',
    'casino','gambling','lottery','antibiotic','paracetamol','napa','tramadol','pistol','airgun','taser',
  ],
}
export function getQcLists() {
  try {
    const raw = localStorage.getItem(LISTS_KEY)
    if (!raw) return { ...DEFAULT_LISTS }
    const saved = JSON.parse(raw)
    return {
      competitors: saved.competitors?.length ? saved.competitors : DEFAULT_LISTS.competitors,
      restrictedKeywords: saved.restrictedKeywords?.length ? saved.restrictedKeywords : DEFAULT_LISTS.restrictedKeywords,
    }
  } catch { return { ...DEFAULT_LISTS } }
}
export function saveQcLists(lists) {
  try { localStorage.setItem(LISTS_KEY, JSON.stringify(lists)) } catch {}
}

// ── Basic (non-AI) checks — instant ───────────────────────────────────────────
export function basicChecks(row, checks, lists) {
  const issues = []
  const name = row['Name (English)'] || ''
  const allText = `${name} ${stripHtml(row['HighlightEn'])} ${stripHtml(row['DescriptionEn'])}`
  const allTextLower = allText.toLowerCase()

  if (checks.name && /[ঀ-৿]/.test(name)) issues.push('Name: contains Bangla characters in English name')
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

  if (checks.competitor && lists) {
    for (const comp of lists.competitors) {
      const re = new RegExp(`\\b${comp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      if (re.test(allText)) { issues.push(`Competitor: '${comp}' found`); break }
    }
    const urlMatch = allText.match(/https?:\/\/[^\s<>"]+|www\.[^\s<>"]+/i)
    if (urlMatch) issues.push(`Competitor: external link found (${urlMatch[0].slice(0, 40)})`)
    const phoneMatch = allText.match(/\b01[3-9]\d{8}\b/)
    if (phoneMatch) issues.push(`Competitor: phone number found (${phoneMatch[0]})`)
  }

  if (checks.restricted && lists) {
    for (const kw of lists.restrictedKeywords) {
      const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      if (re.test(allTextLower)) { issues.push(`Restricted: keyword '${kw}' found`); break }
    }
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

async function checkRestrictedBatch(rows, apiKey, context) {
  const input = rows.map((r, i) =>
    `Product ${i + 1} (id:"${r['ProductId']}"): ${r['Name (English)']} — ${stripHtml(r['DescriptionEn']).slice(0, 200)}`
  ).join('\n')
  const prompt = `You are a marketplace compliance reviewer for a Bangladesh e-commerce site. For EACH product, check if it is PROHIBITED/RESTRICTED:
- Medicine/drugs requiring prescription (vitamins & food supplements are ALLOWED)
- Adult/sex products
- Weapons (kitchen/utility knives are ALLOWED)
- Tobacco, vape, e-cigarettes
- Gambling items, lottery
- Live animals, ivory, endangered species products
If allowed, return empty string. If restricted, short reason.

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
  { key:'restricted',  label:'Restricted Items',fn: checkRestrictedBatch,  prefix:'Restricted' },
]

// ── Checkpoint ────────────────────────────────────────────────────────────────
const QC_CP_KEY = 'qc_checkpoint'
function qcFileKey(file) { return `${file.name}__${file.size}` }

export function loadQcCheckpoint(file) {
  try {
    const raw = localStorage.getItem(QC_CP_KEY)
    if (!raw) return null
    const cp = JSON.parse(raw)
    if (file && cp.fileKey !== qcFileKey(file)) return null
    return cp
  } catch { return null }
}
export function clearQcCheckpoint() { localStorage.removeItem(QC_CP_KEY) }
function saveQcCheckpoint(file, aiIssues, confidence) {
  if (!file) return
  try {
    localStorage.setItem(QC_CP_KEY, JSON.stringify({ fileKey: qcFileKey(file), savedAt: Date.now(), aiIssues, confidence }))
  } catch {}
}

// ── Run enabled AI passes sequentially (with checkpoint + resume) ─────────────
export async function runQcChecks(rows, apiKey, checks, context, onProgress, signal, file) {
  const lists = getQcLists()
  const cp = file ? loadQcCheckpoint(file) : null
  const aiIssues = cp?.aiIssues || {}       // {passKey: {pid: issueString ('' = checked, clean)}}
  const confidence = cp?.confidence || {}

  const buildResult = () => {
    const issuesByProduct = {}
    for (const r of rows) issuesByProduct[r['ProductId']] = basicChecks(r, checks, lists)
    for (const pass of QC_PASS_DEFS) {
      if (!checks[pass.key]) continue
      const done = aiIssues[pass.key] || {}
      for (const r of rows) {
        const issue = done[r['ProductId']]
        if (issue) issuesByProduct[r['ProductId']].push(`${pass.prefix}: ${issue.replace(new RegExp(`^${pass.prefix}:?\\s*`, 'i'), '')}`)
      }
    }
    return issuesByProduct
  }

  const passes = QC_PASS_DEFS.filter(p => checks[p.key])
  const totalPasses = passes.length
  const total = rows.length

  for (let p = 0; p < passes.length; p++) {
    const pass = passes[p]
    const done = aiIssues[pass.key] || (aiIssues[pass.key] = {})
    const pending = rows.filter(r => !(r['ProductId'] in done))
    let doneCount = total - pending.length
    onProgress({ pass: p + 1, totalPasses, label: pass.label, done: doneCount, total })

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      if (signal?.paused) {
        saveQcCheckpoint(file, aiIssues, confidence)
        return { paused: true, issuesByProduct: buildResult(), confidence }
      }
      const batch = pending.slice(i, i + BATCH_SIZE)
      try {
        const map = await pass.fn(batch, apiKey, context)
        for (const r of batch) {
          const pid = r['ProductId']
          done[pid] = map[pid] || ''
          if (map[pid + '__conf'] !== undefined) confidence[pid] = map[pid + '__conf']
        }
        saveQcCheckpoint(file, aiIssues, confidence)
      } catch {
        // batch failed — skip, don't block the pipeline (will retry on resume)
      }
      doneCount += batch.length
      onProgress({ pass: p + 1, totalPasses, label: pass.label, done: doneCount, total })
    }
  }

  clearQcCheckpoint()
  return { paused: false, issuesByProduct: buildResult(), confidence }
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
