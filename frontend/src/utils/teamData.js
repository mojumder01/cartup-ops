// Reading, comparing and writing the team's category data as Excel (Data &
// Rules page): category attributes (the Attribute_Check "Category Wise
// Attribute match" sheet and simpler layouts), Daraz → CartUp categories,
// CartUp categories.
import * as XLSX from 'xlsx'

const text = v => (v === undefined || v === null ? '' : String(v).trim())
const id = v => text(v).replace(/\.0+$/, '')   // 4965.0 → 4965
const isId = v => /^\d+$/.test(id(v))
const YES = /^(yes|y|true|1|✓|✔|x)$/i
const norm = s => text(s).toLowerCase().replace(/[^a-z0-9]/g, '')

export async function readSheets(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  return wb.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false }) }))
}

// Category → attributes, from any of:
//  A. Attribute_Check "Category Wise Attribute match": a header row of
//     attribute names (each followed by a "Staus" column), the category ids
//     that have it listed under each
//  B. a "Category Id" column and one column per attribute marked Yes
//  C. a "Category Id" column and an "Attributes" column (comma-separated)
// known: attribute names already used (to keep their spelling).
// → { value: { id: [attrs] }, format, sheet } or throws
export function parseAttributes(sheets, known = []) {
  const spell = new Map(known.map(a => [norm(a), a]))
  const name = h => spell.get(norm(h)) || text(h).replace(/\s+/g, ' ')
  for (const { name: sheet, rows } of sheets) {
    const head = (rows[0] || []).map(text)
    const catCol = head.findIndex(h => /category\s*id|^cat\s*id$|^category$/i.test(h))
    // A: attribute columns (with a "Staus"/"Status" column after each) holding category ids
    const attrCols = head.map((h, i) => [h, i]).filter(([h, i]) => h && !/^sta(t?u)s$/i.test(h) && (/^sta(t?u)s$/i.test(head[i + 1] || '') || spell.has(norm(h)))
      && rows.slice(1).some(r => isId(r[i])))
    if (catCol < 0 && attrCols.length >= 2) {
      const value = {}
      for (const [h, i] of attrCols) for (const r of rows.slice(1)) {
        if (!isId(r[i])) continue
        const status = text(r[i + 1])
        if (/^sta(t?u)s$/i.test(head[i + 1] || '') && status && !YES.test(status)) continue
        ;(value[id(r[i])] ||= []).includes(name(h)) || value[id(r[i])].push(name(h))
      }
      return { value, format: 'Attribute_Check (attribute → category ids)', sheet }
    }
    if (catCol >= 0) {
      const listCol = head.findIndex(h => /^attributes?$/i.test(h))
      const value = {}
      if (listCol >= 0) {   // C
        for (const r of rows.slice(1)) if (isId(r[catCol])) value[id(r[catCol])] = text(r[listCol]).split(/[,;]/).map(s => s.trim()).filter(Boolean).map(name)
        return { value, format: 'Category Id + Attributes', sheet }
      }
      const marks = head.map((h, i) => [h, i]).filter(([h, i]) => i !== catCol && h && rows.slice(1).some(r => YES.test(text(r[i]))))
      if (marks.length) {   // B
        for (const r of rows.slice(1)) if (isId(r[catCol])) value[id(r[catCol])] = marks.filter(([, i]) => YES.test(text(r[i]))).map(([h]) => name(h))
        return { value, format: 'Category Id + a Yes column per attribute', sheet }
      }
    }
  }
  throw new Error('No attribute sheet found — expected the Attribute_Check layout (attribute names on row 1, category ids under each), or a "Category Id" column with attribute columns marked Yes, or an "Attributes" column')
}

