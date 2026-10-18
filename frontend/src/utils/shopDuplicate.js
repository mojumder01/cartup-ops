// Shop Duplicate — copies one seller's product export into the CartUp bulk
// upload template for another seller.
//
// The upload template is filled at the XML level (via JSZip) rather than
// rebuilt with SheetJS: its hidden `payload_hidden` sheet — the one the
// platform actually reads — is VLOOKUP formulas into Excel Tables on
// `value_hidden`, and the visible sheet carries dropdown validations. SheetJS
// would drop the tables/validations and leave formula results uncalculated,
// so here the template is kept byte-for-byte except for the cells we fill,
// and every formula's cached result is computed so the file is correct even
// if nobody opens it in Excel before uploading.
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { applyReplacements } from './wordReplacements'

// ── XML helpers ───────────────────────────────────────────────────────────────
const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }
function xmlUnescape(s) {
  return String(s).replace(/&(lt|gt|quot|apos|amp);|&#(\d+);|&#x([0-9a-fA-F]+);/g,
    (m, name, dec, hex) => name ? ENTITIES[name] : String.fromCodePoint(dec ? parseInt(dec, 10) : parseInt(hex, 16)))
}
// Characters that are illegal in XML 1.0 make Excel refuse the whole file.
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
function xmlEscape(s) {
  return String(s).replace(ILLEGAL_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function parseAttrs(str) {
  const out = {}
  for (const m of str.matchAll(/([\w:.-]+)="([^"]*)"/g)) out[m[1]] = xmlUnescape(m[2])
  return out
}
function colToNum(c) { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n }
function numToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }

function resolvePath(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1)
  const out = []
  for (const p of `${baseDir}/${target}`.split('/')) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}
async function readRels(zip, partPath) {
  const i = partPath.lastIndexOf('/')
  const file = zip.file(`${partPath.slice(0, i)}/_rels/${partPath.slice(i + 1)}.rels`)
  if (!file) return []
  const xml = await file.async('string')
  return [...xml.matchAll(/<Relationship\b([^>]*?)\/?>/g)].map(m => {
    const a = parseAttrs(m[1])
    return { id: a.Id, type: a.Type || '', target: resolvePath(partPath.slice(0, i), a.Target || '') }
  })
}

function parseSharedStrings(xml) {
  const out = []
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) {
    const body = (m[1] || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
    let s = ''
    for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += xmlUnescape(t[1])
    out.push(s)
  }
  return out
}

