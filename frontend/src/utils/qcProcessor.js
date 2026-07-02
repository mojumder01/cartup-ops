import * as XLSX from 'xlsx'
import MAPPINGS from './mappings.json'

const { cartup_map } = MAPPINGS
const GEMINI_MODEL = 'gemini-3.1-flash-lite'
const DELAY_MS = 2000
const MAX_RETRIES = 3

// batch size is user-configurable (smaller = better accuracy, more API calls)
export function getQcBatchSize() {
  const v = parseInt(localStorage.getItem('qc_batch_size'), 10)
  return isNaN(v) ? 5 : Math.min(20, Math.max(1, v))
}
export function saveQcBatchSize(v) {
  try { localStorage.setItem('qc_batch_size', String(Math.min(20, Math.max(1, v)))) } catch {}
}

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

const SPELLING_RULES = `SPELLING RULES — LENIENT. Many sellers upload products, so minor issues are FORGIVEN. Only flag CLEAR, OBVIOUS misspellings that look unprofessional:
- Report format exactly: "Spelling mistake: 'wrong' = 'correct'"
- Flag ONLY obvious misspellings of common English words
- FORGIVE: plural/singular slips (e/es/s), minor typos that don't hurt readability, stylistic variants (colour/color, litre/liter)
- IGNORE: brand names, model numbers/codes, SKU codes, abbreviations, transliterated Bangla/local words
EXAMPLES:
- "Blander machine" → FLAG: Spelling mistake: 'Blander' = 'Blender' (obvious, looks bad)
- "Stainles steel" → FLAG: Spelling mistake: 'Stainles' = 'Stainless'
- "2 pcs knifes" → OK (minor plural slip — forgiven)
- "BLZ-DSEI 01 model" → OK (model code)
- "Janamaz prayer mat" → OK (transliterated local word)
- "Xiaomi phone" → OK (brand name)`

const GRAMMAR_RULES = `GRAMMAR RULES — VERY LENIENT (QC only flags, sellers won't be rejected for small slips):
- Flag ONLY grammar so broken that the meaning is unclear or the listing looks unprofessional
- Report format: "Grammar: short description"
- FORGIVE: missing articles, comma issues, bullet fragments, capitalization, minor verb slips
- If a normal buyer can understand it, return empty string
EXAMPLES:
- "It good product buy fast very nice quality cheap" → FLAG: Grammar: broken sentence, unclear
- "This product are very good" → OK (minor slip — understandable)
- "1.6 liter jar" (bullet fragment) → OK`

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

// ── Category matching helpers (same technique as Production/Governance) ──────
const ALL_CATS = Object.entries(cartup_map).map(([id, v]) => ({ id, path: v.path }))
const CAT_SKIP = new Set(['the','and','for','with','from','this','that','other','products','size','color','type','pack','pcs','set','kit'])

function catTokenize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 1 && !CAT_SKIP.has(t))
}

function catScore(path, queryTokens) {
  const segments = path.split('>').map(s => s.trim())
  const leafTokens = catTokenize(segments[segments.length - 1])
  const fullTokens = catTokenize(path)
  let score = 0
  for (const q of queryTokens) {
    if (leafTokens.includes(q)) { score += 6; continue }
    if (leafTokens.some(t => t.includes(q) || q.includes(t))) { score += 3; continue }
    if (fullTokens.includes(q)) { score += 2; continue }
    if (fullTokens.some(t => t.includes(q) || q.includes(t))) { score += 1 }
  }
  return score
}

