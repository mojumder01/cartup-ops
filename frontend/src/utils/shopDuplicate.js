// Shop Duplicate — copies one seller's product export into the CartUp bulk
// upload template for another seller.
//
// The upload template is filled at the XML level (via JSZip) rather than
// rebuilt with SheetJS: its hidden `payload_hidden` sheet — the one the
// platform actually reads — is formulas (VLOOKUPs into Excel Tables on
// `value_hidden`), and the visible sheet carries dropdown validations. SheetJS
// would drop the tables/validations and leave formula results uncalculated,
// so here the template is kept byte-for-byte except for the cells we fill,
// and every formula's cached result is computed (by a small formula engine)
// so the file is correct even if nobody opens it in Excel before uploading.
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { applyReplacements } from './wordReplacements'
import {
  tokenize, parse, fillDown, moveRef, refText, evaluate, finalValue,
  Range, Unsupported, EMPTY, err, isErr, colToNum, numToCol,
} from './xlsxFormula'

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
    if (ref) cells.push({ col: ref[1], row: +ref[2], t: a.t, s: a.s, body: m[2] || '', xml: m[0] })
  }
  return cells
}
function inlineText(body) {
  let s = ''
  for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += xmlUnescape(t[1])
  return s
}
// A cell's display value ('' when empty) — for header text.
function cellValue(cell, sst) {
  const v = rawValue(cell, sst)
  return v === EMPTY ? '' : isErr(v) ? v.error : v
}
// A cell's value as formulas see it: EMPTY, number, text, boolean or error.
function rawValue(cell, sst) {
  if (cell.t === 'inlineStr') return /<is\b/.test(cell.body) ? inlineText(cell.body) : EMPTY
  const v = /<v>([\s\S]*?)<\/v>/.exec(cell.body)
  if (!v) return EMPTY
  const raw = xmlUnescape(v[1])
  switch (cell.t) {
    case 's': return sst[+raw] ?? ''
    case 'str': return raw
    case 'b': return raw === '1'
    case 'e': return err(raw)
    default: { const n = Number(raw); return Number.isNaN(n) ? raw : n }
  }
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

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const KEY = (r, c) => r * 16384 + c

// ── Formula evaluation against the template + the rows being written ──────────
const letters = []
const letter = c => (letters[c] ||= numToCol(c))

function evalContext(tpl, rows) {
  const { product, payload } = tpl
  const memo = new Map(), busy = new Set(), names = new Map()
  const ctx = {
    sheet: payload.key, row: 0, col: 0, cache: new Map(),
    table: n => tpl.tables.get(String(n).toLowerCase()) || null,
    name(n) {
      const k = String(n).toLowerCase()
      if (!names.has(k)) {
        let ast = null
        try { if (tpl.names.has(k)) ast = parse(tokenize(tpl.names.get(k))) } catch (e) { if (!(e instanceof Unsupported)) throw e }
        names.set(k, ast)
      }
      return names.get(k)
    },
    maxRow: s => s === product.key ? Math.max(product.maxRow, product.dataStart + rows.length - 1)
      : s === payload.key ? payload.maxRow : (tpl.grids.get(s)?.maxRow ?? 0),
    maxCol: s => s === product.key ? product.maxCol : s === payload.key ? payload.maxCol : (tpl.grids.get(s)?.maxCol ?? 0),
    cell(s, r, c) {
      if (s === product.key) {
        if (r < product.dataStart) return product.head.get(KEY(r, c)) ?? EMPTY
        const v = rows[r - product.dataStart]?.values[letter(c)]
        return v === undefined || v === '' ? EMPTY : v
      }
      if (s === payload.key) return ctx.payloadValue(r, c)
      const g = tpl.grids.get(s)
      return g ? (g.cells.get(KEY(r, c)) ?? EMPTY) : err('#REF!')
    },
    // payload_hidden cells, computed on demand (formulas may read each other).
    payloadValue(r, c) {
      const k = KEY(r, c)
      if (memo.has(k)) return memo.get(k)
      const pc = payload.byNum?.get(c)
      if (!pc || r < payload.start || r > payload.maxRow) return payload.statics?.get(k) ?? EMPTY
      if (busy.has(k)) return err('#REF!')   // circular reference
      busy.add(k)
      const saved = [ctx.row, ctx.col]
      ctx.row = r; ctx.col = c
      try {
        const v = finalValue(evaluate(pc.ast, ctx, r - pc.row), ctx)
        memo.set(k, v)
        return v
      } finally {
        busy.delete(k)
        ;[ctx.row, ctx.col] = saved
      }
    },
  }
  return ctx
}

function walk(node, visit) {
  if (!node) return
  visit(node)
  walk(node.a, visit); walk(node.b, visit)
  for (const n of node.args || []) walk(n, visit)
}

// The list a lookup formula checks a product column against (Brand, Color…):
// rows of [name, …, id], plus maps for matching names the way Excel does.
function lookupList(node, ctx) {
  const range = n => { const v = evaluate(n, ctx, 0); return v instanceof Range ? v : null }
  const headerRows = (n, r) => {
    const tbl = n.t === 'sref' && ctx.table(n.tok.table)
    return tbl && r.r1 === tbl.r1 ? tbl.header : 0
  }
  let rows, idx = null
  if (node.name === 'VLOOKUP') {
    const r = range(node.args[1])
    if (!r) return null
    rows = Array.from({ length: r.rows }, (_, i) => Array.from({ length: r.cols }, (_, j) => r.at(i, j))).slice(headerRows(node.args[1], r))
    const ix = node.args[2]
    if (ix?.t === 'val' && typeof ix.v === 'number') idx = ix.v
  } else {
    const la = range(node.args[1])
    if (!la || la.cols > 1) return null
    const ra = node.name === 'XLOOKUP' ? range(node.args[2]) : null
    const paired = ra && ra.cols === 1 && ra.rows === la.rows
    rows = Array.from({ length: la.rows }, (_, i) => paired ? [la.at(i, 0), ra.at(i, 0)] : [la.at(i, 0)]).slice(headerRows(node.args[1], la))
    if (paired) idx = 2
  }
  rows = rows.map(vals => vals.map(v => v === EMPTY || isErr(v) ? '' : v)).filter(vals => vals[0] !== '')
  // VLOOKUP is case-insensitive but space-sensitive and returns the first
  // match — the lists contain near-duplicates like "Grey" and "Grey " with
  // different IDs, so exact matching must win over a trimmed fallback.
  const exact = new Map(), trimmed = new Map()
  for (const vals of rows) {
    const k = String(vals[0]).toLowerCase()
    if (!exact.has(k)) exact.set(k, vals)
    if (!trimmed.has(k.trim())) trimmed.set(k.trim(), vals)
  }
  return { rows, exact, trimmed, idx }
}

// ── Template loading ──────────────────────────────────────────────────────────
export async function loadTemplate(data) {
  let zip
  try { zip = await JSZip.loadAsync(data, { createFolders: false }) } catch { throw new Error('The template is not a valid .xlsx file') }
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string')
  if (!workbookXml) throw new Error('The template is not a valid .xlsx file')
  const wbRels = await readRels(zip, 'xl/workbook.xml')
  const sheets = [...workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)].map(m => {
    const a = parseAttrs(m[1])
    return { name: a.name || '', path: wbRels.find(r => r.id === a['r:id'])?.target }
  }).filter(s => s.path && zip.file(s.path))
  const sheet = n => sheets.find(s => s.name.toLowerCase() === n)
  const product = sheet('product'), payload = sheet('payload_hidden')
  if (!product || !payload) {
    throw new Error('This is not the CartUp upload template — it must contain the "product" and "payload_hidden" sheets')
  }
  const sstRel = wbRels.find(r => r.type.endsWith('/sharedStrings'))
  const sst = sstRel && zip.file(sstRel.target) ? parseSharedStrings(await zip.file(sstRel.target).async('string')) : []

  // Values of the other sheets (the dropdown lists live on value_hidden) and
  // the Excel Tables and defined names formulas may point at.
  const grids = new Map(), tables = new Map(), names = new Map()
  for (const s of sheets) {
    const key = s.name.toLowerCase()
    if (s !== product && s !== payload) {
      const grid = { cells: new Map(), maxRow: 0, maxCol: 0 }
      let parts = null
      try { parts = splitSheet(await zip.file(s.path).async('string')) } catch { /* empty sheet */ }
      for (const row of parts?.rows || []) {
        for (const c of parseCells(row.body)) {
          const cn = colToNum(c.col)
          grid.cells.set(KEY(c.row, cn), rawValue(c, sst))
          grid.maxRow = Math.max(grid.maxRow, c.row)
          grid.maxCol = Math.max(grid.maxCol, cn)
        }
      }
      grids.set(key, grid)
    }
    for (const rel of await readRels(zip, s.path)) {
      if (!rel.type.endsWith('/table')) continue
      const tx = await zip.file(rel.target)?.async('string')
      const head = tx && /<table\b([^>]*)>/.exec(tx)
      if (!head) continue
      const ta = parseAttrs(head[1])
      const ref = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec((ta.ref || '').replace(/\$/g, ''))
      if (!ref) continue
      const table = {
        sheet: key, r1: +ref[2], c1: colToNum(ref[1]), r2: +ref[4], c2: colToNum(ref[3]),
        header: ta.headerRowCount !== undefined ? +ta.headerRowCount : 1,
        totals: ta.totalsRowCount !== undefined ? +ta.totalsRowCount : 0,
        columns: [...tx.matchAll(/<tableColumn\b([^>]*?)\/?>/g)].map(m => parseAttrs(m[1]).name || ''),
      }
      for (const n of [ta.name, ta.displayName]) if (n) tables.set(n.toLowerCase(), table)
    }
  }
  for (const m of workbookXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const a = parseAttrs(m[1])
    if (a.name && a.localSheetId === undefined && !a.name.startsWith('_xlnm.')) names.set(a.name.toLowerCase(), xmlUnescape(m[2]))
  }

  // Visible product sheet: the header row is the one holding "Seller SKU"
  // (row 2 in current templates), with group labels just above it.
  const productParts = splitSheet(await zip.file(product.path).async('string'))
  const headerRow = productParts.rows.filter(r => r.r <= 5)
    .find(r => parseCells(r.body).some(c => norm(cellValue(c, sst)).includes('sellersku')))?.r ?? 2
  const textOf = r => new Map(parseCells(productParts.rows.find(x => x.r === r)?.body || '').map(c => [c.col, String(cellValue(c, sst)).trim()]))
  const groups = textOf(headerRow - 1), headers = textOf(headerRow)
  const dataStart = headerRow + 1
  if (!headers.size || !productParts.rows.some(r => r.r >= dataStart)) throw new Error('The template\'s product sheet has no header or no rows')
  const productHead = new Map()
  for (const row of productParts.rows) {
    if (row.r < dataStart) for (const c of parseCells(row.body)) productHead.set(KEY(c.row, colToNum(c.col)), rawValue(c, sst))
  }
  const productInfo = {
    path: product.path, parts: productParts, key: product.name.toLowerCase(), dataStart, head: productHead,
    maxRow: Math.max(...productParts.rows.map(r => r.r)),
    maxCol: Math.max(...[...headers.keys()].map(colToNum)),
  }

  // payload_hidden: one formula per column, filled down every row. Take each
  // column's first sound formula (expanding Excel's shared formulas), skipping
  // #REF! leftovers from rows deleted in Excel.
  const payloadParts = splitSheet(await zip.file(payload.path).async('string'))
  const shared = new Map(), found = new Map(), broken = new Map(), others = new Map()
  let start = 0, payloadMaxCol = 0
  for (const row of payloadParts.rows) {
    for (const cell of parseCells(row.body)) {
      payloadMaxCol = Math.max(payloadMaxCol, colToNum(cell.col))
      const fm = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(cell.body)
      if (!fm) {
        if (!others.has(row.r)) others.set(row.r, [])
        others.get(row.r).push(cell)
        continue
      }
      const fa = parseAttrs(fm[1])
      let text = fm[2] ? xmlUnescape(fm[2]) : ''
      if (fa.t === 'shared' && fa.si !== undefined) {
        if (text) shared.set(fa.si, { text, r: cell.row, c: colToNum(cell.col) })
        else if (!found.has(cell.col) && shared.has(fa.si)) {
          const m = shared.get(fa.si)
          try {
            text = tokenize(m.text).map(t => t.type === 'ref' ? refText(moveRef(t, cell.row - m.r, colToNum(cell.col) - m.c)) : t.text).join('')
          } catch (e) { if (!(e instanceof Unsupported)) throw e }
        }
      }
      if (!text) continue
      start ||= row.r
      if (found.has(cell.col)) continue
      const f = { col: cell.col, c: colToNum(cell.col), row: cell.row, s: cell.s, text }
      if (text.includes('#REF!')) { if (!broken.has(cell.col)) broken.set(cell.col, f) }
      else found.set(cell.col, f)
    }
  }
  if (!found.size && !broken.size) {
    throw new Error('The template\'s payload_hidden sheet has no formulas — download a fresh template from the seller center')
  }
  // Payload row `start` must read product row `dataStart`, and so on down.
  const offset = dataStart - start
  const productKey = productInfo.key
  const isProductRef = t => t.type === 'ref' && t.sheet?.toLowerCase() === productKey
  const notes = []
  const realigned = [], repaired = [], cols = []
  let identity = true
  const compile = (f, repair) => {
    let tokens
    try { tokens = tokenize(f.text) } catch (e) {
      if (e instanceof Unsupported) throw new Error(`Could not read the template's hidden formula in payload_hidden!${f.col}${f.row} (${e.message}): ${f.text}`)
      throw e
    }
    if (repair) {
      // Excel turns references to deleted rows into product!#REF! and loses
      // the column; every payload column reads the same product column.
      tokens = tokens.map(t => {
        if (!isProductRef(t) || !t.bad) return t
        const fixed = { ...t, kind: 'cells', bad: false, a: { c: f.c, ca: false, r: f.row + offset, ra: false }, b: null }
        return { ...fixed, text: refText(fixed) }
      })
    }
    const first = tokens.find(t => isProductRef(t) && !t.bad && t.kind === 'cells' && !t.a.ra)
    if (first) {
      if (first.a.c !== f.c) identity = false
      const delta = f.row + offset - first.a.r
      if (delta) {
        realigned.push(f.col)
        tokens = tokens.map(t => {
          if (!isProductRef(t) || t.bad) return t
          const moved = moveRef(t, delta, 0)
          return { ...moved, text: refText(moved) }
        })
      }
    }
    let ast
    try { ast = parse(tokens) } catch (e) {
      if (e instanceof Unsupported) throw new Error(`Could not read the template's hidden formula in payload_hidden!${f.col}${f.row} (${e.message}): ${f.text}`)
      throw e
    }
    return { col: f.col, c: f.c, row: f.row, s: f.s, render: fillDown(tokens), ast }
  }
  for (const f of found.values()) cols.push(compile(f, false))
  for (const f of broken.values()) {
    if (found.has(f.col)) continue
    if (identity) repaired.push(f.col)
    cols.push(compile(f, identity))
  }
  cols.sort((a, b) => a.c - b.c)
  if (repaired.length) notes.push(`Rebuilt broken (#REF!) formulas in the hidden sheet, columns ${repaired.join(', ')} — rows had been deleted from this template in Excel`)
  else if (broken.size > found.size) notes.push('Some of the hidden sheet\'s formulas show #REF! (rows were deleted in Excel) — download a fresh template from the seller center')
  if (realigned.length) notes.push('The hidden sheet\'s formulas were out of line with the product rows (rows deleted in Excel) — they were realigned')

  const statics = new Map()
  for (const cells of others.values()) for (const c of cells) statics.set(KEY(c.row, colToNum(c.col)), rawValue(c, sst))
  const payloadInfo = {
    path: payload.path, parts: payloadParts, key: payload.name.toLowerCase(), start, cols, others, statics,
    byNum: new Map(cols.map(pc => [pc.c, pc])),
    maxRow: Math.max(...payloadParts.rows.map(r => r.r)),
    maxCol: payloadMaxCol,
  }

  const tpl = { zip, sst, sheets, grids, tables, names, notes, product: productInfo, payload: payloadInfo, workbookXml }

  // Dropdown columns: which list each product column is looked up in.
  const ctx = evalContext(tpl, [])
  const lookups = new Map()
  const unwrap = n => n?.t === 'fn' && ['TRIM', 'CLEAN', 'LOWER', 'UPPER', 'SINGLE'].includes(n.name) && n.args.length === 1 ? unwrap(n.args[0]) : n
  for (const pc of cols) {
    walk(pc.ast, node => {
      if (node.t !== 'fn' || !['VLOOKUP', 'XLOOKUP', 'MATCH'].includes(node.name)) return
      const key = unwrap(node.args[0])
      if (key?.t !== 'ref' || !isProductRef(key.tok) || key.tok.bad || key.tok.kind !== 'cells' || key.tok.b) return
      const col = letter(key.tok.a.c)
      if (lookups.has(col)) return
      try {
        const list = lookupList(node, ctx)
        if (list) lookups.set(col, list)
      } catch (e) { if (!(e instanceof Unsupported)) throw e }
    })
  }

  tpl.columns = [...headers.keys()].sort((a, b) => colToNum(a) - colToNum(b)).map(col => {
    const header = headers.get(col)
    return {
      col,
      header,
      key: norm(header),
      group: norm(groups.get(col) || ''),
      required: header.startsWith('**'),
      lookup: lookups.get(col) || null,
    }
  })

  // Data rows the template can hold: product rows from dataStart, each with its payload row.
  tpl.capacity = Math.min(productInfo.maxRow, payloadInfo.maxRow + offset) - dataStart + 1
  if (tpl.capacity < 1) throw new Error('The template has no empty product rows to fill')
  return tpl
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
      const out = rows.map((r, i) => {
        const o = { __row: i + 2 }
        for (const [k, v] of Object.entries(r)) o[norm(k)] = v
        return o
      })
      out.headers = Object.fromEntries(Object.keys(rows[0]).map(k => [norm(k), k.trim()]))
      return out
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
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── SKUs for the new seller ───────────────────────────────────────────────────
// Either a prefix in front (CCWT9196_184 → CCWT9323_CCWT9196_184) or the old
// seller code replaced (CCWT9196_184 → CCWT9197_184).
export function prefixedSku(prefix, sku) {
  if (blank(sku)) return ''
  const p = String(prefix || '').trim()
  return /[_-]$/.test(p) || !p ? `${p}${sku}` : `${p}_${sku}`
}

// Seller codes the export's SKUs start with: CCWT9196_184_Anycolour → CCWT9196.
export function skuCodes(rows) {
  const codes = new Map()
  for (const r of rows) {
    const sku = String(r.sellersku ?? '').trim()
    const m = /^([A-Za-z0-9]+)[_-]/.exec(sku)
    if (!m) continue
    if (!codes.has(m[1])) codes.set(m[1], { code: m[1], count: 0 })
    codes.get(m[1]).count++
  }
  return [...codes.values()].sort((a, b) => b.count - a.count)
}

// "CCWT9196 = CCWT9197" — one rule per line (or comma); =, ->, →, : or a space between.
export function parseSkuRules(text) {
  return String(text ?? '').split(/[\r\n;,]+/).map(line => {
    const m = /^\s*(\S+?)\s*(?:=>|->|→|=|:|\s)\s*(\S*)\s*$/.exec(line)
    return m ? { from: m[1], to: m[2] } : { from: line.trim(), to: '' }
  }).filter(r => r.from)
}

// Codes match whole tokens only (CCWT9196 never touches CCWT91961),
// case-insensitive, longest first.
function codePattern(codes, flags = 'gi') {
  const alnum = /[A-Za-z0-9]/
  const alts = [...new Set(codes.map(c => c.toLowerCase()))].sort((a, b) => b.length - a.length).map(c =>
    `${alnum.test(c[0]) ? '(?<![A-Za-z0-9])' : ''}${escapeRe(c)}${alnum.test(c[c.length - 1]) ? '(?![A-Za-z0-9])' : ''}`)
  return alts.length ? new RegExp(alts.join('|'), flags) : null
}

const ruleList = rules => (rules || []).map(r => ({ from: String(r.from ?? '').trim(), to: String(r.to ?? '').trim() }))

export function skuOptionsError({ mode, prefix, rules } = {}) {
  if (mode === 'replace') {
    return ruleList(rules).some(r => r.from && r.to) ? '' : 'Add at least one code to replace, e.g. CCWT9196 = CCWT9197'
  }
  return String(prefix || '').trim() ? '' : 'Enter the new seller\'s SKU prefix'
}

// sku → { sku: new SKU, hit: whether anything was changed }. In replace mode
// each SKU is rewritten in one pass, so rules like A=B, B=C never chain.
export function skuMapper({ mode, prefix, rules } = {}) {
  if (mode !== 'replace') return sku => blank(sku) ? { sku: '', hit: false } : { sku: prefixedSku(prefix, sku), hit: true }
  const map = new Map()
  for (const { from, to } of ruleList(rules)) if (from && to && !map.has(from.toLowerCase())) map.set(from.toLowerCase(), to)
  const re = codePattern([...map.keys()])
  return sku => {
    let hit = false
    const out = blank(sku) || !re ? String(sku ?? '') : String(sku).replace(re, m => { hit = true; return map.get(m.toLowerCase()) })
    return { sku: out, hit }
  }
}

// Keep the first row for each Seller SKU, in the export's order.
function dedupe(exportRows) {
  const kept = new Map(), unique = [], duplicates = [], missing = []
  for (const r of exportRows) {
    const sku = String(r.sellersku ?? '').trim()
    if (!sku) missing.push(r)
    else if (kept.has(sku)) duplicates.push({ row: r, kept: kept.get(sku) })
    else { kept.set(sku, r); unique.push(r) }
  }
  return { unique, duplicates, missing }
}

// What a removed duplicate row has that the kept one doesn't, e.g.
// "Price MRP: 780 → 800" — or "Same as kept row".
function rowDifference(kept, dup, headers) {
  const show = v => blank(v) ? '' : v instanceof Date ? toDateText(v) : String(v).trim()
  const clip = s => s === '' ? '(blank)' : s.length > 40 ? `${s.slice(0, 40)}…` : s
  const out = []
  for (const k of new Set([...Object.keys(kept), ...Object.keys(dup)])) {
    if (k === '__row') continue
    const a = show(kept[k]), b = show(dup[k])
    if (a !== b) out.push(`${headers?.[k] || k}: ${clip(a)} → ${clip(b)}`)
  }
  return out.length ? out.join('; ') : 'Same as kept row'
}

// The SKU rewrite over the deduplicated rows. Flags SKUs no rule touched, and
// clashes: two old SKUs becoming the same new Seller SKU (the upload rejects
// one), or two old parents becoming one new Parent SKU (two products merge).
function planUnique(unique, sku) {
  const map = skuMapper(sku)
  const sellerOf = new Map(), parentOf = new Map()
  const sellerClashes = new Set(), parentClashes = new Set()
  let unchanged = 0, example = null
  const items = unique.map(r => {
    const oldSeller = String(r.sellersku).trim(), oldParent = String(r.parentsku ?? '').trim()
    const seller = map(oldSeller), parent = map(oldParent)
    const it = { seller: seller.sku, parent: parent.sku, unchanged: [], clashes: [] }
    if (!seller.hit) it.unchanged.push('Seller SKU')
    if (oldParent && !parent.hit) it.unchanged.push('Parent SKU')
    if (it.unchanged.length) unchanged++

    if (sellerOf.has(seller.sku)) {
      it.clashes.push({ field: 'Seller SKU', message: `Becomes "${seller.sku}", the same as "${sellerOf.get(seller.sku)}" — the upload will reject one` })
      sellerClashes.add(seller.sku)
      example ||= { a: sellerOf.get(seller.sku), b: oldSeller, to: seller.sku }
    } else sellerOf.set(seller.sku, oldSeller)
    if (oldParent) {
      const owner = parentOf.get(parent.sku)
      if (owner === undefined) parentOf.set(parent.sku, oldParent)
      else if (owner !== oldParent) {
        it.clashes.push({ field: 'Parent SKU', message: `Becomes "${parent.sku}", the same as parent "${owner}" — two products would merge into one` })
        parentClashes.add(parent.sku)
        example ||= { a: owner, b: oldParent, to: parent.sku }
      }
    }
    return it
  })
  return { items, unchanged, sellerClashes: sellerClashes.size, parentClashes: parentClashes.size, example }
}

// Live preview for the page: totals plus, per replace rule, how many SKUs
// carry that code and an example of the result.
export function planSkus(exportRows, sku) {
  const { unique } = dedupe(exportRows)
  const plan = planUnique(unique, sku)
  const rules = sku?.mode === 'replace' ? ruleList(sku.rules).map(({ from }) => {
    const re = from && codePattern([from], 'i')
    const i = re ? unique.findIndex(r => re.test(String(r.sellersku))) : -1
    return {
      count: i < 0 ? 0 : unique.reduce((n, r) => n + re.test(String(r.sellersku)), 0),
      sample: i < 0 ? null : { from: String(unique[i].sellersku).trim(), to: plan.items[i].seller },
    }
  }) : []
  const { items, ...totals } = plan
  return { total: unique.length, ...totals, sample: items[0] && { from: String(unique[0].sellersku).trim(), to: items[0].seller }, rules }
}

// "Size-One Size, Color-Black" → { size: 'One Size', color: 'Black' }
function parseAttrList(text, names) {
  const out = {}, unknown = []
  if (blank(text)) return { out, unknown }
  const alts = [...names].sort((a, b) => b.length - a.length).map(escapeRe).join('|')
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

export function buildRows(exportRows, tpl, sku) {
  const warnings = []
  const warn = (src, field, message) => warnings.push({ row: src.__row, sku: src.sellersku ?? '', field, message })

  const { unique, duplicates, missing } = dedupe(exportRows)
  for (const r of missing) warn(r, 'Seller SKU', 'Row has no Seller SKU — skipped')
  const skus = planUnique(unique, sku).items

  const variantCols = tpl.columns.filter(c => c.group.includes('variantattribute') && c.lookup)
  const attrCols = tpl.columns.filter(c => c.group.includes('productattribute'))
  const variantNames = variantCols.map(c => c.header.replace(/^\*+/, '').trim())
  const attrNames = attrCols.map(c => c.header.replace(/^\*+/, '').trim())

  const lookup = (col, value) => {
    const t = col.lookup
    const s = String(value).toLowerCase()
    return t.exact.get(s) || t.exact.get(s.trim()) || t.trimmed.get(s.trim()) || null
  }

  const rows = unique.map((src, i) => {
    const values = {}
    if (skus[i].unchanged.length) warn(src, skus[i].unchanged.join(' & '), 'No replace rule matched — the old seller code is kept')
    for (const c of skus[i].clashes) warn(src, c.field, c.message)
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
      else if (key === 'sellersku') v = skus[i].seller
      else if (key === 'parentsku') v = skus[i].parent
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
        if (!hit && col.lookup.idx && /^\d+$/.test(String(v).trim())) {
          hit = col.lookup.rows.find(r => String(r[col.lookup.idx - 1]) === String(v).trim()) || null
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

  warnings.sort((a, b) => a.row - b.row)
  const removed = duplicates.map(({ row, kept }) => ({
    row: row.__row,
    sku: String(row.sellersku).trim(),
    parent: String(row.parentsku ?? '').trim(),
    name: String(row.nameenglish ?? '').trim(),
    keptRow: kept.__row,
    difference: rowDifference(kept, row, exportRows.headers),
  }))
  return { rows, warnings, duplicates: removed, totalRead: exportRows.length }
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
// v undefined = no cached value (a formula this tool can't calculate; Excel fills it on open).
function payloadCell(ref, s, formula, v) {
  const st = s !== undefined ? ` s="${s}"` : ''
  const f = `<f>${xmlEscape(formula)}</f>`
  if (v === undefined) return `<c r="${ref}"${st}>${f}</c>`
  if (isErr(v)) return `<c r="${ref}"${st} t="e">${f}<v>${xmlEscape(v.error)}</v></c>`
  if (typeof v === 'boolean') return `<c r="${ref}"${st} t="b">${f}<v>${v ? 1 : 0}</v></c>`
  if (typeof v === 'number') return `<c r="${ref}"${st}>${f}<v>${v}</v></c>`
  if (v === '') return `<c r="${ref}"${st} t="str">${f}<v/></c>`
  return `<c r="${ref}"${st} t="str">${f}<v>${xmlEscape(v)}</v></c>`
}

// makeReport (optional): () => rows for the Report tab, built after the
// payload so it can include notes from calculating it.
export async function writeTemplate(tpl, rows, makeReport = null) {
  if (rows.length > tpl.capacity) throw new Error(`Too many rows for one template (${rows.length} > ${tpl.capacity})`)
  const { zip } = tpl

  // product sheet: header rows untouched, data rows refilled (and any leftovers cleared).
  const pp = tpl.product.parts, start = tpl.product.dataStart
  const byRow = new Map(pp.rows.map(r => [r.r, r]))
  const firstData = pp.rows.find(r => r.r >= start)
  const rowNums = new Set(pp.rows.map(r => r.r))
  for (let i = 0; i < rows.length; i++) rowNums.add(start + i)
  const productRows = [...rowNums].sort((a, b) => a - b).map(r => {
    const row = byRow.get(r)
    if (r < start) return row.xml
    const data = rows[r - start]
    const styles = new Map(parseCells((row || firstData).body).map(c => [c.col, c.s]))
    const cols = new Set(styles.keys())
    if (data) for (const c of Object.keys(data.values)) if (data.values[c] !== '') cols.add(c)
    const cells = [...cols].sort((a, b) => colToNum(a) - colToNum(b))
      .map(c => productCell(`${c}${r}`, styles.get(c), data ? data.values[c] : ''))
    return `${rowOpenTag((row || firstData).attrs, r)}${cells.join('')}</row>`
  })
  zip.file(tpl.product.path, pp.head + productRows.join('') + pp.tail, { createFolders: false })

  // payload_hidden: every row rebuilt by filling each column's formula down,
  // with the result Excel would compute stored as the cell's cached value.
  const pl = tpl.payload
  const ctx = evalContext(tpl, rows)
  const existing = new Map(pl.parts.rows.map(r => [r.r, r]))
  const firstPayload = pl.parts.rows.find(r => r.r >= pl.start)
  const payloadRows = []
  for (const row of pl.parts.rows) if (row.r < pl.start) payloadRows.push(row.xml)
  for (let p = pl.start; p <= pl.maxRow; p++) {
    const cells = pl.cols.map(pc => {
      let v
      try { v = ctx.payloadValue(p, pc.c) } catch (e) {
        if (!(e instanceof Unsupported)) throw e
        const note = `Hidden column ${pc.col} uses ${e.message}, which this tool can't calculate — open the file in Excel and press Save before uploading, so Excel fills it in`
        if (!tpl.notes.includes(note)) tpl.notes.push(note)
      }
      return [pc.c, payloadCell(`${pc.col}${p}`, pc.s, pc.render(p - pc.row), v)]
    })
    // Non-formula cells in these rows (if any) are kept as they were.
    for (const c of pl.others.get(p) || []) if (!pl.byNum.has(colToNum(c.col))) cells.push([colToNum(c.col), c.xml])
    cells.sort((a, b) => a[0] - b[0])
    payloadRows.push(`${rowOpenTag((existing.get(p) || firstPayload).attrs, p)}${cells.map(c => c[1]).join('')}</row>`)
  }
  zip.file(pl.path, pl.parts.head + payloadRows.join('') + pl.parts.tail, { createFolders: false })

  if (makeReport) {
    const tab = await addReportSheet(tpl)
    zip.file(tab.path, reportSheetXml(makeReport(), tab.styles), { createFolders: false })
  }

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

// ── Report tab ────────────────────────────────────────────────────────────────
// A visible "Report" sheet added after the template's own sheets (so their
// order and positions don't change): summary, removed duplicates, warnings.
const REPORT_SHEET = 'Report'

async function addReportSheet(tpl) {
  if (tpl.reportTab) return tpl.reportTab
  const { zip } = tpl
  const styles = await addReportStyles(zip)
  const existing = tpl.sheets.find(s => s.name.toLowerCase() === REPORT_SHEET.toLowerCase())
  if (existing) return (tpl.reportTab = { path: existing.path, styles })

  let n = 1
  while (zip.file(`xl/worksheets/sheet${n}.xml`)) n++
  const path = `xl/worksheets/sheet${n}.xml`
  const relsPath = 'xl/_rels/workbook.xml.rels'
  const rels = await zip.file(relsPath).async('string')
  let k = 1
  while (rels.includes(`Id="rId${k}"`)) k++
  zip.file(relsPath, rels.replace('</Relationships>',
    `<Relationship Id="rId${k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`), { createFolders: false })
  const types = await zip.file('[Content_Types].xml').async('string')
  zip.file('[Content_Types].xml', types.replace('</Types>',
    `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`), { createFolders: false })
  const sheetId = Math.max(0, ...[...tpl.workbookXml.matchAll(/<sheet\b[^>]*\bsheetId="(\d+)"/g)].map(m => +m[1])) + 1
  const ns = /<sheet\b[^>]*\s([\w]+):id="/.exec(tpl.workbookXml)?.[1] || 'r'
  tpl.workbookXml = tpl.workbookXml.replace('</sheets>', `<sheet name="${REPORT_SHEET}" sheetId="${sheetId}" ${ns}:id="rId${k}"/></sheets>`)

  // docProps/app.xml lists the visible sheet names — keep it in step.
  const app = await zip.file('docProps/app.xml')?.async('string')
  const titles = app && /(<TitlesOfParts>\s*<vt:vector size=")(\d+)("[^>]*>)([\s\S]*?)(<\/vt:vector>)/.exec(app)
  const count = app && /(<vt:lpstr>Worksheets<\/vt:lpstr><\/vt:variant>\s*<vt:variant>\s*<vt:i4>)(\d+)(<\/vt:i4>)/.exec(app)
  if (titles && count) {
    const next = app
      .replace(titles[0], () => `${titles[1]}${+titles[2] + 1}${titles[3]}${titles[4]}<vt:lpstr>${REPORT_SHEET}</vt:lpstr>${titles[5]}`)
      .replace(count[0], () => `${count[1]}${+count[2] + 1}${count[3]}`)
    zip.file('docProps/app.xml', next, { createFolders: false })
  }
  return (tpl.reportTab = { path, styles })
}

// Bold title / header / label cell styles, appended to the template's styles.
async function addReportStyles(zip) {
  const path = 'xl/styles.xml'
  let xml = await zip.file(path)?.async('string')
  const section = tag => new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`).exec(xml || '')
  const fonts = section('fonts'), fills = section('fills'), xfs = section('cellXfs')
  if (!fonts || !fills || !xfs) return {}
  const nFont = (fonts[2].match(/<font\b/g) || []).length
  const nFill = (fills[2].match(/<fill\b/g) || []).length
  const nXf = (xfs[2].match(/<xf\b/g) || []).length
  const grow = (tag, m, items, n) => {
    const attrs = /\bcount="\d+"/.test(m[1]) ? m[1].replace(/\bcount="\d+"/, `count="${n}"`) : `${m[1]} count="${n}"`
    return `<${tag}${attrs}>${m[2]}${items}</${tag}>`
  }
  xml = xml
    .replace(fonts[0], () => grow('fonts', fonts, '<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>', nFont + 2))
    .replace(fills[0], () => grow('fills', fills, '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FF"/><bgColor indexed="64"/></patternFill></fill>', nFill + 1))
    .replace(xfs[0], () => grow('cellXfs', xfs,
      `<xf numFmtId="0" fontId="${nFont}" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
      `<xf numFmtId="0" fontId="${nFont + 1}" fillId="${nFill}" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
      `<xf numFmtId="0" fontId="${nFont + 1}" fillId="0" borderId="0" xfId="0" applyFont="1"/>`, nXf + 3))
  zip.file(path, xml, { createFolders: false })
  return { title: nXf, head: nXf + 1, bold: nXf + 2 }
}

// rows: arrays of cells — a value, or { v, s: 'title' | 'head' | 'bold' }.
function reportSheetXml(rows, styles) {
  const body = rows.map((cells, i) => {
    const xml = cells.map((c, j) => {
      const { v, s } = c !== null && typeof c === 'object' ? c : { v: c }
      if (v === '' || v === null || v === undefined) return ''
      return productCell(`${numToCol(j + 1)}${i + 1}`, styles[s], typeof v === 'string' ? v.slice(0, 32000) : v)
    }).join('')
    return xml ? `<row r="${i + 1}">${xml}</row>` : ''
  }).join('')
  const widths = [16, 34, 22, 60, 11, 70]
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${body}</sheetData>` +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>'
}

function skuText(sku) {
  if (sku?.mode === 'replace') {
    return `Replace code: ${ruleList(sku.rules).filter(r => r.from && r.to).map(r => `${r.from} → ${r.to}`).join(', ')}`
  }
  return `Prefix: ${String(sku?.prefix || '').trim()}`
}

function reportRows({ built, sku, meta, notes, part, parts, partRows }) {
  const T = v => ({ v, s: 'title' }), H = v => ({ v, s: 'head' }), B = v => ({ v, s: 'bold' })
  const now = new Date(), p2 = n => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`
  const { duplicates, warnings } = built
  return [
    [T('Shop Duplicate — Report')],
    [],
    [B('Created'), stamp],
    meta.exportName && [B('Old seller export'), meta.exportName],
    meta.templateName && [B('Upload template'), meta.templateName],
    [B('New seller SKU'), skuText(sku)],
    [B('Rows read'), built.totalRead],
    [B('Duplicates removed'), duplicates.length],
    [B('Rows written'), built.rows.length],
    [B('Products'), new Set(built.rows.map(r => r.parent)).size],
    parts > 1 && [B('This file'), `Part ${part} of ${parts} — ${partRows.toLocaleString()} rows`],
    [B('Warnings'), warnings.length],
    ...notes.map(n => [B('Note'), n]),
    [],
    [T(`Duplicates removed (${duplicates.length})`)],
    ['The first row of each Seller SKU was kept; these later rows with the same Seller SKU were left out.'],
    [H('Export Row'), H('Seller SKU'), H('Parent SKU'), H('Product Name'), H('Kept Row'), H('Difference from kept row')],
    ...(duplicates.length ? duplicates.map(d => [d.row, d.sku, d.parent, d.name, d.keptRow, d.difference]) : [['None']]),
    [],
    [T(`Warnings (${warnings.length})`)],
    [H('Export Row'), H('Seller SKU'), H('Field'), H('Issue')],
    ...(warnings.length ? warnings.map(w => [w.row, w.sku, w.field, w.message]) : [['None — every Brand, Unit, Color and Size matched the template\'s lists']]),
  ].filter(Boolean)
}

// Full pipeline: returns one or more filled templates plus a report.
// sku: { mode: 'replace', rules: [{ from, to }] } or { mode: 'prefix', prefix }.
// reportTab adds a "Report" sheet to each file; meta: { exportName, templateName } for it.
export async function duplicateShop({ exportData, templateData, sku, reportTab = true, meta = {}, onProgress: report = () => {} }) {
  const skuError = skuOptionsError(sku)
  if (skuError) throw new Error(skuError)
  // Yield after each message so the browser can paint it before the next heavy step.
  const onProgress = async msg => { report(msg); await new Promise(r => setTimeout(r, 0)) }
  await onProgress('Reading seller export…')
  const exportRows = readSellerExport(exportData)
  await onProgress('Reading upload template…')
  const tpl = await loadTemplate(templateData)
  await onProgress('Mapping products…')
  const built = buildRows(exportRows, tpl, sku)
  if (!built.rows.length) throw new Error('No products to copy')
  const chunks = chunkRows(built.rows, tpl.capacity)
  const files = []
  for (let i = 0; i < chunks.length; i++) {
    await onProgress(chunks.length > 1 ? `Writing file ${i + 1} of ${chunks.length}…` : 'Writing upload file…')
    const makeReport = reportTab
      ? () => reportRows({ built, sku, meta, notes: tpl.notes, part: i + 1, parts: chunks.length, partRows: chunks[i].length })
      : null
    files.push({ rows: chunks[i].length, bytes: await writeTemplate(tpl, chunks[i], makeReport) })
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
      notes: tpl.notes,
    },
  }
}

export async function zipFiles(files, baseName) {
  const out = new JSZip()
  files.forEach((f, i) => out.file(`${baseName}_part${i + 1}.xlsx`, f.bytes))
  return out.generateAsync({ type: 'uint8array', compression: 'STORE' })
}