function parseCells(rowBody) {
  const cells = []
  for (const m of rowBody.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = parseAttrs(m[1])
    const ref = /^([A-Z]+)(\d+)$/.exec(a.r || '')
    if (ref) cells.push({ col: ref[1], row: +ref[2], t: a.t, s: a.s, body: m[2] || '' })
  }
  return cells
}
function cellValue(cell, sst) {
  const v = /<v>([\s\S]*?)<\/v>/.exec(cell.body)
  if (cell.t === 's') return v ? (sst[+v[1]] ?? '') : ''
  if (cell.t === 'inlineStr') {
    let s = ''
    for (const t of cell.body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += xmlUnescape(t[1])
    return s
  }
  if (!v) return ''
  const raw = xmlUnescape(v[1])
  if (cell.t === 'str' || cell.t === 'e') return raw
  const n = Number(raw)
  return Number.isNaN(n) ? raw : n
}

// Splits a worksheet into the text before <sheetData>, its rows, and the text after.
function splitSheet(xml) {
  const open = /<sheetData\b[^>]*>/.exec(xml)
  const closeIdx = xml.indexOf('</sheetData>')
  if (!open || closeIdx < 0) throw new Error('Template sheet has no rows')
  const start = open.index + open[0].length
  const rows = []
  for (const m of xml.slice(start, closeIdx).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const a = parseAttrs(m[1])
    rows.push({ r: +a.r, attrs: m[1], xml: m[0], body: m[2] || '' })
  }
  return { head: xml.slice(0, start), rows, tail: xml.slice(closeIdx) }
}
function rowOpenTag(attrs, r) {
  return `<row${attrs.replace(/\br="\d+"/, `r="${r}"`)}>`
}

// ── Template formulas in payload_hidden ───────────────────────────────────────
const REF = 'product!\\$?([A-Z]+)\\$?(\\d+)'
const LOOKUP_RE = new RegExp(`^IF\\(${REF}<>"",\\s*VLOOKUP\\(${REF},\\s*([A-Za-z_][\\w.]*)\\[#All\\],\\s*(\\d+),\\s*FALSE\\),\\s*""\\)$`, 'i')
const DIRECT_RE = new RegExp(`^IF\\(${REF}<>"",\\s*${REF},\\s*""\\)$`, 'i')
function parseFormula(f) {
  let m = LOOKUP_RE.exec(f)
  if (m && m[1] === m[3] && m[2] === m[4]) return { kind: 'lookup', pcol: m[1], prow: +m[2], table: m[5], idx: +m[6] }
  m = DIRECT_RE.exec(f)
  if (m && m[1] === m[3] && m[2] === m[4]) return { kind: 'direct', pcol: m[1], prow: +m[2] }
  return null
}

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

// ── Template loading ──────────────────────────────────────────────────────────
export async function loadTemplate(data) {
  let zip
  try { zip = await JSZip.loadAsync(data, { createFolders: false }) } catch { throw new Error('The template is not a valid .xlsx file') }
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string')
  if (!workbookXml) throw new Error('The template is not a valid .xlsx file')
  const wbRels = await readRels(zip, 'xl/workbook.xml')
  const sheets = [...workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)].map(m => {
    const a = parseAttrs(m[1])
    return { name: a.name, path: wbRels.find(r => r.id === a['r:id'])?.target }
  })
  const sheet = n => sheets.find(s => (s.name || '').toLowerCase() === n && s.path && zip.file(s.path))
  const product = sheet('product'), valueSheet = sheet('value_hidden'), payload = sheet('payload_hidden')
  if (!product || !valueSheet || !payload) {
    throw new Error('This is not the CartUp upload template — it must contain the "product", "value_hidden" and "payload_hidden" sheets')
  }
  const sstRel = wbRels.find(r => r.type.endsWith('/sharedStrings'))
  const sst = sstRel && zip.file(sstRel.target) ? parseSharedStrings(await zip.file(sstRel.target).async('string')) : []

  // Lookup tables (Brand, Unit, Color, Warranty…) — Excel Tables on value_hidden.
  const valueXml = await zip.file(valueSheet.path).async('string')
  const grid = new Map()
  for (const row of splitSheet(valueXml).rows) for (const c of parseCells(row.body)) grid.set(c.col + c.row, cellValue(c, sst))
  const tables = {}
  for (const rel of await readRels(zip, valueSheet.path)) {
    if (!rel.type.endsWith('/table')) continue
    const tx = await zip.file(rel.target)?.async('string')
    const head = tx && /<table\b([^>]*)>/.exec(tx)
    if (!head) continue
    const ta = parseAttrs(head[1])
    const ref = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec((ta.ref || '').replace(/\$/g, ''))
    if (!ref) continue
    const c1 = colToNum(ref[1]), c2 = colToNum(ref[3])
    const rows = []
    // Row 1 of the table is its header ("Name","Value"); VLOOKUP over [#All]
    // includes it, but no real product value is ever literally "Name".
    for (let r = +ref[2] + 1; r <= +ref[4]; r++) {
      const vals = []
      for (let c = c1; c <= c2; c++) vals.push(grid.get(numToCol(c) + r) ?? '')
      if (vals[0] !== '') rows.push(vals)
    }
    // VLOOKUP is case-insensitive but space-sensitive and returns the first
    // match — the lists contain near-duplicates like "Grey" and "Grey " with
    // different IDs, so exact matching must win over a trimmed fallback.
    const exact = new Map(), trimmed = new Map()
    for (const vals of rows) {
      const k = String(vals[0]).toLowerCase()
      if (!exact.has(k)) exact.set(k, vals)
      if (!trimmed.has(k.trim())) trimmed.set(k.trim(), vals)
    }
    tables[ta.name || ta.displayName] = { rows, exact, trimmed }
  }

  // Visible product sheet: group label (row 1), header (row 2), data rows from 3.
  const productXml = await zip.file(product.path).async('string')
  const productParts = splitSheet(productXml)
  const textOf = r => new Map(parseCells(productParts.rows.find(x => x.r === r)?.body || '').map(c => [c.col, String(cellValue(c, sst)).trim()]))
  const groups = textOf(1), headers = textOf(2)
  const productDataRows = productParts.rows.filter(r => r.r >= 3)
  if (!headers.size || !productDataRows.length) throw new Error('The template\'s product sheet has no header or no rows')
  const productMaxRow = Math.max(...productParts.rows.map(r => r.r))

  // payload_hidden: find a row whose formulas all parse and use it as the pattern
  // for every row — the template may contain #REF! rows left over from rows
  // being deleted in Excel, which this repairs.
  const payloadXml = await zip.file(payload.path).async('string')
  const payloadParts = splitSheet(payloadXml)
  let pattern = null
  for (const row of payloadParts.rows) {
    if (row.r < 2) continue
    const cells = parseCells(row.body)
    const parsed = cells.map(c => {
      const f = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(c.body)
      const formula = f ? xmlUnescape(f[1]) : ''
      return { cell: c, formula, info: formula ? parseFormula(formula) : null }
    })
    if (parsed.length && parsed.every(p => p.info) && new Set(parsed.map(p => p.info.prow)).size === 1) {
      pattern = { row, parsed, offset: parsed[0].info.prow - row.r }
      break
    }
  }
  if (!pattern) throw new Error('Could not read the formulas in the template\'s payload_hidden sheet')
  const payloadCols = pattern.parsed.map(({ cell, formula, info }) => ({
    col: cell.col,
    s: cell.s,
    // e.g. IF(product!A3<>"",product!A3,"") → IF(product!A{R}<>"",product!A{R},"")
    formula: formula.replace(/product!(\$?)([A-Z]+)(\$?)\d+/g, 'product!$1$2$3{R}'),
    ...info,
  }))
  for (const pc of payloadCols) {
    if (pc.kind === 'lookup' && !tables[pc.table]) throw new Error(`Template lookup table "${pc.table}" is missing`)
  }
  const payloadMaxRow = Math.max(...payloadParts.rows.map(r => r.r))

  // Per product column: header, group, and how payload reads it.
  const columns = [...headers.keys()].sort((a, b) => colToNum(a) - colToNum(b)).map(col => {
    const pc = payloadCols.find(p => p.pcol === col)
    const header = headers.get(col)
    return {
      col,
      header,
      key: norm(header),
      group: norm(groups.get(col) || ''),
      required: header.startsWith('**'),
      lookup: pc?.kind === 'lookup' ? { table: pc.table, idx: pc.idx } : null,
    }
  })

  // Data rows the template can hold: product rows from 3, each with its payload row.
  const capacity = Math.min(productMaxRow - 2, payloadMaxRow + pattern.offset - 2)

  return {
    zip, sst, tables, columns, capacity,
    product: { path: product.path, parts: productParts },
    payload: { path: payload.path, parts: payloadParts, cols: payloadCols, offset: pattern.offset, maxRow: payloadMaxRow },
    workbookXml,
  }
}

