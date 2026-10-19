// What a Daraz output is checked for before upload. The page's check list,
// the sheet view's filters and the review window all count from here, so a
// number means the same thing everywhere.
import { headerKey, colLabel, colGroup } from './variantReview'

export const IMAGE_COLS = ['**Product Image 1', 'Product Image 2', 'Product Image 3', 'Product Image 4',
  'Product Image 5', 'Product Image 6', 'Product Image 7', 'Product Image 8', '*Variant Image']

// Cell problems in the sheet, by type. error = the upload would reject or
// break the row; warn = flagged, worth a look.
export const ISSUE_TYPES = {
  list:     { label: 'Not on CartUp list (#N/A)', level: 'error' },
  category: { label: 'No category', level: 'error' },
  required: { label: 'Required — empty', level: 'error' },
  numbered: { label: 'Variants told apart by a number (Multicolor-1…)', level: 'error' },
  leftout:  { label: 'Left out — no weight / no image key', level: 'error' },
  noimage:  { label: 'Image missing (row kept)', level: 'warn' },
  spremoved:{ label: 'Special price removed (75–99% discount)', level: 'warn' },
  price:    { label: 'Special price not below the price', level: 'warn' },
  defaults: { label: 'Set by rule (Not Specified / One Size)', level: 'warn' },
  marked:   { label: 'Marked "Yes" (combo not matched)', level: 'warn' },
  flag:     { label: 'Other flags', level: 'warn' },
}

// Map "row|column" → { level, type, text } for every problem cell.
export function sheetIssues(output, columns, lists, items = null) {
  const m = new Map()
  // Variant values set by rule (Same as picture, One Size), per cell.
  const filled = items && new Set(items.flatMap((it, i) => (it.cells || []).filter(c => c.source === 'fill' && String(output.rows[i]?.[c.col] ?? '') === (c.auto ?? c.raw)).map(c => `${i}|${c.col}`)))
  const marked = items && new Set(items.flatMap((it, i) => (it.cells || []).filter(c => c.source === 'mark' && String(output.rows[i]?.[c.col] ?? '') === 'Yes').map(c => `${i}|${c.col}`)))
  const flagged = new Map(output.problems.map(p => [`${p.row}|${p.column}`, p]))
  const set = (k, type, text) => m.set(k, { level: ISSUE_TYPES[type].level, type, text })
  output.rows.forEach((r, i) => {
    if (output.deletedRows?.has(i)) return   // deleted in the sheet view: not in the upload
    for (const c of columns) {
      const v = String(r[c] ?? '').trim()
      const list = lists?.[headerKey(c)]
      const k = `${i}|${c}`
      const f = flagged.get(k)
      if (f?.type) set(k, f.type, f.problem)
      else if (marked?.has(k)) set(k, 'marked', '"Yes": the category needs this variant column (Variations Combo not matched) — not on CartUp\'s list, the hidden sheet shows #N/A')
      else if (c === '**Category Id' && !v) set(k, 'category', 'No CartUp category — add the Category Id')
      else if (c.startsWith('**') && !v) set(k, 'required', 'Required — empty')
      else if (v && list && list.match(v)?.how !== 'exact') set(k, 'list', `Not on CartUp's ${colLabel(c)} list — shows #N/A`)
      else if (f) set(k, c === 'Special Price' ? 'price' : 'flag', f.problem)
      else if (filled?.has(`${i}|${c}`)) set(k, 'defaults', 'Not given — set by rule because the category needs it; check it')
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
  if (byType.numbered) add({ id: 'numbered', level: 'fix', count: byType.numbered, unit: 'SKU',
    title: 'Variants told apart only by a number', why: 'Multicolor-1, -2…: the seller\'s variants differ by something CartUp has no column for (e.g. "Vitamin C", "tea tree") — check each, or pick a real value',
    open: { sheet: 'numbered' } })
  add({ id: 'leftout', level: 'fix', count: output.excluded?.size || 0, unit: 'row',
    title: 'Rows left out of the upload', why: imageKeys
      ? 'No package weight, no product image with a CartUp key, or no key for the Variant Image — type it in the sheet to keep the row; otherwise it goes to the "invalid" sheet'
      : 'No package weight — type it in the sheet to keep the row; otherwise it goes to the "invalid" sheet',
    open: { sheet: 'leftout' } })
  if (byType.noimage) add({ id: 'noimage', level: 'check', count: byType.noimage, unit: 'image',
    title: 'Images missing (rows kept)', why: 'No Image 1 (not in the Basic file) or no variant image (colour variant not in the SKU Image file) — add it, or load an image key file',
    open: { sheet: 'noimage' } })
  if (result.template) {
    const fuzzy = values.filter(v => v.status === 'changed' && v.how === 'similar')
    const changed = values.filter(v => v.status === 'changed')
    add({ id: 'fuzzy', level: 'check', count: fuzzy.length, unit: 'value', extra: changed.length ? `${changed.length} matched automatically in all` : '',
      title: 'Close-spelling matches', why: 'Matched by similar spelling — a quick glance confirms them',
      open: { review: { view: 'values', state: 'changed', col: 'all' } } })
  }
  if (byType.marked) add({ id: 'marked', level: 'check', count: byType.marked, unit: 'value',
    title: 'Variant columns marked "Yes"', why: 'Variations Combo option "Mark Yes": the columns the category needs say Yes — "Yes" isn\'t on CartUp\'s lists, so the hidden sheet shows #N/A for them',
    open: { sheet: 'marked' } })
  if (byType.defaults) add({ id: 'defaults', level: 'check', count: byType.defaults, unit: 'value',
    title: 'Variant values set by rule', why: 'The category needs Color / Model / Size but the seller gave none — set to Not Specified (Color), Same as picture (Model), One Size (sizes); Check = YES and Report say so',
    open: { sheet: 'defaults' } })
  if (output.rules.spNotBelow) add({ id: 'spprice', level: 'check', count: output.rules.spNotBelow, unit: 'row',
    title: 'Special price not below the price', why: 'CartUp may reject it — fix the price or the special price (or leave special price out)',
    open: { sheet: 'price' } })
  if (result.ai?.missed) {
    const m = result.ai.message || ''
    const reason = /limit is used/i.test(m) ? "today's Gemini limit was used up" : /at their limit/i.test(m) ? 'every key was at its limit' : m.slice(0, 80) || 'no answer'
    add({ id: 'ai', level: 'check', count: result.ai.missed, unit: 'product',
      title: result.ai.name === false ? 'Products not cleaned by AI' : 'Names not cleaned by AI',
      why: `AI unavailable (${reason}) — these got the local clean-up only; check the ${(f => ['name', 'highlights', 'description'].filter(k => f[k]).map(k => k === 'name' ? 'names' : k === 'description' ? 'descriptions' : k).join(', ') || 'names')(result.ai.fields || { name: result.ai.name !== false, highlights: true, description: true })}`,
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
  if (output.rules.discountRemoved) add({ id: 'spremoved', level: 'info', count: output.rules.discountRemoved, unit: 'row',
    title: 'Special prices removed (75–99% discount)', why: 'The special price was removed, the SKU stays — Report and the change log say so',
    open: { sheet: 'spremoved' } })
  if (result.invalidRows.length) add({ id: 'invalid', level: 'info', count: result.invalidRows.length, unit: 'row',
    title: 'Rows left out (no name / price)', why: 'No name, no price (MRP), or no Product ID / Seller SKU — listed in the "invalid" sheet with the reason, not in the upload' })
  return items
}
