// What a Daraz output is checked for before upload. The page's check list,
// the sheet view's filters and the review window all count from here, so a
// number means the same thing everywhere.
import { headerKey, colLabel, colGroup } from './variantReview'

export const WEIGHT_COL = '**Package Weight (kg)'
export const IMAGE_COLS = ['**Product Image 1', 'Product Image 2', 'Product Image 3', 'Product Image 4',
  'Product Image 5', 'Product Image 6', 'Product Image 7', 'Product Image 8', '*Variant Image']

// Cell problems in the sheet, by type. error = the upload would reject or
// break the row; warn = flagged, worth a look.
export const ISSUE_TYPES = {
  list:     { label: 'Not on CartUp list (#N/A)', level: 'error' },
  category: { label: 'No category', level: 'error' },
  required: { label: 'Required — empty', level: 'error' },
  noimage:  { label: 'No Image 1 / variant image (left out)', level: 'error' },
  weight:   { label: 'Weight to check (0.00x)', level: 'warn' },
  image:    { label: 'Image without a CartUp key (not uploaded)', level: 'warn' },
  price:    { label: 'Special price not below the price', level: 'warn' },
  flag:     { label: 'Other flags', level: 'warn' },
}

// Map "row|column" → { level, type, text } for every problem cell.
export function sheetIssues(output, columns, lists) {
  const m = new Map()
  const flagged = new Map(output.problems.map(p => [`${p.row}|${p.column}`, p.problem]))
  const set = (k, type, text) => m.set(k, { level: ISSUE_TYPES[type].level, type, text })
  output.rows.forEach((r, i) => {
    for (const c of columns) {
      const v = String(r[c] ?? '').trim()
      const list = lists?.[headerKey(c)]
      const k = `${i}|${c}`
      if (c === '**Category Id' && !v) set(k, 'category', 'No CartUp category — add the Category Id')
      else if ((c === '**Product Image 1' || c === '*Variant Image') && !v) set(k, 'noimage', flagged.get(k) || 'No image — row left out')
      else if (c.startsWith('**') && !v) set(k, 'required', 'Required — empty')
      else if (v && list && list.match(v)?.how !== 'exact') set(k, 'list', `Not on CartUp's ${colLabel(c)} list — shows #N/A`)
      else if (flagged.has(k)) set(k, c === WEIGHT_COL ? 'weight' : IMAGE_COLS.includes(c) ? 'image' : c === 'Special Price' ? 'price' : 'flag', flagged.get(k))
    }
  })
  return m
}