// ── Old seller export → template rows ────────────────────────────────────────
export function readSellerExport(data) {
  let wb
  try { wb = XLSX.read(data, { type: 'array', cellDates: true }) } catch { throw new Error('The seller export is not a readable Excel file') }
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: true })
    if (!rows.length) continue
    const keys = new Set(Object.keys(rows[0]).map(norm))
    if (keys.has('sellersku') && keys.has('parentsku')) {
      return rows.map((r, i) => {
        const o = { __row: i + 2 }
        for (const [k, v] of Object.entries(r)) o[norm(k)] = v
        return o
      })
    }
  }
  throw new Error('The seller export needs "Seller SKU" and "Parent Sku" columns — is this the seller\'s product export?')
}

const TEXT_FIELDS = new Set(['nameenglish', 'namebengali', 'highlightsenglish', 'highlightsbengali',
  'descriptionenglish', 'descriptionbengali', 'whatsinthebox', 'warrantypolicyenglish', 'warrantypolicybangla'])
const NUMBER_FIELDS = new Set(['categoryid', 'packageweightkg', 'packagelengthcm', 'packagewidthcm',
  'packageheightcm', 'currentstockqty', 'pricemrp', 'specialprice'])
// Template header → export header, where the two names differ.
const SOURCE_ALIASES = {
  highlightsenglish: 'highlighten', highlightsbengali: 'highlightbn',
  descriptionenglish: 'descriptionen', descriptionbengali: 'descriptionbn',
  variantimage: 'variantimage1',
}

