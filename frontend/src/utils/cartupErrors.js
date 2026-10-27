// CartUp's upload error report ("detailed-errors_….xlsx"): which rows CartUp
// rejected and why. "Duplicate Seller SKUs: SellerSKU X already exists" and
// "Duplicate Parent SKUs: ParentSKU P already exists" mean CartUp already has
// that product (often from an earlier, partly accepted upload of the same
// file): Daraz Upload leaves those rows out of the next file instead of
// uploading a second copy. Every other error is kept to show with advice.
import * as XLSX from 'xlsx'

const text = v => (v === undefined || v === null ? '' : String(v).trim())
const SKU_EXISTS = /SellerSKU\s+(.+?)\s+already exists/i
const PARENT_EXISTS = /ParentSKU\s+(.+?)\s+already exists/i

// What to do about each kind of error, in a line.
export const ERROR_ADVICE = {
  'Duplicate Seller SKUs': 'Already on CartUp — left out of the next file',
  'Duplicate Parent SKUs': 'Already on CartUp — left out of the next file',
  'Duplicate Variant Combinations': 'Two SKUs of the product reached CartUp with the same variant values — open the product in Check & match values and make them differ',
  'Variant_attribute_mapping_error': 'A variant attribute the category needs was empty — filled by rule since v25.6.89 (Age Group = One Size); process the files again',
  'Invalid Variant Attributes': 'A variant attribute the category needs was empty — filled by rule since v25.6.89; process the files again',
  'Validation Errors': 'A special price not below the price — removed since v25.6.89; process the files again',
  'Max Retries Exceeded': 'A hiccup on CartUp\'s side — these rows go in the next file again',
}

// → { name, skus: Set, parents: Set, other: [{ row, parent, type, detail }], counts: { type: n } }
export async function readCartupErrors(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const skus = new Set(), parents = new Set(), other = [], counts = {}
  const add = (row, parent, type, detail) => {
    type = text(type); detail = text(detail).replace(/^•\s*/, '')
    if (!type) return
    counts[type] = (counts[type] || 0) + 1
    const s = SKU_EXISTS.exec(detail), p = PARENT_EXISTS.exec(detail)
    if (/duplicate seller sku/i.test(type)) { const v = s ? s[1] : detail; if (v) skus.add(text(v)) }
    else if (/duplicate parent sku/i.test(type)) { const v = p ? p[1] : parent; if (v) parents.add(text(v)) }
    else other.push({ row: text(row), parent: text(parent), type, detail })
  }
  const all = wb.Sheets['All Errors']
  if (all) {
    // Row Number · Parent SKU · Full Error Message ("Type: detail | Type: detail")
    for (const r of XLSX.utils.sheet_to_json(all, { header: 1, defval: '' }).slice(1)) {
      if (!text(r[2])) continue
      for (const part of String(r[2]).split(/\s+\|\s+/)) {
        const k = part.indexOf(':')
        add(r[0], r[1], k > 0 ? part.slice(0, k) : 'Error', k > 0 ? part.slice(k + 1) : part)
      }
    }
  } else {
    // One sheet per kind: a title row, then Row Number · Parent SKU · Error Details.
    for (const name of wb.SheetNames.filter(n => !/^summary$/i.test(n))) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })
      const head = rows.findIndex(r => /row number/i.test(text(r[0])))
      if (head < 0) continue
      for (const r of rows.slice(head + 1)) if (text(r[0]) || text(r[2])) add(r[0], r[1], name, r[2])
    }
  }
  if (!Object.keys(counts).length) throw new Error('Not a CartUp error report — expected an "All Errors" sheet (Row Number, Parent SKU, Full Error Message)')
  return { name: file.name, skus, parents, other, counts }
}

// Several reports together (one per upload of the shop).
export function mergeCartupErrors(reports) {
  const out = { names: [], skus: new Set(), parents: new Set(), other: [], counts: {} }
  for (const r of reports) {
    out.names.push(r.name)
    r.skus.forEach(s => out.skus.add(s)); r.parents.forEach(p => out.parents.add(p))
    out.other.push(...r.other)
    for (const [k, n] of Object.entries(r.counts)) out.counts[k] = (out.counts[k] || 0) + n
  }
  return out
}
