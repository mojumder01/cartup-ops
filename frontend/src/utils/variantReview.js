// Daraz dropdown values → CartUp's lists, decided per Parent SKU.
//
// processDarazFiles turns every dropdown value of every Seller SKU into a
// "cell" (the variant columns from Variations Combo, plus Brand, Warranty…)
// and matches it automatically where that is safe. What's left is decided by
// a person in the review window — one decision can cover a single SKU, the
// whole product, or every SKU with that value — and decisions for "every SKU"
// are remembered in this browser, so the same value is automatic next time.
// applyDecisions then produces the final rows, a change log with one row per
// Seller SKU and column, and the values that aren't on CartUp's lists yet
// (Daraz sellers name variants freely; CartUp can add them to its lists).

import { valueKind, MATCH_LABEL, parseRange, sameRangeKind, columnKind } from './listMatch'

// Columns a Variations Combo part can go to: colour, then the size types in
// the order the category rules prefer them.
export const COMBO_TARGETS = ['Color', 'Shoe Size', 'Clothing Size', 'Bedding Size', 'Size', 'Age Group', 'Model']
const MATCH_SCORE = { exact: 100, format: 92, alias: 85, similar: 70 }

export const headerKey = h => String(h).replace(/^\*+/, '').toLowerCase().replace(/[^a-z0-9]/g, '')
export const colLabel = c => String(c).replace(/^\*+/, '')
export const splitCombo = combo => String(combo || '').split(',').map(s => s.trim()).filter(Boolean)

const targetsFor = applicable => {
  const t = COMBO_TARGETS.filter(t => applicable.includes(t))
  return t.length ? t : ['Color', 'Size']   // category unknown: colour + size
}
// How well a combo part fits a column: its match on that column's CartUp list,
// and whether it looks like a size or a colour.
function fit(part, t, lists) {
  const sizeLike = t !== 'Color' && t !== 'Model'
  const hit = lists?.[headerKey(t)]?.match(part)
  const kind = valueKind(part)
  let s = hit ? MATCH_SCORE[hit.how] : 0
  if ((kind === 'size' && sizeLike) || (kind === 'color' && t === 'Color')) s += 20
  if ((kind === 'size' && t === 'Color') || (kind === 'color' && sizeLike)) s -= 20
  return s
}
const positionBonus = (i, t) => (i === 0) === (t === 'Color') ? 3 : 0   // Daraz lists the colour first

// Best distinct column per position, given a score for each (position, column).
function assign(width, targets, score) {
  const pairs = []
  for (let i = 0; i < width; i++) for (const t of targets) pairs.push({ i, t, s: score(i, t) })
  pairs.sort((a, b) => b.s - a.s)   // stable: ties keep the target order
  const plan = new Array(width).fill(null), taken = new Set()
  for (const p of pairs) if (p.s > 0 && !plan[p.i] && !taken.has(p.t)) { plan[p.i] = p.t; taken.add(p.t) }
  // A position nothing fits still gets a free column — a variant needs its value.
  for (let i = 0; i < width; i++) {
    const t = !plan[i] && targets.find(t => !taken.has(t))
    if (t) { plan[i] = t; taken.add(t) }
  }
  return plan
}

// The product's pattern: which column each position of its Variations Combo
// usually goes to, scored over all its SKUs. Daraz writes every variant of a
// product the same way ("Black, 40", "Red, 41"…), so an odd value ("Type A",
// "Zorvex Pattern 1") follows its siblings instead of being guessed alone.
export function planParent(combos, applicable, lists) {
  const rows = combos.map(splitCombo)
  const width = Math.max(0, ...rows.map(r => r.length))
  return assign(width, targetsFor(applicable), (i, t) => {
    const parts = rows.map(r => r[i]).filter(Boolean)
    return (parts.length ? parts.reduce((n, p) => n + fit(p, t, lists), 0) / parts.length : 0) + positionBonus(i, t)
  })
}

// Columns for one SKU's parts: the product's pattern is a strong hint, but a
// value that clearly belongs elsewhere (its siblings written in another
// order: "38, Navy Blue" next to "Black, 40") still goes where it fits.
export function placeParts(parts, plan, applicable, lists) {
  return assign(parts.length, targetsFor(applicable), (i, t) => fit(parts[i], t, lists) + positionBonus(i, t) + (plan[i] === t ? 15 : 0))
}

// source: 'daraz' (from the seller's files), 'default' (filled in by us,
// e.g. Unit = pcs — not logged), 'fill' (a variant value the category needs
// but the seller left out — logged and noted in Report) or 'mark' ("Yes" in a
// variant column the category needs, when Variations Combo isn't matched).
export function makeCell(col, raw, lists, source = 'daraz') {
  const list = lists?.[headerKey(col)] ?? null
  const hit = list?.match(raw) ?? null
  return { col, raw: String(raw), source, listed: !!list, auto: hit ? hit.value : null, how: hit?.how ?? null, conflict: '' }
}

const variantTuple = (cells, value) => COMBO_TARGETS.map(t => {
  const c = cells.find(c => c.col === t)
  return c ? String(value(c)).toLowerCase() : ''
}).join('|')

// One size format per product: when some of its SKUs' sizes are "41 (EU)",
// a bare "40" on another SKU becomes "40 (EU)" too (when that is on the list),
// rather than mixing "40" and "41 (EU)" in one product.
export function harmonizeSizes(items, lists) {
  for (const col of ['Shoe Size', 'Size', 'Clothing Size']) {
    const list = lists?.[headerKey(col)]
    const cells = items.map(it => it.cells.find(c => c.col === col)).filter(Boolean)
    if (!list || cells.length < 2) continue
    const systems = new Set(cells.map(c => /^\d+(?:\.\d+)? \((EU|UK|US)\)$/i.exec(c.auto ?? '')?.[1]?.toUpperCase()).filter(Boolean))
    if (systems.size !== 1) continue
    const [sys] = systems
    for (const c of cells) {
      const v = c.auto ?? c.raw
      if (!/^\d+(\.\d+)?$/.test(v)) continue
      const hit = list.match(`${v} (${sys})`)
      if (hit?.how !== 'exact') continue
      c.auto = hit.value; c.how = 'alias'
      c.note = `same size format as the product's other SKUs (${sys})`
    }
  }
}

