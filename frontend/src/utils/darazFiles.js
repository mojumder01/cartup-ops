// Reading and checking the Daraz export files — once, when each file is picked.
// Every file is checked on its own (is it the right file for its box? are the
// columns there? how many rows, products, SKUs?) and against the others (do
// their Product IDs and Seller SKUs meet up?), so a wrong or incomplete file
// shows up before processing instead of as missing images or weights later.
// Processing reuses the rows read here.
import * as XLSX from 'xlsx'

// What each box expects. `need`: columns the processing reads (a file without
// them can't be used); `price`: one of these is the price; `marks`: columns
// that tell this kind of file apart from the others; `use`: every column the
// processing reads (the file preview highlights them).
export const DARAZ_FILES = {
  price: {
    label: 'Price / Stock', need: ['Product ID', 'SellerSKU', '*Product Name(English)'], price: ['*Price', '**Price(MRP)', 'Price'],
    marks: ['*Price', '*Quantity', 'SpecialPrice', 'catId', 'status', '*Product Name(English)'],
    use: ['Product ID', 'SellerSKU', 'catId', '*Product Name(English)', 'Variations Combo', 'status', '*Price', '**Price(MRP)', 'Price', '*Quantity',
      'SpecialPrice', 'Special Price', 'SpecialPrice Start', 'Special Price Start Date', 'SpecialPrice End', 'Special Price End Date'],
  },
  basic: {
    label: 'Basic', need: ['Product ID', '*Product Images1'],
    marks: ['*Highlights', 'Main Description', '*Product Images1', 'Product Images2', 'Warranty Policy', '*Warranty Type'],
    use: ['Product ID', '*Product Images1', ...[2, 3, 4, 5, 6, 7, 8].map(n => `Product Images${n}`), '*Highlights', 'Highlights', 'Main Description',
      'Warranty Policy', '*Warranty Type', 'Warranty Type', 'Warranty'],
  },
  weight: {
    label: 'Weight', need: ['Product ID', '*Package Weight (kg)'],
    marks: ['*Package Weight (kg)', '*Package Length (cm)', '*Package Width (cm)', '*Package Height (cm)'],
    use: ['Product ID', 'SellerSKU', '*Package Weight (kg)', '*Package Length (cm)', '*Package Width (cm)', '*Package Height (cm)'],
  },
  skuimg: {
    label: 'SKU Image', need: ['SellerSKU', 'Images1'],
    marks: ['Images1', 'Images2', 'Images3'],
    use: ['SellerSKU', 'Images1'],
  },
  attr: { label: 'Attribute', need: ['Product ID'], marks: [], use: ['Product ID', 'Brand', 'ISBN/ISSN'] },
}
export const REQUIRED_FILES = ['price', 'basic', 'weight', 'skuimg']

const trimKeys = rows => rows.map(r => {
  const o = {}
  for (const [k, v] of Object.entries(r)) o[String(k).trim()] = v
  return o
})
const text = v => (v === undefined || v === null ? '' : String(v).trim())
// A cell's value, where 0 is a value (stock 0, price 0), not "empty".
export const cell = (row, ...keys) => {
  for (const k of keys) { const v = text(row?.[k]); if (v !== '') return v }
  return ''
}

// The header row of a sheet: the first of its first rows that has a column we
// look for (Daraz puts it on row 1; a title or "instructions" row may come first).
function headerRowOf(ws, mustHave) {
  if (!ws?.['!ref']) return { row: 0, heads: [] }
  const range = XLSX.utils.decode_range(ws['!ref'])
  range.e.r = Math.min(range.e.r, range.s.r + 5)
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', range, blankrows: true })
  for (let i = 0; i < aoa.length; i++) {
    const heads = aoa[i].map(h => String(h).trim())
    if (mustHave.some(c => heads.includes(c))) return { row: range.s.r + i, heads }
  }
  return { row: range.s.r, heads: (aoa[0] || []).map(h => String(h).trim()) }
}
const sheetRows = (ws, headerRow) => trimKeys(XLSX.utils.sheet_to_json(ws, { defval: '', range: headerRow }))