const blank = v => v === '' || v === null || v === undefined
function toNumber(v) {
  if (typeof v === 'number') return v
  const s = String(v).trim().replace(/,/g, '')
  return s !== '' && !Number.isNaN(Number(s)) ? Number(s) : v
}
function toDateText(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = n => String(n).padStart(2, '0')
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`
  }
  return typeof v === 'string' ? v.trim() : v
}
// "https://…/product/abc.webp" → "abc.webp" (the template takes file names).
function imageName(v) {
  if (blank(v)) return ''
  return String(v).trim().split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop()
}
export function prefixedSku(prefix, sku) {
  if (blank(sku)) return ''
  const p = String(prefix || '').trim()
  return /[_-]$/.test(p) || !p ? `${p}${sku}` : `${p}_${sku}`
}

// "Size-One Size, Color-Black" → { size: 'One Size', color: 'Black' }
function parseAttrList(text, names) {
  const out = {}, unknown = []
  if (blank(text)) return { out, unknown }
  const alts = [...names].sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const parts = alts
    ? String(text).split(new RegExp(`,\\s*(?=(?:${alts})\\s*-)`, 'i'))
    : [String(text)]
  for (const part of parts) {
    const m = /^\s*([^-]+?)\s*-\s*([\s\S]*?)\s*$/.exec(part)
    const name = m && names.find(n => n.toLowerCase() === m[1].toLowerCase())
    if (name) out[norm(name)] = m[2]
    else if (part.trim()) unknown.push(part.trim())
  }
  return { out, unknown }
}

export function buildRows(exportRows, tpl, { prefix }) {
  const warnings = []
  const warn = (src, field, message) => warnings.push({ row: src.__row, sku: src.sellersku ?? '', field, message })

  // Keep the first row for each Seller SKU, in the export's order.
  const seen = new Set(), duplicates = []
  const unique = []
  for (const r of exportRows) {
    const sku = String(r.sellersku ?? '').trim()
    if (!sku) { warn(r, 'Seller SKU', 'Row has no Seller SKU — skipped'); continue }
    if (seen.has(sku)) { duplicates.push(sku); continue }
    seen.add(sku)
    unique.push(r)
  }

  const variantCols = tpl.columns.filter(c => c.group.includes('variantattribute') && c.lookup)
  const attrCols = tpl.columns.filter(c => c.group.includes('productattribute'))
  const variantNames = variantCols.map(c => c.header.replace(/^\*+/, '').trim())
  const attrNames = attrCols.map(c => c.header.replace(/^\*+/, '').trim())

  const lookup = (col, value) => {
    const t = tpl.tables[col.lookup.table]
    const s = String(value).toLowerCase()
    return t.exact.get(s) || t.exact.get(s.trim()) || t.trimmed.get(s.trim()) || null
  }

  const rows = unique.map(src => {
    const values = {}
    const variants = parseAttrList(src.variantname, variantNames)
    if (variants.unknown.length) warn(src, 'Variant', `Unknown variant attribute: ${variants.unknown.join('; ')}`)
    const attrs = parseAttrList(src.productattributes, attrNames)
    if (attrs.unknown.length) warn(src, 'Product attributes', `Could not map: ${attrs.unknown.join('; ')}`)
    const hasSpecial = !blank(src.specialprice) && Number(toNumber(src.specialprice)) !== 0

    for (const col of tpl.columns) {
      const key = col.key
      let v
      if (variantCols.includes(col)) v = variants.out[key]
      else if (attrCols.includes(col)) v = attrs.out[key] ?? src[SOURCE_ALIASES[key] || key]
      else v = src[SOURCE_ALIASES[key] || key]
      if (v instanceof Date) v = toDateText(v)
      if (blank(v)) v = ''

      if (key.startsWith('productimage') || key === 'variantimage') v = imageName(v)
      else if (key === 'sellersku' || key === 'parentsku') v = prefixedSku(prefix, String(v).trim())
      else if (TEXT_FIELDS.has(key) && v !== '') v = applyReplacements(String(v))
      else if (key === 'specialprice') v = hasSpecial ? toNumber(v) : ''
      else if (key === 'specialstartdate' || key === 'specialenddate') v = hasSpecial ? toDateText(v) : ''
      else if (NUMBER_FIELDS.has(key) && v !== '') v = toNumber(v)
      else if (typeof v === 'string') v = v.trim()

      // Dropdown columns must hold the exact name from the template's list,
      // or the hidden VLOOKUP fails (#N/A) and the platform rejects the row.
      if (col.lookup && v !== '') {
        let hit = lookup(col, v)
        // Exports carry Warranty Type/Period as IDs (e.g. 3 = "No Warranty").
        if (!hit && /^\d+$/.test(String(v).trim())) {
          hit = tpl.tables[col.lookup.table].rows.find(r => String(r[col.lookup.idx - 1]) === String(v).trim()) || null
        }
        if (hit) v = hit[0]
        else warn(src, col.header.replace(/^\*+/, ''), `"${v}" is not in the template's list — the upload will reject this row`)
      }

      if (col.required && v === '') warn(src, col.header.replace(/^\*+/, ''), 'Required field is empty')
      values[col.col] = v
    }
    if (hasSpecial && Number(values[tpl.columns.find(c => c.key === 'specialprice')?.col]) >= Number(values[tpl.columns.find(c => c.key === 'pricemrp')?.col])) {
      warn(src, 'Special Price', 'Special price is not lower than MRP')
    }
    return { values, parent: String(src.parentsku ?? '').trim(), source: src }
  })

  return { rows, warnings, duplicates, totalRead: exportRows.length }
}