// Two variants of one product must not end up with the same values (CartUp
// rejects that) — e.g. "Multi Color" and "Mixed Color" both → "Multicolor", or
// a seller who wrote "Black" twice. Such SKUs get the list's numbered entries
// instead: Multicolor-1, Multicolor-2… (numbers the product already uses are
// skipped). When the list has no numbered entries for that value, auto-matches
// that caused the clash are undone and left for a person to decide.
// items: the SKUs of one Parent SKU.
export function separateCollisions(items, lists) {
  const cellOf = (it, col) => it.cells.find(c => c.col === col)
  const current = c => c.auto ?? c.raw
  const groups = new Map()
  for (const it of items) {
    if (!it.cells.some(c => COMBO_TARGETS.includes(c.col))) continue
    const k = variantTuple(it.cells, current)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(it)
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue
    // The column to number: one whose Daraz values differ inside the group (the
    // one matching merged), else the first variant column they all have.
    const shared = COMBO_TARGETS.filter(t => g.every(it => cellOf(it, t)))
    const col = shared.find(t => new Set(g.map(it => cellOf(it, t).raw.toLowerCase())).size > 1) ?? shared[0]
    // Sizes into Color first; one SKU left alike keeps its plain value.
    const rest = sizeIntoColor(g, col, items, lists)
    if (rest.length < 2) continue
    if (rest.length < g.length) { g.splice(0, g.length, ...rest) }
    const list = col && lists?.[headerKey(col)]
    if (list) {
      const base = current(cellOf(g[0], col))
      const used = new Set(items.map(it => cellOf(it, col)).filter(Boolean).map(c => current(c).toLowerCase()))
      const numbered = []
      for (let n = 1; numbered.length < g.length && n <= 50; n++) {
        // Only the list's real numbered entries ("Grey-2"), not look-alikes ("Grey (5)", "Grey16"),
        // and only small numbers (a list's "L-21" is not a numbering).
        if (n > g.length + 3) break
        const hit = list.match(`${base}-${n}`)
        const real = hit && hit.value.toLowerCase().replace(/\s+/g, '') === `${base}-${n}`.toLowerCase().replace(/\s+/g, '')
        if (real && !used.has(hit.value.toLowerCase())) numbered.push(hit.value)
      }
      if (numbered.length === g.length) {
        g.forEach((it, k) => {
          const c = cellOf(it, col)
          c.auto = numbered[k]; c.how = 'numbered'
          c.note = `${g.length} variants would all be "${base}"`
        })
        continue
      }
    }
    if (new Set(g.map(it => variantTuple(it.cells, c => c.raw))).size < 2) continue   // identical in Daraz too: flagged later
    for (const it of g) {
      for (const c of it.cells) {
        if (!COMBO_TARGETS.includes(c.col) || c.auto === null || c.how === 'exact') continue
        c.conflict = `"${c.auto}" would make it the same variant as ${g.filter(o => o !== it).map(o => o.sku).join(', ')}`
        c.auto = null; c.how = null
      }
    }
  }
}