// How much a set of columns looks like each kind of file.
function kindScores(heads) {
  const has = c => heads.includes(c)
  const out = {}
  for (const [kind, spec] of Object.entries(DARAZ_FILES)) {
    if (kind === 'attr') continue
    out[kind] = spec.marks.filter(has).length * 2 + spec.need.filter(has).length
  }
  return out
}
const bestKind = heads => Object.entries(kindScores(heads)).sort((a, b) => b[1] - a[1])[0]

function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => { try { resolve(XLSX.read(e.target.result, { type: 'array' })) } catch (err) { reject(err) } }
    reader.onerror = () => reject(reader.error || new Error('The file could not be read'))
    reader.readAsArrayBuffer(file)
  })
}

// → { kind, sheet, columns, rows, issues: [{ level: 'error' | 'warn', text }], stats }
async function readOne(file, kind) {
  const spec = DARAZ_FILES[kind]
  const issues = []
  const error = t => issues.push({ level: 'error', text: t })
  const warn = t => issues.push({ level: 'warn', text: t })
  let wb
  try { wb = await readWorkbook(file) } catch (e) {
    return { kind, sheet: '', columns: [], rows: [], issues: [{ level: 'error', text: `Not a readable Excel/CSV file (${e.message})` }], stats: {} }
  }

  // CartUp's own upload template (or a filled-in output) in a Daraz box.
  if (wb.SheetNames.some(n => /^(payload_hidden|value_hidden)$/i.test(n))) {
    return { kind, sheet: '', columns: [], rows: [], issues: [{ level: 'error', text: 'This is the CartUp upload template, not a Daraz export — put it in the "CartUp upload template" box' }], stats: {} }
  }

  if (kind === 'attr') {
    // One sheet per category; the header is on the second row ("instructions" first).
    const rows = [], brandCols = new Set()
    for (const name of wb.SheetNames) {
      if (name === 'INDEX') continue
      const ws = wb.Sheets[name]
      const { row, heads } = headerRowOf(ws, ['Product ID'])
      if (!heads.includes('Product ID')) continue
      const brand = heads.find(h => h === '*Brand') || heads.find(h => h === 'Brand') || heads.find(h => /brand/i.test(h))
      const isbn = heads.find(h => /isbn|issn/i.test(h))   // books: CartUp's ISBN/ISSN column
      if (brand) brandCols.add(brand)
      for (const r of sheetRows(ws, row)) rows.push({ pid: text(r['Product ID']), brand: brand ? text(r[brand]) : '', isbn: isbn ? text(r[isbn]) : '' })
    }
    const withPid = rows.filter(r => r.pid)
    if (!withPid.length) error('No sheet with a "Product ID" column — is this the Attribute export?')
    else if (!brandCols.size) warn('No Brand column found — every product will be No Brand')
    return { kind, sheet: '', columns: [...brandCols], rows: withPid, issues,
      stats: { products: new Set(withPid.map(r => r.pid)).size, withBrand: new Set(withPid.filter(r => r.brand).map(r => r.pid)).size, withIsbn: new Set(withPid.filter(r => r.isbn).map(r => r.pid)).size } }
  }

  // The sheet: "template" (as Daraz exports it), else the one that fits this kind best.
  const must = [...spec.need, ...(spec.price || [])]
  const candidates = wb.SheetNames.map(name => ({ name, ...headerRowOf(wb.Sheets[name], must) }))
  const pick = candidates.find(c => c.name === 'template' && must.some(m => c.heads.includes(m)))
    || [...candidates].sort((a, b) => (kindScores(b.heads)[kind] || 0) - (kindScores(a.heads)[kind] || 0))[0]
  if (!pick) return { kind, sheet: '', columns: [], rows: [], issues: [{ level: 'error', text: 'The file has no sheets' }], stats: {} }
  const columns = pick.heads.filter(Boolean)
  const rows = sheetRows(wb.Sheets[pick.name], pick.row).filter(r => Object.values(r).some(v => text(v) !== ''))

  // Is it the right file for this box?
  const [likely, score] = bestKind(columns)
  const ownScore = kindScores(columns)[kind] || 0
  if (likely !== kind && score > ownScore + 1) {
    // The wrong file: say so, and nothing else (its "missing" rows would only confuse).
    error(`This looks like the ${DARAZ_FILES[likely].label} file — put it in the ${DARAZ_FILES[likely].label} box`)
    return { kind, sheet: pick.name, columns, rows, issues, stats: { rows: rows.length } }
  }
  const missing = spec.need.filter(c => !columns.includes(c))
  if (spec.price && !spec.price.some(c => columns.includes(c))) missing.push('*Price')
  if (missing.length) error(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`)
  if (!rows.length) error('No product rows in the file')

  const stats = { rows: rows.length }
  if (columns.includes('Product ID')) stats.products = new Set(rows.map(r => text(r['Product ID'])).filter(Boolean)).size
  if (columns.includes('SellerSKU')) stats.skus = new Set(rows.map(r => text(r['SellerSKU'])).filter(Boolean)).size
  if (kind === 'price') {
    stats.active = rows.filter(r => text(r.status).toLowerCase() === 'active').length
    stats.noPid = rows.filter(r => !text(r['Product ID'])).length
    stats.noSku = rows.filter(r => !text(r.SellerSKU)).length
    const seen = new Set(); let dup = 0
    for (const r of rows) { const s = text(r.SellerSKU); if (s && seen.has(s)) dup++; seen.add(s) }
    stats.dupSkus = dup
    stats.noPrice = rows.filter(r => !cell(r, ...spec.price)).length
    stats.noName = rows.filter(r => !text(r['*Product Name(English)'])).length
    if (stats.noPid) warn(`${stats.noPid} row${stats.noPid > 1 ? 's' : ''} without Product ID — they go to the "invalid" sheet`)
    if (stats.noSku) warn(`${stats.noSku} row${stats.noSku > 1 ? 's' : ''} without Seller SKU — they go to the "invalid" sheet`)
    if (dup) warn(`${dup} repeated Seller SKU row${dup > 1 ? 's' : ''} — only the first of each is kept`)
    if (stats.noPrice) warn(`${stats.noPrice} row${stats.noPrice > 1 ? 's' : ''} without a price — they go to the "invalid" sheet`)
    if (stats.noName) warn(`${stats.noName} row${stats.noName > 1 ? 's' : ''} without a product name — they go to the "invalid" sheet`)
  }
  if (kind === 'basic') {
    stats.noImage = rows.filter(r => !text(r['*Product Images1'])).length
    if (stats.noImage) warn(`${stats.noImage} product${stats.noImage > 1 ? 's' : ''} without Product Image 1 — kept and flagged (add the image, or an image key file)`)
  }
  if (kind === 'weight') {
    stats.noWeight = rows.filter(r => !text(r['*Package Weight (kg)'])).length
    if (stats.noWeight) warn(`${stats.noWeight} row${stats.noWeight > 1 ? 's' : ''} without a package weight — left out of the upload unless the weight is typed in the sheet`)
  }
  return { kind, sheet: pick.name, columns, rows, issues, stats }
}

// Each picked file is read once; processing reuses the result.
const cache = new WeakMap()
export function readDarazFile(file, kind) {
  const k = `${kind}`
  let byKind = cache.get(file)
  if (!byKind) cache.set(file, byKind = {})
  if (!byKind[k]) byKind[k] = readOne(file, kind)
  return byKind[k]
}
// The rows of a file for processing — or a clear error naming the file.
export async function darazRows(file, kind) {
  const r = await readDarazFile(file, kind)
  const bad = r.issues.find(i => i.level === 'error')
  if (bad) throw new Error(`${DARAZ_FILES[kind].label} file (${file.name}): ${bad.text}`)
  return r.rows
}

// The files against each other: Product IDs and Seller SKUs that don't meet up.
// files: { kind: File }, read: { kind: readDarazFile result }
// → [{ level: 'error' | 'warn' | 'ok', text, sample? }]
export function crossCheck(files, read) {
  const out = []
  const ids = (r, col) => new Set((r?.rows || []).map(x => text(x[col])).filter(Boolean))
  const sample = set => [...set].slice(0, 5).join(', ') + (set.size > 5 ? ` … +${set.size - 5}` : '')
  const minus = (a, b) => new Set([...a].filter(x => !b.has(x)))
  const ok = k => read[k] && !read[k].issues.some(i => i.level === 'error')

  // The same file in two boxes.
  const seen = new Map()
  for (const [k, f] of Object.entries(files)) {
    if (!f || k === 'template') continue
    const id = `${f.name}|${f.size}|${f.lastModified}`
    if (seen.has(id)) out.push({ level: 'error', text: `The same file (${f.name}) is in both the ${DARAZ_FILES[seen.get(id)].label} and ${DARAZ_FILES[k].label} boxes` })
    else seen.set(id, k)
  }
  if (!ok('price')) return out
  const pricePids = ids(read.price, 'Product ID'), priceSkus = ids(read.price, 'SellerSKU')

  if (ok('basic')) {
    const basicPids = ids(read.basic, 'Product ID')
    const lost = minus(pricePids, basicPids)
    const shared = pricePids.size - lost.size
    if (pricePids.size && shared / pricePids.size < 0.5) out.push({ level: 'error', text: `Price and Basic files look like different exports — only ${shared} of ${pricePids.size} products are in both. Export them again from the same shop.` })
    else if (lost.size) out.push({ level: 'warn', text: `${lost.size} product${lost.size > 1 ? 's' : ''} in the Price file but not in the Basic file — no image or description (kept and flagged)`, sample: sample(lost) })
    else out.push({ level: 'ok', text: `Basic file covers all ${pricePids.size.toLocaleString()} products` })
  }
  if (ok('weight')) {
    const lost = minus(pricePids, ids(read.weight, 'Product ID'))
    if (lost.size) out.push({ level: 'warn', text: `${lost.size} product${lost.size > 1 ? 's' : ''} without a row in the Weight file — no weight, so they are left out unless the weight is typed in the sheet`, sample: sample(lost) })
    else out.push({ level: 'ok', text: 'Weight file covers all products' })
  }
  if (ok('skuimg')) {
    const lost = minus(priceSkus, ids(read.skuimg, 'SellerSKU'))
    if (priceSkus.size && lost.size === priceSkus.size) out.push({ level: 'error', text: 'None of the Seller SKUs in the Price file are in the SKU Image file — is it from another export?' })
    else if (lost.size) out.push({ level: 'warn', text: `${lost.size} Seller SKU${lost.size > 1 ? 's' : ''} without a row in the SKU Image file — the variant image falls back to Product Image 1 (a colour variant without one is flagged — add it, or use an image key file)`, sample: sample(lost) })
    else out.push({ level: 'ok', text: 'SKU Image file covers all Seller SKUs' })
  }
  if (read.attr && ok('attr')) {
    const withBrand = new Set(read.attr.rows.filter(r => r.brand).map(r => r.pid))
    const covered = [...pricePids].filter(p => withBrand.has(p)).length
    if (!covered && pricePids.size) out.push({ level: 'warn', text: 'No product of the Price file has a brand in the Attribute file — is it from another export? Every product will be No Brand' })
    else out.push({ level: covered < pricePids.size ? 'warn' : 'ok', text: `Brand found for ${covered.toLocaleString()} of ${pricePids.size.toLocaleString()} products${covered < pricePids.size ? ' — the rest are No Brand' : ''}` })
  } else if (!files.attr) out.push({ level: 'warn', text: 'No Attribute file — every product will be No Brand' })
  return out
}
