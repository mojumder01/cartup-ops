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

import { valueKind, MATCH_LABEL } from './listMatch'

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

// source: 'daraz' (from the seller's files) or 'default' (filled in by us,
// e.g. Unit = pcs) — only Daraz values appear in the change log.
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
    const list = col && lists?.[headerKey(col)]
    if (list) {
      const base = current(cellOf(g[0], col))
      const used = new Set(items.map(it => cellOf(it, col)).filter(Boolean).map(c => current(c).toLowerCase()))
      const numbered = []
      for (let n = 1; numbered.length < g.length && n <= 50; n++) {
        const hit = list.match(`${base}-${n}`)
        if (hit && (hit.how === 'exact' || hit.how === 'format') && !used.has(hit.value.toLowerCase())) numbered.push(hit.value)
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
  if (m) {
    // A remembered pick only counts while it is still on the template's list.
    const hit = lists?.[headerKey(cell.col)]?.match(m.value)
    if (hit?.how === 'exact') return { value: hit.value, state: hit.value === cell.raw ? 'ok' : 'remembered', scope: 'memory' }
  }
  if (cell.auto !== null) return { value: cell.auto, state: cell.auto === cell.raw ? 'ok' : 'auto', how: cell.how, note: cell.note }
  return { value: cell.raw, state: 'open', conflict: cell.conflict }
}
function fromDecision(d, cell, scope) {
  if (d.keep) return { value: cell.raw, state: 'kept', scope }
  return { value: d.value, state: d.value === cell.raw ? 'ok' : 'picked', scope }
}

const SCOPE_LABEL = { sku: 'this SKU', parent: 'this product', all: 'every SKU with this value', memory: 'remembered from an earlier run' }
function changeLabel(st) {
  if (st.state === 'auto' && st.how === 'numbered') return 'Numbered to keep the product\'s variants apart'
  if (st.state === 'auto') return st.how === 'exact' ? 'Matched to the list\'s spelling' : MATCH_LABEL[st.how]
  if (st.state === 'picked') return `Picked by hand (${SCOPE_LABEL[st.scope]})`
  if (st.state === 'remembered') return 'Remembered pick from an earlier run'
  if (st.state === 'kept') return `Kept as a new value for CartUp's list (${SCOPE_LABEL[st.scope]})`
  return ''
}

// SKUs of one product whose variant values (after everything) are identical.
function duplicateVariants(items, valueOf) {
  const groups = new Map()
  for (const it of items) {
    if (!it.cells.some(c => COMBO_TARGETS.includes(c.col))) continue
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

// ── Final rows, change log and new values ─────────────────────────────────────
export function applyDecisions(result, decisions = {}, memory = {}) {
  const rows = [], changes = [], newValues = new Map()
  const stats = { checked: 0, auto: 0, remembered: 0, picked: 0, kept: 0, open: 0, openValues: 0, openParents: 0, dupes: 0 }
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

  for (const item of result.items) {
    const out = { ...item.out }
    const changed = [], fresh = []
    for (const cell of item.cells) {
      const st = cellState(item, cell, decisions, memory, result.lists)
      out[cell.col] = st.value
      if (!cell.listed) continue
      stats.checked++
      if (st.state in stats) stats[st.state]++
      if (st.state === 'open') { openValues.add(`${cell.col}|${cell.raw.toLowerCase()}`); openParents.add(item.parent) }
      if (cell.source === 'daraz' && (st.value !== cell.raw || st.state === 'kept')) {
        changes.push({
          sku: item.sku, parent: item.parent, name: item.name, column: colLabel(cell.col), from: cell.raw, to: st.value,
          change: changeLabel(st),
          detail: [COMBO_TARGETS.includes(cell.col) ? `From Variations Combo "${item.combo}"` : '', st.note || ''].filter(Boolean).join(' · '),
        })
        if (st.value !== cell.raw) changed.push(`${colLabel(cell.col)} ${cell.raw} → ${st.value}`)
      }
      if (st.state === 'open' || st.state === 'kept') {
        const k = `${colLabel(cell.col)}|${cell.raw.toLowerCase()}`
        if (!newValues.has(k)) newValues.set(k, { column: colLabel(cell.col), value: cell.raw, skus: [], parents: new Set(), decided: true, listKey: headerKey(cell.col) })
        const nv = newValues.get(k)
        nv.skus.push(item.sku); nv.parents.add(item.parent)
        if (st.state === 'open') nv.decided = false
        fresh.push(`${colLabel(cell.col)} "${cell.raw}"`)
      }
    }
    if (item.darazName && out['**Name (English)'] !== item.darazName) {
      changes.push({ sku: item.sku, parent: item.parent, name: item.name, column: 'Name (English)', from: item.darazName, to: out['**Name (English)'], change: item.nameHow, detail: '' })
    }
    const notes = [item.reportNote]
    if (fresh.length) notes.push(`Not on CartUp list (#N/A until added or matched): ${fresh.join(', ')}`)
    if (changed.length) notes.push(`Changed: ${changed.join(', ')}`)
    if (dupeNote.has(item.sku)) notes.push(`Same variant values as ${dupeNote.get(item.sku).join(', ')} — make them different`)
    if (item.unused.length) notes.push(`Not used from Variations Combo: ${item.unused.join(', ')}`)
    out['Report'] = notes.join(' | ')
    rows.push(out)
  }
  for (const d of result.duplicateSkus) {
    changes.push({ sku: d.sku, parent: d.parent, name: d.name, column: 'Seller SKU', from: 'repeated row', to: 'row removed', change: 'Duplicate Seller SKU — the first row was kept', detail: '' })
  }
  stats.openValues = openValues.size
  stats.openParents = openParents.size
  return { rows, changes, newValues: [...newValues.values()].map(nv => ({ ...nv, parents: [...nv.parents] })), stats }
}