// ── Sizes (and the like) in the Color column ─────────────────────────────────
// Categories with Color but no size column: the size, side or age that tells
// a product's variants apart goes into Color, the way CartUp's Color list
// spells it — "M (Left)", "Grey-L", "Kids", "Universal", "1-2 Years".
const SIZE_WORD = { S: 'Small', M: 'Medium', L: 'Large', XS: 'Extra Small' }
const SIZE_HEAD = /^(int(?:ernational|l)?\s*[:\-.]\s*)?(\d?x{0,4}[sml]|xs|\d?xl|free size|one size)(?=$|[\s/(\-,])/i
// Words sellers use for a size or a kind of variant, and CartUp's names for them.
const WORD_ALIAS = {
  universel: ['Universal', 'Free Size', 'One Size'], universal: ['Universal', 'Free Size', 'One Size'], free: ['Free Size'],
  spl: ['Special'], special: ['Special'], ch: ['Kids', 'Child'], child: ['Kids', 'Child'], children: ['Kids'], kid: ['Kids'], kids: ['Kids'],
  ad: ['Adult'], adult: ['Adult'], mail: ['Male'], male: ['Male'], men: ['Men'], female: ['Female', 'Famale'], women: ['Women'],
}
const AGE = /^\d+(\.\d+)?\s*(-\s*\d+(\.\d+)?)?\s*\/?\s*(years?|yrs?|months?)$/i
const isSizePart = p => valueKind(p) === 'size' || SIZE_HEAD.test(p.trim()) || AGE.test(p.trim()) || /^(universe?l|spl|special|ch|child|kids?|ad|adult)$/i.test(p.trim())
const uniq = a => a.filter((w, k) => w && a.findIndex(x => x && x.toLowerCase() === w.toLowerCase()) === k)
const cleanPart = part => part.replace(/^(int|international|intl)\s*[:\-.]\s*/i, '').replace(/\s*\/\s*(years?|months?)/i, ' $1').replace(/\s+/g, ' ').trim()
const bitsOf = part => cleanPart(part).split(/\s*[\/()]\s*/).filter(Boolean)
const headOf = part => SIZE_HEAD.exec(part.trim())?.[2]
const ANY_SHORT = { bit: () => true, head: true }
// The names to try for a part, best first: the whole part ("M/Left" → M (Left)),
// its known names, then — when `short` allows — a word of it on its own or
// just its size ("M(30-40)" → M); with the colour first when asked ("Grey-L", "Grey L").
function nameTries(part, base, withColour, short = ANY_SHORT) {
  const whole = cleanPart(part)
  const head = headOf(part)
  const alias = w => [w, SIZE_WORD[w.toUpperCase()], ...(WORD_ALIAS[w.toLowerCase()] || [])]
  // A compound part ("CH/Left", "M(30-40)"): as "A (B)", then each word on its own.
  const bits = bitsOf(part)
  const compound = bits.length > 1 ? [...alias(bits[0]).filter(Boolean).map(a => `${a} (${bits.slice(1).join(' ')})`), ...bits.flatMap((b, i) => short.bit(i) ? alias(b) : [])] : []
  const wholes = uniq([...alias(whole), ...compound])
  const heads = short.head && head && head.toLowerCase() !== whole.toLowerCase() ? uniq([head, SIZE_WORD[head.toUpperCase()]]) : []
  const coloured = ws => withColour && base ? ws.flatMap(w => [`${base}-${w}`, `${base} ${w}`]) : []
  return uniq([...coloured(wholes), ...wholes, ...coloured(heads), ...heads])
}
// What a value says, for telling SKUs apart: the SKU's colour, then the rest by
// meaning — "Grey-L", "Grey Large" and "L" for a grey SKU all say "grey, L";
// Small = S, Child = Kids, Universal = Free Size.
const sameKey = v => String(v).toLowerCase().replace(/[^a-z0-9]/g, '')
const MEANING = [[/\b(extra small|x-small)\b/g, 'xs'], [/\b(extra large|x-large)\b/g, 'xl'], [/\bsmall\b/g, 's'], [/\bmedium\b/g, 'm'], [/\blarge\b/g, 'l'],
  [/\b(universe?l|free size|free|one size)\b/g, 'onesize'], [/\b(ch|child|children|kids?)\b/g, 'kids'], [/\b(ad|adult)\b/g, 'adult'],
  [/\b(spl|special)\b/g, 'special'], [/\b(mail|male|men)\b/g, 'male'], [/\b(female|famale|women)\b/g, 'female']]
const meaning = v => sameKey(MEANING.reduce((s, [re, w]) => s.replace(re, w), String(v).toLowerCase()))
function sayKey(v, base) {
  const s = String(v).trim(), b = String(base || '').trim()
  const rest = b && s.toLowerCase().startsWith(b.toLowerCase()) && s.length > b.length ? s.slice(b.length).replace(/^[\s\-_]+/, '') : s
  return `${sameKey(b)}|${meaning(rest)}`
}
// Which shortened forms still tell a group's SKUs apart: one word of a
// compound part ("M/Left", "M/Right" → Left, Right) or just the size
// ("M(30-40)" → M) — only when it is different for every SKU, so a dropped
// word never hides a difference: "M(20-30)" / "M(30-40)" are two variants
// (compression 20-30 / 30-40 mmHg), and "M" for one and "Medium" for the
// other would pass them off as two sizes.
function shortForms(parts, bases = []) {
  const ks = parts.map((p, k) => p ? k : -1).filter(k => k >= 0)
  const distinct = piece => {
    const keys = ks.map(k => { const x = piece(parts[k]); return x ? `${sameKey(bases[k] || '')}|${meaning(x)}` : null })
    return keys.every(Boolean) && new Set(keys).size === keys.length
  }
  const bit = new Map()
  return { bit: i => { if (!bit.has(i)) bit.set(i, distinct(p => bitsOf(p)[i])); return bit.get(i) }, head: distinct(headOf) }
}
// One value per SKU from its own list of tries, no two alike and none already
// taken (used). Alike: the same apart from spacing or punctuation ("Grey-XL",
// "Grey XL"), or saying the same for SKUs of one colour (bases) — "S" /
// "Small", "Grey-L" / "L". SKUs that clash all move on to their next try; any
// left without a value then take their best try that is still free.
// → value or null per SKU.
function resolveNames(tries, used, hit, bases = []) {
  const usedKeys = new Set([...used].map(sameKey))
  const opts = tries.map(t => t ? uniq(t.map(hit).filter(Boolean)).filter(v => !usedKeys.has(sameKey(v))) : [])
  const at = opts.map(() => 0)
  const keys = (x, k) => [sameKey(x), sayKey(x, bases[k])]
  const settle = () => {
    const v = opts.map((o, k) => o[at[k]] ?? null), count = new Map()
    v.forEach((x, k) => { if (x) for (const key of keys(x, k)) count.set(key, (count.get(key) || 0) + 1) })
    return { v, clash: (x, k) => !!x && keys(x, k).some(key => count.get(key) > 1) }
  }
  for (let round = 0; round < 16; round++) {
    const { v, clash } = settle()
    let moved = false
    v.forEach((x, k) => { if (clash(x, k)) { at[k]++; moved = true } })
    if (!moved) break
  }
  const { v, clash } = settle()
  const out = v.map((x, k) => clash(x, k) ? null : x)
  const taken = new Set(out.flatMap((x, k) => x ? keys(x, k) : []))
  out.forEach((x, k) => {
    if (x) return
    const free = opts[k].find(o => !keys(o, k).some(key => taken.has(key)))
    if (free) { out[k] = free; for (const key of keys(free, k)) taken.add(key) }
  })
  return out
}
const listHit = list => name => { const h = list.match(name); return h && ['exact', 'format', 'alias'].includes(h.how) ? h.value : null }
function putInColor(it, value, part, note, lists) {
  let c = it.cells.find(x => x.col === 'Color')
  if (!c) { c = makeCell('Color', value, lists); it.cells.push(c) }
  c.auto = value; c.how = 'sizecolor'; c.note = note
  it.unused = it.unused.filter(x => x !== part)
}

// Collision step, SKU by SKU: variants still alike in Color get their size (or
// the part that tells them apart — Left / Right, Long / Short) in Color.
// Returns the SKUs still alike (one of them can keep the plain colour; two or
// more are numbered).
function sizeIntoColor(g, col, items, lists) {
  const list = col === 'Color' && lists?.[headerKey('Color')]
  if (!list) return g
  const cellOf = it => it.cells.find(c => c.col === 'Color')
  const base = cellOf(g[0]).auto ?? cellOf(g[0]).raw
  const used = new Set(items.filter(it => !g.includes(it)).map(it => cellOf(it)).filter(Boolean).map(c => String(c.auto ?? c.raw).toLowerCase()))
  const differs = p => g.some(o => !o.unused.some(x => x.toLowerCase() === p.toLowerCase()))
  const parts = g.map(it => it.unused.find(p => isSizePart(p) && differs(p)) || it.unused.find(differs) || null)
  const short = shortForms(parts)
  const picks = resolveNames(parts.map(p => p && nameTries(p, base, true, short)), used, listHit(list), g.map(() => base))
  const left = []
  g.forEach((it, k) => {
    if (!picks[k]) { left.push(it); return }
    putInColor(it, picks[k], parts[k], `"${parts[k]}" in the Color column — the category has no column for it`, lists)
  })
  return left
}

// The product as a whole, the way a person reads it: what do its variants
// differ by — colour, size, or both — and which columns does the category
// have? When it has Color but no size column and the sizes differ:
//   only the size differs  → the size alone in Color ("L", "Large", "M (Left)", "Kids")
//   colour and size differ → both in Color ("Grey-L", "Black Medium")
// in CartUp's list spelling, and only when every SKU with a size gets a value
// and no two SKUs end up alike; otherwise it is left to the collision step.
const SIZE_COLS = ['Shoe Size', 'Clothing Size', 'Bedding Size', 'Size']
export function sizesIntoColor(items, lists) {
  const list = lists?.[headerKey('Color')]
  const app = items[0]?.applicable || []
  if (!list || items.length < 2 || !app.includes('Color') || SIZE_COLS.some(c => app.includes(c))) return null
  const cellOf = it => it.cells.find(c => c.col === 'Color')
  const sizes = items.map(it => it.unused.find(isSizePart) || null)
  if (new Set(sizes.filter(Boolean).map(x => x.toLowerCase())).size < 2) return null   // the size doesn't tell variants apart
  const colourOf = it => { const c = cellOf(it); return c ? String(c.auto ?? c.raw) : '' }
  const colourVaries = new Set(items.map(it => colourOf(it).toLowerCase())).size > 1
  const hit = listHit(list)
  for (const withColour of colourVaries ? [true] : [false, true]) {
    // SKUs without a size keep their colour — no SKU may take that value.
    const used = new Set(items.filter((it, k) => !sizes[k]).map(it => colourOf(it).toLowerCase()).filter(Boolean))
    const bases = items.map(colourOf)
    const short = shortForms(sizes, withColour ? bases : [])
    const picks = resolveNames(sizes.map((x, k) => x && nameTries(x, bases[k], withColour, short)), used, hit, bases)
    if (items.some((it, k) => sizes[k] && !picks[k])) continue
    items.forEach((it, k) => {
      if (!picks[k]) return
      putInColor(it, picks[k], sizes[k], withColour && colourVaries ? `colour and size "${sizes[k]}" in the Color column — the variants differ by both and the category has no size column`
        : withColour ? `size "${sizes[k]}" with the colour in the Color column — the category has no size column`
        : `size "${sizes[k]}" in the Color column — the variants differ only by size and the category has no size column`, lists)
    })
    return colourVaries ? 'colour+size' : 'size'
  }
  return null
}

// ── Quick fixes ───────────────────────────────────────────────────────────────
// For the review window: complete ways to set one variant column for every
// SKU of a product at once — each a full set of values, no two alike —
// so a product whose variants don't match is fixed with one click (and the
// same fix can go to every similar product).
//   id: 'size' · 'colour+size' · 'part:<i>' · 'part:colour' · 'range' ·
//       'range-wider' · 'insole' · 'numbered' · 'new'
//   values: [{ sku, value, onList }] — onList false = a new value for CartUp to add
// items: one product's SKUs; col: the variant column (Color, Size…).
export function productFixes(items, col, lists) {
  const list = lists?.[headerKey(col)]
  if (!list || items.length < 2 || !items.every(it => it.cells.some(c => c.col === col))) return []
  const hit = listHit(list)
  const parts = items.map(it => splitCombo(it.combo))
  const width = Math.max(0, ...parts.map(p => p.length))
  const differing = [...Array(width).keys()].filter(i => new Set(parts.map(p => (p[i] || '').toLowerCase())).size > 1)
  const colourAt = [...Array(width).keys()].find(i => parts.every(p => p[i] && valueKind(p[i]) === 'color'))
  const colourOf = k => colourAt !== undefined ? (hit(parts[k][colourAt]) || parts[k][colourAt]) : ''
  const plans = [], seen = new Set()
  const add = (id, label, why, values) => {
    if (!values.every(Boolean) || new Set(values.map(sameKey)).size < values.length) return
    const sig = values.map(sameKey).join('|')
    if (seen.has(sig)) return
    seen.add(sig)
    const rows = values.map((v, k) => ({ sku: items[k].sku, value: v, onList: sameKey(hit(v) || '') === sameKey(v) }))
    plans.push({ id, label, why, values: rows, newValues: rows.filter(r => !r.onList).length })
  }
  // A part tells the variants apart only when every SKU's is different (not just some).
  const tellsApart = i => parts.every(p => p[i]) && new Set(parts.map(p => p[i].toLowerCase().replace(/\s+/g, ''))).size === parts.length
  const sizePos = differing.find(i => tellsApart(i) && parts.every(p => isSizePart(p[i])))
  if (sizePos !== undefined) {
    const sizes = parts.map(p => p[sizePos]), colours = parts.map((_, k) => colourOf(k))
    add('size', 'The size', `e.g. "${sizes[0]}" → ${col}`, resolveNames(sizes.map(x => nameTries(x, '', false, shortForms(sizes))), new Set(), hit))
    if (colourAt !== undefined) add('colour+size', 'Colour and size', `e.g. "${parts[0][colourAt]}, ${sizes[0]}"`, resolveNames(sizes.map((x, k) => nameTries(x, colours[k], true, shortForms(sizes, colours)).filter(n => sameKey(n).startsWith(sameKey(colours[k])) && sameKey(n) !== sameKey(colours[k]))), new Set(), hit, colours))
  }
  for (const i of differing) {
    if (i === sizePos || i === colourAt || !tellsApart(i)) continue
    const at = parts.map(p => p[i] || null)
    add(`part:${i}`, `Part ${i + 1} of the combo`, `e.g. "${parts[0][i] || '—'}"`, resolveNames(at.map(x => x && nameTries(x, '', false, shortForms(at))), new Set(), hit))
  }
  if (colourAt !== undefined && tellsApart(colourAt)) add('part:colour', 'The colour', `e.g. "${parts[0][colourAt]}"`, resolveNames(parts.map((p, k) => [colourOf(k)]), new Set(), hit))
  // A range ("37-39", "1-5 years") is one value — an insole, heel cushion, sock
  // or free-size shoe fits every size in it — so it is never cut to one size.
  const cur = items.map(it => { const c = it.cells.find(x => x.col === col); return String(c.auto ?? c.raw) })
  const rs = items.map((it, k) => [it.cells.find(x => x.col === col).raw, ...parts[k]].map(parseRange).find(Boolean))
  const sizeColumn = col === 'Color' && SIZE_COLS.some(c => items[0].applicable?.includes(c))   // the range goes there, not in Color
  if (!sizeColumn && rs.every(Boolean) && new Set(rs.map(r => `${r.lo}-${r.hi}${r.unit}`)).size === rs.length) {
    const shoe = columnKind(col) === 'shoeSize'
    const styled = r => `${r.lo}-${r.hi}${r.unit === 'years' ? ' Years' : r.unit === 'months' ? ' Months' : r.unit ? ` ${r.unit.toUpperCase()}` : r.sys ? ` (${r.sys})` : shoe && r.lo >= 15 && r.hi <= 50 ? ' (EU)' : ''}`
    // The range as the list has it ("37-39 (EU)", "M(37-39)"); else a new value in CartUp's style.
    const same = r => list.ranges().filter(e => e.lo === r.lo && e.hi === r.hi && sameRangeKind(r, e)).sort((a, b) => b.whole - a.whole).map(e => e.name)
    const whole = resolveNames(rs.map(r => [styled(r), `${r.lo}-${r.hi}`, ...same(r)]), new Set(), hit).map((v, k) => v || styled(rs[k]))
    add('range', 'The whole range', `e.g. "${rs[0].lo}-${rs[0].hi}" → ${whole[0]}: what the seller sells fits every size in it (insoles, heel cushions, socks, free-size shoes)`, whole)
    // CartUp's narrowest range around it (37-39 → 35-39 (EU)), for ranges not on the list.
    const around = r => list.ranges().filter(e => e.whole && sameRangeKind(r, e) && e.lo <= r.lo && e.hi >= r.hi && (e.hi - e.lo) - (r.hi - r.lo) <= 4)
      .sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo) || a.name.length - b.name.length).map(e => e.name)
    const wider = resolveNames(rs.map((r, k) => hit(whole[k]) ? [whole[k]] : around(r)), new Set(), hit).map((v, k) => v || whole[k])
    const d = wider.findIndex((v, k) => v !== whole[k])
    if (d >= 0) add('range-wider', 'CartUp\'s range around it', `e.g. "${rs[d].lo}-${rs[d].hi}" → ${wider[d]}: on CartUp's list, but wider than the seller's — check the size chart`, wider)
    // The seller's size chart in the text ("37-39: 24 cm") → the insole length, as CartUp lists it (24 CM).
    if (shoe) {
      const text = [items[0].name, items[0].out?.['Highlights(English)'], items[0].out?.['Description (English)']].join(' ').replace(/<[^>]+>/g, ' ')
      const num = n => String(n).replace('.', '\\.')
      const cm = r => {
        const pair = `${num(r.lo)}\\s*(?:-|–|~|to|/)\\s*${num(r.hi)}`
        const m = new RegExp(`\\b${pair}\\b[^\\d]{0,30}?(\\d+(?:\\.\\d+)?)\\s*(cm|mm)\\b`, 'i').exec(text) || new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(cm|mm)\\b[^\\d]{0,15}?\\b${pair}\\b`, 'i').exec(text)
        const n = m && (m[2].toLowerCase() === 'mm' ? +m[1] / 10 : +m[1])
        return n >= 8 && n <= 35 ? n : null
      }
      const lens = rs.map(cm)
      if (lens.every(Boolean)) add('insole', 'Insole length (seller\'s size chart)', `e.g. "${rs[0].lo}-${rs[0].hi}" = ${lens[0]} cm in the description`, lens.map(n => hit(`${n} CM`) || hit(`${n}cm`) || `${n} CM`))
    }
  }
  // The list's own numbered entries (Grey-1, Grey-2…).
  const base = colourOf(0) || cur[0]
  const numbered = items.map((_, k) => { const h = list.match(`${base}-${k + 1}`); return h && sameKey(h.value) === sameKey(`${base}-${k + 1}`) ? h.value : null })
  add('numbered', `Numbered (${base}-1, ${base}-2…)`, 'the list\'s numbered entries — says nothing about the variant', numbered)
  // As written — new values for CartUp to add ("Grey SPL", "EU 42 S").
  const tidy = p => p.replace(/^(int|international|intl)\s*[:\-.]\s*/i, '').replace(/:/g, ' ').replace(/^(\d?x{0,4}[sml]|xs|\d?xl)(?=$|[\s/(\-,])/i, s => s.toUpperCase())
  const written = parts.map((p, k) => uniq([colourAt !== undefined && !differing.includes(colourAt) ? colourOf(k) : '', ...differing.map(i => tidy(p[i] || ''))]).join(' ').replace(/\s+/g, ' ').trim())
  add('new', 'As the seller wrote it', 'new values — CartUp adds them to its list (#N/A until then)', written.map(w => hit(w) || w))
  // Best first: on CartUp's list and saying what the variant is; the whole
  // range (what the seller sells, even as new values), the insole length and
  // the list's wider range; then the list's numbering (on the list, says
  // nothing); then new values.
  const RANK = { range: 0.3, insole: 0.4, 'range-wider': 0.6 }
  const rank = p => p.id in RANK ? RANK[p.id] + p.newValues / 1000 : p.newValues ? 2 + p.newValues / 1000 : p.id === 'numbered' ? 1 : 0
  return plans.sort((a, b) => rank(a) - rank(b))
}

// What a product's variants differ by, from its Variations Combo values:
// 'colour', 'size', 'colour+size', 'other' — or '' for a single SKU / no combo.
export function variantKind(items) {
  if (items.length < 2) return ''
  const rows = items.map(it => splitCombo(it.combo))
  if (rows.every(r => !r.length)) return ''
  let colour = false, size = false, other = false
  const width = Math.max(...rows.map(r => r.length))
  for (let i = 0; i < width; i++) {
    const vals = rows.map(r => (r[i] || '').toLowerCase())
    if (new Set(vals).size < 2) continue
    const kinds = rows.map(r => r[i] && (isSizePart(r[i]) ? 'size' : valueKind(r[i]))).filter(Boolean)
    if (kinds.filter(k => k === 'size').length >= kinds.length / 2) size = true
    else if (kinds.filter(k => k === 'color').length >= kinds.length / 2) colour = true
    else other = true
  }
  return colour && size ? 'colour+size' : size ? 'size' : colour ? 'colour' : other ? 'other' : ''
}

// ── Decisions ─────────────────────────────────────────────────────────────────
// { [key]: { value } | { keep: true } } — keep = leave the Daraz value as a new
// value for CartUp's list. Narrowest scope wins.
export const decisionKey = {
  sku: (item, cell) => `sku|${item.sku}|${cell.col}`,
  parent: (item, cell) => `parent|${item.parent}|${cell.col}|${cell.raw.toLowerCase()}`,
  all: cell => `all|${headerKey(cell.col)}|${cell.raw.toLowerCase()}`,
}

const MEMORY_KEY = 'cartup.valueMemory.v1'
export function loadMemory() {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}') || {} } catch { return {} }
}
// Every "all SKUs with this value" decision is remembered for next time.
export function rememberDecisions(decisions) {
  const memory = loadMemory()
  for (const [k, d] of Object.entries(decisions)) if (k.startsWith('all|')) memory[k] = d
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(memory)) } catch { /* storage unavailable */ }
  return memory
}
export function forgetMemory() {
  try { localStorage.removeItem(MEMORY_KEY) } catch { /* storage unavailable */ }
  return {}
}

// What a cell ends up as:
//   state: unchecked (no template) · ok (on the list as written) · auto ·
//          picked (a person, this run) · remembered · kept (new value, decided) ·
//          open (not on the list, undecided)
export function cellState(item, cell, decisions, memory, lists) {
  if (!cell.listed) return { value: cell.raw, state: 'unchecked' }
  for (const scope of ['sku', 'parent']) {
    const d = decisions[decisionKey[scope](item, cell)]
    if (d) return fromDecision(d, cell, scope)
  }
  const allKey = decisionKey.all(cell)
  if (decisions[allKey]) return fromDecision(decisions[allKey], cell, 'all')
  const m = memory[allKey]
  if (m?.keep) return { value: cell.raw, state: 'kept', scope: 'memory' }
  if (m?.noWarranty) return { value: '', state: 'remembered', scope: 'memory', noWarranty: true }
  if (m) {
    // A remembered pick only counts while it is still on the template's list.
    const hit = lists?.[headerKey(cell.col)]?.match(m.value)
    if (hit?.how === 'exact') return { value: hit.value, state: hit.value === cell.raw ? 'ok' : 'remembered', scope: 'memory' }
  }
  if (cell.auto !== null) return { value: cell.auto, state: cell.auto === cell.raw ? 'ok' : 'auto', how: cell.how, note: cell.note }
  return { value: cell.raw, state: 'open', conflict: cell.conflict }
}
function fromDecision(d, cell, scope) {
  // keep: the seller's value as a new list value — or, with a value, that value (a quick fix's new value).
  if (d.keep) return { value: d.value ?? cell.raw, state: 'kept', scope }
  if (d.noWarranty) return { value: '', state: 'picked', scope, noWarranty: true }
  return { value: d.value, state: d.value === cell.raw ? 'ok' : 'picked', scope }
}

const SCOPE_LABEL = { sku: 'this SKU', parent: 'this product', all: 'every SKU with this value', memory: 'remembered from an earlier run' }
function changeLabel(st) {
  if (st.state === 'auto' && st.how === 'numbered') return 'Numbered to keep the product\'s variants apart'
  if (st.state === 'auto' && st.how === 'sizecolor') return 'Size put in the Color column (the category has no size column)'
  if (st.state === 'auto' && st.how === 'rule') return st.note
  if (st.state === 'auto') return st.how === 'exact' ? 'Matched to the list\'s spelling' : MATCH_LABEL[st.how]
  if (st.state === 'picked' && st.noWarranty) return `Set to No Warranty by hand (${SCOPE_LABEL[st.scope]})`
  if (st.state === 'picked') return `Picked by hand (${SCOPE_LABEL[st.scope]})`
  if (st.state === 'remembered') return 'Remembered pick from an earlier run'
  if (st.state === 'kept') return `Kept as a new value for CartUp's list (${SCOPE_LABEL[st.scope]})`
  return ''
}

// SKUs of one product whose variant values (after everything) are identical.
// ("Yes" marks are not variant values — they never count.)
function duplicateVariants(items, valueOf) {
  const groups = new Map()
  for (const it of items) {
    if (!it.cells.some(c => COMBO_TARGETS.includes(c.col) && c.source !== 'mark')) continue
    const k = variantTuple(it.cells, valueOf(it))
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(it.sku)
  }
  return [...groups.values()].filter(g => g.length > 1)
}

// ── Review window ─────────────────────────────────────────────────────────────
// One group per Parent SKU.
export function reviewGroups(result, decisions, memory) {
  const byParent = new Map()
  for (const item of result.items) {
    if (!byParent.has(item.parent)) byParent.set(item.parent, [])
    byParent.get(item.parent).push(item)
  }
  const groups = []
  for (const [parent, items] of byParent) {
    // Values we filled in ourselves (Unit = pcs…) only show up when they need a decision.
    const shows = (it, c) => c.listed && (c.source === 'daraz' || cellState(it, c, decisions, memory, result.lists).state === 'open')
    const cols = [...new Set(items.flatMap(it => it.cells.filter(c => shows(it, c)).map(c => c.col)))]
      .sort((a, b) => (COMBO_TARGETS.includes(b) - COMBO_TARGETS.includes(a)) || COMBO_TARGETS.indexOf(a) - COMBO_TARGETS.indexOf(b))
    let open = 0, changed = 0
    const skus = items.map(item => {
      const cells = {}
      for (const c of item.cells) {
        if (!shows(item, c)) continue
        const st = cellState(item, c, decisions, memory, result.lists)
        cells[c.col] = { cell: c, ...st }
        if (st.state === 'open') open++
        else if (st.value !== c.raw) changed++
      }
      return { item, sku: item.sku, combo: item.combo, cells }
    })
    const dupes = duplicateVariants(items, it => c => cellState(it, c, decisions, memory, result.lists).value)
    if (cols.length) groups.push({ parent, name: items[0].name, category: items[0].category, skus, cols, open, changed, dupes })
  }
  // Products needing attention first; otherwise file order (stable, so the list doesn't jump while deciding).
  const attention = g => g.open > 0 || g.dupes.length > 0
  return groups.sort((a, b) => attention(b) - attention(a))
}

// Which kind of column a value belongs to, for filters and the check list.
export const colGroup = col => col === '**Brand' ? 'brand' : /^Warranty/.test(colLabel(col)) ? 'warranty' : COMBO_TARGETS.includes(col) ? 'variant' : 'other'
// How much an automatic change is worth a look — fuzzy spelling first.
export const RISK = { similar: 3, alias: 2, rule: 2, sizecolor: 2, numbered: 1, format: 1, exact: 0 }

// ── By value ──────────────────────────────────────────────────────────────────
// Every distinct seller value per column, across all products, with what it
// ends up as — one decision settles it everywhere (and is remembered).
//   status: open (some SKUs undecided) · changed (matched to another spelling
//           or value) · kept (new value) · ok (on the list as written)
export function valueGroups(result, decisions, memory) {
  const m = new Map()
  for (const it of result.items) for (const c of it.cells) {
    if (!c.listed || c.source !== 'daraz') continue
    const key = decisionKey.all(c)
    let g = m.get(key)
    if (!g) m.set(key, g = { key, col: c.col, raw: c.raw, cell: c, item: it, parents: new Set(), skus: 0, skuList: [], open: 0, kept: 0, changed: 0, values: new Map(), how: null, conflict: '' })
    const st = cellState(it, c, decisions, memory, result.lists)
    g.parents.add(it.parent); g.skus++; g.skuList.push(it.sku)
    if (st.state === 'open') { g.open++; g.conflict ||= st.conflict || '' }
    else if (st.state === 'kept') g.kept++
    else if (st.value !== c.raw) g.changed++
    if (st.state !== 'open') g.values.set(st.noWarranty ? 'No Warranty' : st.value, (g.values.get(st.noWarranty ? 'No Warranty' : st.value) || 0) + 1)
    if (st.state === 'auto' && (RISK[st.how] ?? 0) > (RISK[g.how] ?? -1)) g.how = st.how
    if (st.state === 'picked' || st.state === 'remembered') g.by ||= st.state
  }
  return [...m.values()].map(g => ({
    ...g,
    status: g.open ? 'open' : g.kept ? 'kept' : g.changed ? 'changed' : 'ok',
    now: [...g.values].sort((a, b) => b[1] - a[1]).map(([v]) => v),
    decided: decisions[g.key] || null,
  }))
}

// ── Final rows, change log and new values ─────────────────────────────────────
export function applyDecisions(result, decisions = {}, memory = {}) {
  const rows = [], changes = [], newValues = new Map()
  const stats = { checked: 0, auto: 0, remembered: 0, picked: 0, kept: 0, open: 0, openValues: 0, openParents: 0, dupes: 0 }
  const attention = new Set()   // row indexes that still need a person
  const filledRows = new Set()  // rows with a variant value set by rule (Same as picture, One Size)
  const numbered = []           // variant values numbered apart (Multicolor-1…): { row, col, value, raw }
  const sizeColor = []          // sizes put in the Color column (Grey-L…): { row, col, value, raw }
  const openValues = new Set(), openParents = new Set()
  const byParent = new Map()
  for (const item of result.items) {
    if (!byParent.has(item.parent)) byParent.set(item.parent, [])
    byParent.get(item.parent).push(item)
  }
  const dupeNote = new Map()
  for (const items of byParent.values()) {
    for (const g of duplicateVariants(items, it => c => cellState(it, c, decisions, memory, result.lists).value)) {
      stats.dupes += g.length
      for (const sku of g) dupeNote.set(sku, g.filter(s => s !== sku))
    }
  }

  result.items.forEach((item, rowIndex) => {
    const out = { ...item.out }
    const changed = [], fresh = [], filled = [], marked = []
    let noWarranty = false
    for (const cell of item.cells) {
      const st = cellState(item, cell, decisions, memory, result.lists)
      out[cell.col] = st.value
      if (st.noWarranty) noWarranty = true
      if (st.state === 'auto' && st.how === 'numbered') numbered.push({ row: rowIndex, col: cell.col, value: st.value, raw: cell.raw })
      if (st.state === 'auto' && st.how === 'sizecolor') sizeColor.push({ row: rowIndex, col: cell.col, value: st.value, raw: cell.raw, note: st.note || '' })
      if (cell.source === 'mark') { marked.push(colLabel(cell.col)); continue }
      if (!cell.listed) continue
      stats.checked++
      if (st.state in stats) stats[st.state]++
      if (st.state === 'open') { openValues.add(`${cell.col}|${cell.raw.toLowerCase()}`); openParents.add(item.parent); attention.add(rowIndex) }
      if (cell.source === 'fill') {
        changes.push({ sku: item.sku, parent: item.parent, name: item.name, column: colLabel(cell.col), from: '', to: st.value,
          change: st.value === cell.auto ? 'Not given — the category needs it, set by rule' : changeLabel(st), detail: item.combo ? `Variations Combo "${item.combo}"` : 'No variants' })
        filled.push(`${colLabel(cell.col)} = ${st.value}`)
      } else if (cell.source === 'daraz' && (st.value !== cell.raw || st.state === 'kept')) {
        changes.push({
          sku: item.sku, parent: item.parent, name: item.name, column: colLabel(cell.col), from: cell.raw, to: st.value,
          change: changeLabel(st),
          detail: [COMBO_TARGETS.includes(cell.col) ? `From Variations Combo "${item.combo}"` : '', st.how === 'rule' ? '' : st.note || ''].filter(Boolean).join(' · '),
        })
        if (st.value !== cell.raw) changed.push(`${colLabel(cell.col)} ${cell.raw} → ${st.value}`)
      }
      if (st.state === 'open' || st.state === 'kept') {
        const written = st.state === 'kept' ? st.value : cell.raw
        const k = `${colLabel(cell.col)}|${written.toLowerCase()}`
        if (!newValues.has(k)) newValues.set(k, { column: colLabel(cell.col), value: written, skus: [], parents: new Set(), decided: true, listKey: headerKey(cell.col) })
        const nv = newValues.get(k)
        nv.skus.push(item.sku); nv.parents.add(item.parent)
        if (st.state === 'open') nv.decided = false
        fresh.push(`${colLabel(cell.col)} "${written}"`)
      }
    }
    // "No Warranty" picked for a warranty period that isn't on the list.
    if (noWarranty) {
      const no = result.lists?.[headerKey('Warranty Type')]?.match('No Warranty')?.value || 'No Warranty'
      if (out['Warranty Type'] !== no) {
        changes.push({ sku: item.sku, parent: item.parent, name: item.name, column: 'Warranty Type', from: out['Warranty Type'], to: no, change: 'Set to No Warranty by hand', detail: '' })
        out['Warranty Type'] = no
      }
      out['Warranty Period'] = ''
    }
    const notes = [item.reportNote]
    if (filled.length) notes.push(`Not given, set by rule (category needs it): ${filled.join(', ')}`)
    if (marked.length) notes.push(`Marked Yes — the category needs: ${marked.join(', ')} (Variations Combo not matched: "${item.combo}")`)
    if (fresh.length) notes.push(`Not on CartUp list (#N/A until added or matched): ${fresh.join(', ')}`)
    if (changed.length) notes.push(`Changed: ${changed.join(', ')}`)
    if (dupeNote.has(item.sku)) { notes.push(`Same variant values as ${dupeNote.get(item.sku).join(', ')} — make them different`); attention.add(rowIndex) }
    if (item.unused.length) notes.push(`Not used from Variations Combo: ${item.unused.join(', ')}`)
    out['Report'] = notes.filter(Boolean).join(' | ')
    if (filled.length) filledRows.add(rowIndex)
    rows.push(out)
  })
  for (const d of result.duplicateSkus) {
    changes.push({ sku: d.sku, parent: d.parent, name: d.name, column: 'Seller SKU', from: 'repeated row', to: 'row removed', change: 'Duplicate Seller SKU — the first row was kept', detail: '' })
  }
  stats.openValues = openValues.size
  stats.openParents = openParents.size
  return { rows, changes, newValues: [...newValues.values()].map(nv => ({ ...nv, parents: [...nv.parents] })), stats, attention, filledRows, numbered, sizeColor }
}