// Variants of one product must land in the same file, so split by parent SKU.
export function chunkRows(rows, capacity) {
  const groups = new Map()
  for (const r of rows) {
    if (!groups.has(r.parent)) groups.set(r.parent, [])
    groups.get(r.parent).push(r)
  }
  const chunks = [[]]
  for (const g of groups.values()) {
    let cur = chunks[chunks.length - 1]
    if (cur.length && cur.length + g.length > capacity) chunks.push(cur = [])
    for (const r of g) {
      if (cur.length >= capacity) chunks.push(cur = [])
      cur.push(r)
    }
  }
  return chunks.filter(c => c.length)
}

// ── Writing ───────────────────────────────────────────────────────────────────
function productCell(ref, s, v) {
  const st = s !== undefined ? ` s="${s}"` : ''
  if (v === '' || v === null || v === undefined) return `<c r="${ref}"${st}/>`
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`
}
function payloadCell(ref, s, formula, v) {
  const st = s !== undefined ? ` s="${s}"` : ''
  const f = `<f>${xmlEscape(formula)}</f>`
  if (v && typeof v === 'object' && v.error) return `<c r="${ref}"${st} t="e">${f}<v>${v.error}</v></c>`
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}>${f}<v>${v}</v></c>`
  if (v === '' || v === null || v === undefined) return `<c r="${ref}"${st} t="str">${f}<v/></c>`
  return `<c r="${ref}"${st} t="str">${f}<v>${xmlEscape(v)}</v></c>`
}