// The check list: each thing to look at before uploading, how many, why it
// matters and where it is fixed.
//   level: fix (blocks a clean upload) · check (worth a look) · info
//   open:  { review: { view, state, col } } or { sheet: type } — the view to open
export function buildChecklist({ result, output, issues, values, imageKeys }) {
  const byType = {}
  for (const v of issues.values()) byType[v.type] = (byType[v.type] || 0) + 1
  const open = g => values.filter(v => v.status === 'open' && colGroup(v.col) === g)
  const skus = vs => { const n = vs.reduce((t, v) => t + v.open, 0); return `${n.toLocaleString()} SKU${n === 1 ? '' : 's'}` }
  const items = []
  const add = it => items.push({ count: 0, ...it })

  if (result.template) {
    const variant = open('variant'), brand = open('brand'), warranty = open('warranty'), other = open('other')
    add({ id: 'variant', level: 'fix', count: variant.length, unit: 'value', extra: variant.length ? skus(variant) : '',
      title: 'Variant values not on CartUp lists', why: 'Color, Size… that would show #N/A — pick a match or keep as a new value',
      open: { review: { view: 'values', state: 'open', col: 'g:variant' } } })
    add({ id: 'brand', level: 'fix', count: brand.length, unit: 'brand', extra: brand.length ? skus(brand) : '',
      title: 'Brands not on CartUp list', why: 'Pick the right brand, use No Brand, or keep as a new brand for CartUp to add',
      open: { review: { view: 'values', state: 'open', col: 'g:brand' } } })
    add({ id: 'warranty', level: 'fix', count: warranty.length, unit: 'value', extra: warranty.length ? skus(warranty) : '',
      title: 'Warranty values not on CartUp lists', why: 'Pick the period/type, set No Warranty, or keep as new',
      open: { review: { view: 'values', state: 'open', col: 'g:warranty' } } })
    if (other.length) add({ id: 'other', level: 'fix', count: other.length, unit: 'value', extra: skus(other),
      title: 'Other values not on CartUp lists', why: 'Materials, unit… — pick a match or keep as new',
      open: { review: { view: 'values', state: 'open', col: 'g:other' } } })
    add({ id: 'dupes', level: 'fix', count: output.stats.dupes, unit: 'SKU',
      title: 'Variants with the same values', why: 'SKUs of one Parent SKU must differ — change one value (e.g. Multicolor-1, -2)',
      open: { review: { view: 'products', state: 'dupes', col: 'all' } } })
  }
  add({ id: 'category', level: 'fix', count: byType.category || 0, unit: 'row',
    title: 'Rows without a CartUp category', why: 'The Daraz category had no match — fill in the Category Id',
    open: { sheet: 'category' } })
  add({ id: 'required', level: 'fix', count: byType.required || 0, unit: 'cell',
    title: 'Required cells empty', why: 'Brand, unit, package size, stock, price… the upload needs them',
    open: { sheet: 'required' } })
  if (output.excluded?.size || result.items.some(it => it.pendingVariant)) add({ id: 'noimage', level: 'fix', count: output.excluded?.size || 0, unit: 'row',
    title: 'Rows without Image 1 or a variant image', why: imageKeys
      ? 'No CartUp image key for Image 1 or the Variant Image — add the key (key file or sheet), or the row goes to the "invalid" sheet'
      : 'Colour variants not in the SKU Image file — add an image key file with a Variant Image column, or paste a key in the sheet; until then they go to the "invalid" sheet',
    open: { sheet: 'noimage' } })
  if (result.template) {
    const fuzzy = values.filter(v => v.status === 'changed' && v.how === 'similar')
    const changed = values.filter(v => v.status === 'changed')
    add({ id: 'fuzzy', level: 'check', count: fuzzy.length, unit: 'value', extra: changed.length ? `${changed.length} matched automatically in all` : '',
      title: 'Close-spelling matches', why: 'Matched by similar spelling — a quick glance confirms them',
      open: { review: { view: 'values', state: 'changed', col: 'all' } } })
  }
  add({ id: 'weight', level: 'check', count: byType.weight || 0, unit: 'row',
    title: 'Weight starts with 0.00', why: '0.001–0.009 kg (or 0) — CartUp may show a delivery charge of 0',
    open: { sheet: 'weight' } })
  if (output.rules.spNotBelow) add({ id: 'spprice', level: 'check', count: output.rules.spNotBelow, unit: 'row',
    title: 'Special price not below the price', why: 'CartUp may reject it — fix the price or the special price (or leave special price out)',
    open: { sheet: 'price' } })
  if (imageKeys) add({ id: 'image', level: 'check', count: byType.image || 0, unit: 'image',
    title: 'Images without a CartUp key', why: (imageKeys.forItem && output.rules.keyRowsMissing
      ? `${output.rules.keyRowsMissing.toLocaleString()} Seller SKU${output.rules.keyRowsMissing === 1 ? ' is' : 's are'} not in the image key file — `
      : 'Not in the image key file — ') + 'those images are not uploaded (a row without Image 1 or a variant image is left out)',
    open: { sheet: 'image' } })
  if (result.ai?.missed) {
    const m = result.ai.message || ''
    const reason = /limit is used/i.test(m) ? "today's Gemini limit was used up" : /at their limit/i.test(m) ? 'every key was at its limit' : m.slice(0, 80) || 'no answer'
    add({ id: 'ai', level: 'check', count: result.ai.missed, unit: 'product',
      title: 'Names not cleaned by AI', why: `AI unavailable (${reason}) — these got the spelling rules only; check the names`,
      open: { sheet: 'name' } })
  }
  if (result.template) {
    const kept = values.filter(v => v.status === 'kept')
    if (kept.length) add({ id: 'kept', level: 'info', count: kept.length, unit: 'value', extra: (n => `${n.toLocaleString()} SKU${n === 1 ? '' : 's'}`)(kept.reduce((n, v) => n + v.kept, 0)),
      title: 'Kept as new values', why: 'In the "new values" sheet — CartUp adds them to its lists, or they show #N/A',
      open: { review: { view: 'values', state: 'kept', col: 'all' } } })
  }
  if (output.rules.stockZero) add({ id: 'stock0', level: 'info', count: output.rules.stockZero, unit: 'row',
    title: 'Rows with 0 stock', why: output.rules.stockSet ? 'Stock set for every row by the Stock option' : 'They upload as out of stock — fine when the seller wants it; otherwise set the stock (Stock option or sheet)',
    open: { sheet: 'stock0' } })
  if (result.invalidRows.length) add({ id: 'invalid', level: 'info', count: result.invalidRows.length, unit: 'row',
    title: 'Rows left out', why: 'Missing Product ID, Seller SKU, name, price or image — listed in the "invalid" sheet with the reason, not in the upload' })
  return items
}