async function checkCategoryBatch(rows, apiKey, context) {
  // Step 1: AI describes the correct category in plain words (no list bias)
  const input = rows.map((r, i) =>
    `Product ${i + 1} (id:"${r['ProductId']}"): ${r['Name (English)']}`
  ).join('\n')
  const prompt = `You are an e-commerce category expert.${context ? ` These products are: ${context}.` : ''} For EACH product, write the most specific category it belongs to in plain English (e.g. "uninterrupted power supply", "hair trimmers clippers", "prayer accessories muslim wear"). Think like a buyer browsing the site menu.

${input}

Return ONLY a JSON array, no markdown:
[{"id":"...","correct":"..."}]`

  let descs = {}
  try {
    const arr = parseJsonArray(await callGemini(prompt, apiKey))
    arr.forEach((it, i) => { descs[String(it.id || rows[i]?.['ProductId'])] = it.correct || '' })
  } catch {
    for (const r of rows) descs[r['ProductId']] = ''
  }

  // Step 2: local scoring — assigned path vs AI description, against the real 3815-category list
  const map = {}
  for (const r of rows) {
    const pid = r['ProductId']
    const desc = descs[pid] || r['Name (English)']
    const qTokens = [...new Set([...catTokenize(desc), ...catTokenize(r['Name (English)']).slice(0, 6)])]
    const assignedScore = catScore(r['CategoryPath'] || '', catTokenize(desc))

    let best = null
    for (const c of ALL_CATS) {
      const s = catScore(c.path, qTokens)
      if (!best || s > best.score) best = { ...c, score: s }
    }

    const conf = best && best.score > 0 ? Math.min(100, Math.round((assignedScore / Math.max(best.score * 0.5, 1)) * 50)) : 50
    map[pid + '__conf'] = conf

    // assigned category considered OK if it scores reasonably vs the best possible match
    if (best && assignedScore < best.score * 0.35 && best.score >= 6) {
      map[pid] = `category mismatch (confidence ${conf}%) — should be: ${best.path}`
    } else {
      map[pid] = ''
    }
  }
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

async function checkWeightBatch(rows, apiKey, context) {
  const input = rows.map((r, i) =>
    `Product ${i + 1} (id:"${r['ProductId']}"): ${r['Name (English)']} — stated weight: ${r['Package Weight (kg)']} kg`
  ).join('\n')
  const prompt = `You are a QC reviewer.${context ? ` These products are: ${context}.` : ''} For EACH product, check if the stated package weight is REALISTIC for that product type.
- Package weight includes packaging, so slightly higher than product weight is normal
- Only flag if clearly wrong (e.g. blender 0.05 kg, phone case 5 kg)
- If realistic, return empty string. If wrong: "unrealistic weight (X kg stated, expect ~Y kg)"

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
  { key:'weight',      label:'Weight (AI)',     fn: checkWeightBatch,      prefix:'Weight' },
  { key:'highlights',  label:'Highlights',      fn: checkHighlightsBatch,  prefix:'Highlights' },
  { key:'description', label:'Description',     fn: checkDescriptionBatch, prefix:'Description' },
  { key:'restricted',  label:'Restricted Items',fn: checkRestrictedBatch,  prefix:'Restricted' },
]

// ── Spelling/grammar double-check: verify flagged issues to kill false positives ─
async function verifyFlaggedIssues(flagged, apiKey, context) {
  // flagged: [{pid, passKey, issue, name}]
  const kept = new Set(flagged.map((_, i) => i))
  for (let i = 0; i < flagged.length; i += 10) {
    const batch = flagged.slice(i, i + 10)
    const input = batch.map((f, j) =>
      `Item ${j + 1}: Product: "${f.name}" — Flagged issue: ${f.issue}`
    ).join('\n')
    const prompt = `You are a senior QC verifier.${context ? ` These products are: ${context}.` : ''} For EACH flagged spelling/grammar issue below, VERIFY it is a REAL error:
- Answer "yes" if it is genuinely a spelling/grammar mistake
- Answer "no" if the flagged word is actually a brand name, model code, transliterated local word, acceptable variant, or the flag is wrong

${input}

Return ONLY a JSON array, no markdown:
[{"item":1,"real":"yes"}]`
    try {
      const arr = parseJsonArray(await callGemini(prompt, apiKey))
      for (const it of arr) {
        const idx = i + (Number(it.item) - 1)
        if (String(it.real).toLowerCase() !== 'yes' && idx >= 0 && idx < flagged.length) kept.delete(idx)
      }
    } catch { /* verification failed — keep original flags */ }
  }
  return flagged.filter((_, i) => kept.has(i))
}

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

    const batchSize = getQcBatchSize()
    for (let i = 0; i < pending.length; i += batchSize) {
      if (signal?.paused) {
        saveQcCheckpoint(file, aiIssues, confidence)
        return { paused: true, issuesByProduct: buildResult(), confidence }
      }
      const batch = pending.slice(i, i + batchSize)
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

  // ── Final stage: verify spelling/grammar flags to remove false positives ──
  const nameByPid = {}
  for (const r of rows) nameByPid[r['ProductId']] = r['Name (English)']
  const flagged = []
  for (const key of ['name', 'highlights', 'description']) {
    if (!checks[key] || !aiIssues[key]) continue
    for (const [pid, issue] of Object.entries(aiIssues[key])) {
      if (issue && /spelling mistake|grammar/i.test(issue)) {
        flagged.push({ pid, passKey: key, issue, name: nameByPid[pid] || '' })
      }
    }
  }
  if (flagged.length) {
    onProgress({ pass: totalPasses, totalPasses, label: 'Verifying flags', done: 0, total: flagged.length })
    const kept = await verifyFlaggedIssues(flagged, apiKey, context)
    const keptSet = new Set(kept.map(f => `${f.passKey}|${f.pid}`))
    for (const f of flagged) {
      if (!keptSet.has(`${f.passKey}|${f.pid}`)) aiIssues[f.passKey][f.pid] = ''
    }
    onProgress({ pass: totalPasses, totalPasses, label: 'Verifying flags', done: flagged.length, total: flagged.length })
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