export async function writeTemplate(tpl, rows) {
  if (rows.length > tpl.capacity) throw new Error(`Too many rows for one template (${rows.length} > ${tpl.capacity})`)
  const { zip } = tpl

  // product sheet: rows 1–2 untouched, data rows refilled (and any leftovers cleared).
  const pp = tpl.product.parts
  const byRow = new Map(pp.rows.map(r => [r.r, r]))
  const firstData = pp.rows.find(r => r.r >= 3)
  const rowNums = new Set(pp.rows.map(r => r.r))
  for (let i = 0; i < rows.length; i++) rowNums.add(3 + i)
  const productRows = [...rowNums].sort((a, b) => a - b).map(r => {
    const row = byRow.get(r)
    if (r < 3) return row.xml
    const data = rows[r - 3]
    const styles = new Map(parseCells((row || firstData).body).map(c => [c.col, c.s]))
    const cols = new Set(styles.keys())
    if (data) for (const c of Object.keys(data.values)) if (data.values[c] !== '') cols.add(c)
    const cells = [...cols].sort((a, b) => colToNum(a) - colToNum(b))
      .map(c => productCell(`${c}${r}`, styles.get(c), data ? data.values[c] : ''))
    return `${rowOpenTag((row || firstData).attrs, r)}${cells.join('')}</row>`
  })
  zip.file(tpl.product.path, pp.head + productRows.join('') + pp.tail, { createFolders: false })

  // payload_hidden: every row rebuilt from the clean formula pattern, with the
  // result Excel would compute stored as the cell's cached value.
  const pl = tpl.payload
  const existing = new Map(pl.parts.rows.map(r => [r.r, r]))
  const payloadRows = []
  for (const row of pl.parts.rows) if (row.r < 2) payloadRows.push(row.xml)
  for (let p = 2; p <= pl.maxRow; p++) {
    const q = p + pl.offset
    const data = q >= 3 ? rows[q - 3] : undefined
    const cells = pl.cols.map(pc => {
      const formula = pc.formula.replaceAll('{R}', String(q))
      let v = ''
      if (data) {
        const pv = data.values[pc.pcol]
        if (pv !== '' && pv !== undefined) {
          if (pc.kind === 'direct') v = pv
          else {
            // Same rule Excel applies when it recalculates: exact, case-insensitive.
            const hit = tpl.tables[pc.table].exact.get(String(pv).toLowerCase())
            v = hit ? toNumber(hit[pc.idx - 1]) : { error: '#N/A' }
          }
        }
      }
      return payloadCell(`${pc.col}${p}`, pc.s, formula, v)
    })
    const attrs = (existing.get(p) || pl.parts.rows.find(r => r.r >= 2)).attrs
    payloadRows.push(`${rowOpenTag(attrs, p)}${cells.join('')}</row>`)
  }
  zip.file(pl.path, pl.parts.head + payloadRows.join('') + pl.parts.tail, { createFolders: false })

  // Ask Excel to recalculate on open, so edits made later stay consistent.
  let wb = tpl.workbookXml
  if (/<calcPr\b/.test(wb)) {
    if (!/<calcPr\b[^>]*fullCalcOnLoad=/.test(wb)) wb = wb.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"')
  } else {
    wb = wb.replace(/(<extLst\b|<\/workbook>)/, '<calcPr fullCalcOnLoad="1"/>$1')
  }
  zip.file('xl/workbook.xml', wb, { createFolders: false })

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

// Full pipeline: returns one or more filled templates plus a report.
export async function duplicateShop({ exportData, templateData, prefix, onProgress: report = () => {} }) {
  if (!String(prefix || '').trim()) throw new Error('Enter the new seller\'s SKU prefix')
  // Yield after each message so the browser can paint it before the next heavy step.
  const onProgress = async msg => { report(msg); await new Promise(r => setTimeout(r, 0)) }
  await onProgress('Reading seller export…')
  const exportRows = readSellerExport(exportData)
  await onProgress('Reading upload template…')
  const tpl = await loadTemplate(templateData)
  await onProgress('Mapping products…')
  const built = buildRows(exportRows, tpl, { prefix })
  if (!built.rows.length) throw new Error('No products to copy')
  const chunks = chunkRows(built.rows, tpl.capacity)
  const files = []
  for (let i = 0; i < chunks.length; i++) {
    await onProgress(chunks.length > 1 ? `Writing file ${i + 1} of ${chunks.length}…` : 'Writing upload file…')
    files.push({ rows: chunks[i].length, bytes: await writeTemplate(tpl, chunks[i]) })
  }
  return {
    files,
    report: {
      totalRead: built.totalRead,
      duplicates: built.duplicates,
      written: built.rows.length,
      products: new Set(built.rows.map(r => r.parent)).size,
      capacity: tpl.capacity,
      warnings: built.warnings,
    },
  }
}

export async function zipFiles(files, baseName) {
  const out = new JSZip()
  files.forEach((f, i) => out.file(`${baseName}_part${i + 1}.xlsx`, f.bytes))
  return out.generateAsync({ type: 'uint8array', compression: 'STORE' })
}