// Daraz category → CartUp category: two id columns ("Daraz…" and "CartUp…", or the first two id columns).
export function parseDarazMap(sheets) {
  for (const { name: sheet, rows } of sheets) {
    const head = (rows[0] || []).map(text)
    let d = head.findIndex(h => /daraz/i.test(h)), c = head.findIndex(h => /cartup/i.test(h) && !/path/i.test(h))
    if (d < 0 || c < 0) {
      const ids = head.map((h, i) => i).filter(i => rows.slice(1, 30).filter(r => isId(r[i])).length > Math.min(5, rows.length - 1) / 2)
      if (ids.length < 2) continue
      ;[d, c] = ids
    }
    const map = {}
    for (const r of rows.slice(1)) if (isId(r[d]) && isId(r[c])) map[id(r[d])] = id(r[c])
    if (Object.keys(map).length) return { map, sheet }
  }
  throw new Error('No Daraz → CartUp sheet found — expected a "Daraz Category Id" and a "CartUp Category Id" column')
}

// CartUp categories: "ID" / "Category Id", "Path", "Tags".
export function parseCartupCategories(sheets) {
  for (const { name: sheet, rows } of sheets) {
    const head = (rows[0] || []).map(text)
    const i = head.findIndex(h => /^(id|category\s*id|cartup\s*(category\s*)?id)$/i.test(h)), p = head.findIndex(h => /path/i.test(h)), t = head.findIndex(h => /tags?/i.test(h))
    if (i < 0 || p < 0) continue
    const cats = {}
    for (const r of rows.slice(1)) if (isId(r[i]) && text(r[p])) cats[id(r[i])] = { path: text(r[p]), tags: t >= 0 ? text(r[t]) : '' }
    if (Object.keys(cats).length) return { cats, sheet }
  }
  throw new Error('No category sheet found — expected "ID", "Path" and "Tags" columns')
}

// What changes from `before` to `after` (objects keyed by id). same(a, b): equal values.
export function diffMaps(before, after, same = (a, b) => JSON.stringify(a) === JSON.stringify(b)) {
  const added = [], removed = [], changed = []
  for (const [k, v] of Object.entries(after)) if (!(k in before)) added.push(k); else if (!same(before[k], v)) changed.push(k)
  for (const k of Object.keys(before)) if (!(k in after)) removed.push(k)
  return { added, removed, changed, count: added.length + removed.length + changed.length }
}
export const sameSet = (a = [], b = []) => a.length === b.length && a.every(x => b.includes(x))

// Downloads, in the layouts the uploads read.
const save = (wb, name) => XLSX.writeFile(wb, name)
const stamp = () => new Date().toISOString().slice(0, 10)
export function downloadAttributes(value, cats) {
  const attrs = [...new Set(Object.values(value).flat())]
  const cols = attrs.map(a => Object.keys(value).filter(k => value[k].includes(a)).sort((x, y) => x - y))
  const height = Math.max(0, ...cols.map(c => c.length))
  const matrix = [attrs.flatMap(a => [a, 'Staus']), ...Array.from({ length: height }, (_, r) => cols.flatMap(c => r < c.length ? [c[r], 'Yes'] : ['', '']))]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrix), 'Category Wise Attribute match')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Category Id', 'Path', 'Attributes'], ...Object.keys(value).sort((x, y) => x - y).map(k => [k, cats[k]?.path || '', value[k].join(', ')])]), 'By category')
  save(wb, `category-attributes_${stamp()}.xlsx`)
}
export function downloadDarazMap(d, cats) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Daraz Category Id', 'CartUp Category Id', 'CartUp Path', 'Mapped by hand'],
    ...Object.entries(d.map).sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, v, cats[v]?.path || '(not in CartUp categories)', (d.manual || []).includes(k) ? 'Yes' : ''])]), 'Daraz to CartUp')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Mystery box Daraz categories (no CartUp category)'], ...(d.mystery || []).map(k => [k])]), 'Mystery')
  save(wb, `daraz-to-cartup_${stamp()}.xlsx`)
}
export function downloadCartupCategories(cats) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['ID', 'Path', 'Tags'], ...Object.entries(cats).sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, v.path, v.tags || ''])]), 'CartUp categories')
  save(wb, `cartup-categories_${stamp()}.xlsx`)
}
