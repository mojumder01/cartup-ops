// New list values for CartUp to add, in CartUp's Attribute List format: the
// team's own template (assets/attribute-list-template.xlsx — sheet
// "attribute-value-format": A = Attribute, a dropdown of the hidden J1:J18
// list such as "[14] Color", B = Attribute Value). The template is filled as it
// is, so its dropdown and hidden list stay; rows go from row 2 down.
import JSZip from 'jszip'
import templateUrl from '../assets/attribute-list-template.xlsx?url'
import { utf8 } from './zipText'

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const key = s => String(s).toLowerCase().replace(/^\s*\[\d+\]\s*/, '').replace(/[^a-z0-9]/g, '')

// rows: [{ column: 'Color', value: '6.5 mm' }] → { bytes, name, rows, skipped }
// skipped: columns that aren't in the template's attribute list (Brand, Warranty…).
export async function buildAttributeList(rows, template = templateUrl) {
  const zip = await JSZip.loadAsync(typeof template === 'string' ? await (await fetch(template)).arrayBuffer() : template)
  const sheetPath = 'xl/worksheets/sheet1.xml'
  let sheet = await zip.file(sheetPath).async('string')
  const strings = [...((await zip.file('xl/sharedStrings.xml')?.async('string')) || '').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)]
    .map(m => [...m[1].matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(t => t[1]).join(''))
  const p = /<(\w+):worksheet/.exec(sheet)?.[1], tag = n => p ? `${p}:${n}` : n
  // The attribute list: the cells of column J, as the dropdown has them ("[48] Model " with its space).
  const attributes = []
  for (const m of sheet.matchAll(new RegExp(`<${tag('c')}\\s([^>]*?)(?:/>|>([\\s\\S]*?)</${tag('c')}>)`, 'g'))) {
    if (!/\br="J\d+"/.test(m[1])) continue
    const body = m[2] || ''
    const v = new RegExp(`<${tag('v')}>([^<]*)</${tag('v')}>`).exec(body)?.[1]
    const t = new RegExp(`<${tag('t')}[^>]*>([^<]*)</${tag('t')}>`).exec(body)?.[1]
    const text = /\bt="s"/.test(m[1]) ? strings[+v] : t ?? v
    if (text) attributes.push(text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
  }
  const byName = new Map(attributes.map(a => [key(a), a]))

  // One row per attribute and value (case ignored), attributes in the list's order.
  const seen = new Set(), out = [], skipped = new Set()
  for (const r of rows) {
    const attr = byName.get(key(r.column)), value = String(r.value ?? '').trim()
    if (!value) continue
    if (!attr) { skipped.add(r.column); continue }
    const k = `${attr}|${value.toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k); out.push({ attr, value })
  }
  out.sort((a, b) => attributes.indexOf(a.attr) - attributes.indexOf(b.attr) || a.value.localeCompare(b.value, undefined, { numeric: true }))

  // Into the sheet: A and B before the row's J cell (rows 1–18 hold the list), new rows after.
  const cell = (ref, text) => `<${tag('c')} r="${ref}" t="inlineStr"><${tag('is')}><${tag('t')} xml:space="preserve">${esc(text)}</${tag('t')}></${tag('is')}></${tag('c')}>`
  out.forEach(({ attr, value }, i) => {
    const n = i + 2, cells = cell(`A${n}`, attr) + cell(`B${n}`, value)
    const row = new RegExp(`<${tag('row')} r="${n}"([^>]*)>`)
    if (row.test(sheet)) sheet = sheet.replace(row, m => m + cells)
    else sheet = sheet.replace(`</${tag('sheetData')}>`, `<${tag('row')} r="${n}">${cells}</${tag('row')}></${tag('sheetData')}>`)
  })
  const last = Math.max(out.length + 1, ...[...sheet.matchAll(new RegExp(`<${tag('row')} r="(\\d+)"`, 'g'))].map(m => +m[1]))
  sheet = sheet.replace(/<((?:\w+:)?dimension) ref="[^"]*"/, `<$1 ref="A1:J${last}"`)
  zip.file(sheetPath, utf8(sheet))
  const stamp = new Date().toISOString().slice(0, 10)
  return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), name: `Attribute-List_new-values_${stamp}.xlsx`, rows: out.length, skipped: [...skipped] }
}

export function saveFile(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
