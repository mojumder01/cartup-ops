import * as XLSX from 'xlsx'

// ── Read any .xlsx — every sheet, raw headers + row values (array-aligned) ───
export function readAnyWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const sheets = {}
        for (const name of wb.SheetNames) {
          const ws = wb.Sheets[name]
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false })
          if (!aoa.length) { sheets[name] = { headers: [], rows: [] }; continue }
          const headerRowIdx = detectHeaderRowIdx(aoa)
          const headers = aoa[headerRowIdx].map(h => String(h ?? '').trim())
          const rows = aoa.slice(headerRowIdx + 1).map((r, i) => ({
            __rid: i,
            values: headers.map((_, ci) => String(r[ci] ?? '').trim()),
          }))
          sheets[name] = { headers, rows }
        }
        resolve({ sheetNames: wb.SheetNames, sheets })
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// ── Column classification (works across differently-shaped product sheets) ──
const norm = h => String(h || '').toLowerCase().replace(/^\*+/, '').trim()

export function classifyColumns(headers) {
  const isImage   = h => /image/i.test(h) && !/video/i.test(h)
  const isHi      = h => /highlight/i.test(h)
  const isDesc    = h => /description/i.test(h)
  const isWeight  = h => /weight/i.test(h)
  const isName    = h => /name/i.test(h)
  const isId      = h => /product\s*id/i.test(norm(h))
  const isSku     = h => /\bsku\b/i.test(h)

  const imageCols       = headers.filter(isImage)
  const highlightCols   = headers.filter(isHi)
  const descriptionCols = headers.filter(isDesc)
  const weightCol       = headers.find(isWeight) || null

  const nameCandidates = headers.filter(isName)
  const nameCol = nameCandidates.find(h => /english/i.test(h))
    || nameCandidates.find(h => !/bengali|bangla/i.test(h))
    || nameCandidates[0] || null

  const idCol = headers.find(isId) || headers.find(isSku) || headers[0] || null

  const shown = new Set([idCol, nameCol, weightCol, ...imageCols, ...highlightCols, ...descriptionCols].filter(Boolean))
  const otherCols = headers.filter(h => !shown.has(h))

  return { idCol, nameCol, imageCols, highlightCols, descriptionCols, weightCol, otherCols }
}

// Heuristic score to auto-pick the "real" product sheet when a file has several
// (e.g. a hidden dropdown-values sheet alongside the actual product sheet).
export function scoreSheet(headers) {
  if (!headers.length) return -1
  const c = classifyColumns(headers)
  let score = 0
  if (c.nameCol) score += 3
  if (c.weightCol) score += 3
  score += c.imageCols.length * 2
  score += c.highlightCols.length * 2
  score += c.descriptionCols.length * 2
  if (c.idCol) score += 1
  return score
}

// Some product templates have a merged "group" header row above the real field
// names (e.g. "Basic Information" repeated, then "*Product Id","*Name"... below
// it). Scan the first few rows and pick whichever looks most like real field
// names — highest column-type score, weighted by how many distinct labels it has.
function detectHeaderRowIdx(aoa) {
  let best = 0, bestScore = -1
  const maxCheck = Math.min(aoa.length, 5)
  for (let i = 0; i < maxCheck; i++) {
    const cand = aoa[i].map(h => String(h ?? '').trim())
    const nonEmpty = cand.filter(Boolean)
    if (nonEmpty.length < 2) continue
    const uniqueRatio = new Set(nonEmpty).size / nonEmpty.length
    const s = scoreSheet(cand) + uniqueRatio * 5
    if (s > bestScore) { bestScore = s; best = i }
  }
  return best
}

export function getVal(headers, row, name) {
  if (!name) return ''
  const i = headers.indexOf(name)
  return i === -1 ? '' : (row.values[i] ?? '')
}

export function setVal(headers, row, name, val) {
  const i = headers.indexOf(name)
  if (i === -1) return row
  const values = row.values.slice()
  values[i] = val
  return { ...row, values }
}

export function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// Excel's hard per-cell text limit — writing longer strings throws at export time.
export const EXCEL_CELL_LIMIT = 32767

// Raw CR characters get escaped to a 7-char "_x000D_" token when the xlsx writer
// serializes them, which can push an already-truncated cell back over the limit.
// Normalizing line endings up front keeps the post-write length predictable.
function safeCellText(v) {
  const s = String(v || '').replace(/\r\n?/g, '\n')
  return s.length > EXCEL_CELL_LIMIT ? s.slice(0, EXCEL_CELL_LIMIT) : s
}

// Flag rows whose source data already exceeds Excel's cell limit (seen in the wild
// on very long Description/Highlights fields) so the user knows before downloading.
export function scanOverLimit(headers, rows) {
  const warnings = {}
  for (const r of rows) {
    const hits = []
    headers.forEach((h, i) => {
      const len = (r.values[i] || '').length
      if (len > EXCEL_CELL_LIMIT) hits.push(`${h} (${len} chars)`)
    })
    if (hits.length) warnings[r.__rid] = `⚠ Exceeds Excel's 32,767-char cell limit — will be truncated on download: ${hits.join(', ')}`
  }
  return warnings
}

// ── Rebuild an .xlsx from current (possibly edited) rows + a per-row report map
export function buildDataVizFile(headers, rows, reportByRid, sheetName = 'data') {
  const cols = [...headers, 'Report']
  const data = rows.map(r => [
    ...r.values.map(safeCellText),
    safeCellText(reportByRid[r.__rid] || ''),
  ])
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([cols, ...data])
  ws['!cols'] = cols.map(c =>
    /highlight|description|report/i.test(c) ? { wch: 60 }
    : /name|category|image/i.test(c) ? { wch: 40 }
    : { wch: 16 }
  )
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || 'data')
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}
