import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { reviewGroups, valueGroups, decisionKey, headerKey, colLabel, colGroup, splitCombo, productFixes, RISK, COMBO_TARGETS } from '../utils/variantReview'
import { MATCH_LABEL } from '../utils/listMatch'
import CopyButton from './CopyButton'
import { X, Search, Check, Plus, RotateCcw, ChevronRight, AlertTriangle, ImageOff, Download, Tag, ShieldOff, Filter, Layers, Rows3, Wand2, CheckCircle } from 'lucide-react'

// Review window for Daraz Upload: the dropdown values (Color, Size, Brand,
// Warranty…) checked against CartUp's lists. Two ways in:
//   By product — a list of product cards: each Parent SKU with all its
//                variants (image, Seller SKU, Variations Combo and every
//                column), so a value that isn't matched is always seen next to
//                its siblings. Click a value to match it right under its row (a
//                pick can cover one SKU, the product, or every SKU); quick
//                fixes set a variant column for the whole product in one click
//                (also for every similar product)
//   By value   — each distinct seller value once, across all products: one
//                pick settles it everywhere (and is remembered next time)
// Both filter by column and state, so a check ("brands", "warranty", "fuzzy
// auto-matches") is one click from the Daraz page's check list.

const STATE_STYLE = {
  open:       { background:'#fef2f2', color:'#b91c1c', border:'1px solid #fecaca' },
  auto:       { background:'#eef2ff', color:'#3730a3', border:'1px solid #e0e7ff' },
  remembered: { background:'#eef2ff', color:'#3730a3', border:'1px solid #e0e7ff' },
  changed:    { background:'#eef2ff', color:'#3730a3', border:'1px solid #e0e7ff' },
  picked:     { background:'#ecfdf5', color:'#065f46', border:'1px solid #a7f3d0' },
  kept:       { background:'#fffbeb', color:'#92400e', border:'1px solid #fde68a' },
  ok:         { background:'#fff', color:'#334155', border:'1px solid #e2e8f0' },
}
const STATE_NOTE = { open: 'not on list', auto: 'auto', remembered: 'remembered', picked: 'picked', kept: 'new value' }
// A variant value worth a look: not on the list, numbered, or a size put in
// Color that isn't sure (not plainly a size, not confirmed by the AI).
const cellTrouble = v => v.state === 'open' || (v.state === 'auto' && (v.how === 'numbered' || (v.how === 'sizecolor' && !v.cell.sure)))
const HOW_NOTE = { ...MATCH_LABEL, numbered: 'Numbered (variants apart)', sizecolor: 'Size in Color (no size column)', rule: 'Warranty rule', ai: 'AI: closest CartUp value', exact: 'List spelling' }
// How a product card stands: something to fix, worth a look, or done.
const CARD = {
  open:  { label: 'not on list', bar: '#ef4444', badge: { color:'#b91c1c', background:'#fee2e2' } },
  dupes: { label: 'same variant', bar: '#f59e0b', badge: { color:'#92400e', background:'#fef3c7' } },
  check: { label: 'check', bar: '#6366f1', badge: { color:'#3730a3', background:'#eef2ff' } },
  done:  { label: 'done', bar: '#22c55e', badge: { color:'#15803d', background:'#dcfce7' } },
}

// Column filter: 'all', a group ('g:variant' | 'g:brand' | 'g:warranty' | 'g:other') or one column ('c:Color').
const colMatches = (f, col) => f === 'all' || (f.startsWith('g:') ? colGroup(col) === f.slice(2) : col === f.slice(2))
const GROUP_LABEL = { variant: 'Variant columns (Color, Size…)', brand: 'Brand', warranty: 'Warranty', other: 'Other columns' }
const cellId = (sku, col) => `vr-cell-${sku}-${col}`.replace(/[^\w-]/g, '_')
const PAGE = 15   // product cards shown at a time

function Thumb({ src, size = 40, onOpen }) {
  const [failed, setFailed] = useState(false)
  const ok = src && /^https?:\/\//.test(src) && !failed
  return (
    <div onClick={ok ? () => onOpen(src) : undefined} title={ok ? 'Click to enlarge' : 'No image'}
      style={{ width:size, height:size, borderRadius:6, border:'1px solid #e2e8f0', background:'#f8fafc', flexShrink:0, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', cursor: ok ? 'zoom-in' : 'default' }}>
      {ok ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
        : <ImageOff size={Math.round(size / 2.6)} color='#cbd5e1' />}
    </div>
  )
}

// initial: { view: 'values' | 'products', state, col, query } — where to open.
export default function VariantReview({ result, decisions, setDecisions, memory, initial = {}, onForgetMemory, onDownload, onClose }) {
  const groups = useMemo(() => reviewGroups(result, decisions, memory), [result, decisions, memory])
  const values = useMemo(() => valueGroups(result, decisions, memory), [result, decisions, memory])
  const byParent = useMemo(() => new Map(groups.map(g => [g.parent, g])), [groups])
  const [view, setView] = useState(initial.view || 'products')
  const [colFilter, setColFilter] = useState(initial.col || 'all')
  const [pState, setPState] = useState(initial.view !== 'values' && initial.state || 'attention')
  const [vState, setVState] = useState(initial.view === 'values' && initial.state || 'open')
  const [query, setQuery] = useState(initial.query || '')
  const [editing, setEditing] = useState(null)   // { parent, sku, col }
  const [focus, setFocus] = useState(null)       // the product card last worked on (its quick fixes offer "similar products")
  const [scope, setScope] = useState('all')
  const [search, setSearch] = useState('')
  const [zoom, setZoom] = useState(null)
  const [big, setBig] = useState(false)          // larger variant images
  const [valueEdit, setValueEdit] = useState(null)
  const [valueSearch, setValueSearch] = useState('')
  const [limit, setLimit] = useState(200)
  const [cards, setCards] = useState(PAGE)

  // Columns present, with open counts, for the column filter.
  const columns = useMemo(() => {
    const m = new Map()
    for (const v of values) m.set(v.col, (m.get(v.col) || 0) + (v.open ? 1 : 0))
    return [...m].sort((a, b) => (COMBO_TARGETS.indexOf(a[0]) + 1 || 99) - (COMBO_TARGETS.indexOf(b[0]) + 1 || 99))
  }, [values])
  const groupsPresent = ['variant', 'brand', 'warranty', 'other'].filter(g => columns.some(([c]) => colGroup(c) === g))

  // How many SKUs share a value — in the product and everywhere.
  const counts = useMemo(() => {
    const all = new Map(), parent = new Map()
    for (const it of result.items) for (const c of it.cells) {
      const a = decisionKey.all(c), p = decisionKey.parent(it, c)
      all.set(a, (all.get(a) || 0) + 1); parent.set(p, (parent.get(p) || 0) + 1)
    }
    return { all, parent }
  }, [result])

  // ── By product ──
  // Variants worth a look: not on the list, the same as a sibling, numbered, a
  // size put in Color that isn't sure, or read differently by the AI.
  const variantTrouble = g => g.dupes.length > 0 || g.skus.some(s => s.item.aiDisagree?.length || Object.entries(s.cells).some(([c, v]) => COMBO_TARGETS.includes(c) && cellTrouble(v)))
  const q = query.trim().toLowerCase()
  const cellsIn = g => g.skus.flatMap(s => Object.entries(s.cells).filter(([c]) => colMatches(colFilter, c)).map(([, v]) => v))
  const pTest = {
    attention: g => cellsIn(g).some(v => v.state === 'open') || g.dupes.length > 0,
    variants: g => variantTrouble(g),
    open: g => cellsIn(g).some(v => v.state === 'open'),
    dupes: g => g.dupes.length > 0,
    changed: g => cellsIn(g).some(v => v.state !== 'open' && v.state !== 'kept' && v.value !== v.cell.raw),
    all: g => colFilter === 'all' || cellsIn(g).length > 0,
  }
  const pCount = useMemo(() => Object.fromEntries(Object.entries(pTest).map(([k, t]) => [k, groups.filter(t).length])), [groups, colFilter])
  const matchesQuery = g => !q || g.parent.toLowerCase().includes(q) || String(g.name).toLowerCase().includes(q) ||
    g.skus.some(s => s.sku.toLowerCase().includes(q) || Object.values(s.cells).some(v => v.cell.raw.toLowerCase() === q))
  // The products in the list: chosen when the filter or search changes, then
  // kept — a product you fix stays where it is, marked done, instead of jumping away.
  const feed = useMemo(() => groups.filter(g => pTest[pState](g) && matchesQuery(g)).map(g => g.parent), [pState, colFilter, q, result])
  useEffect(() => { setCards(PAGE) }, [feed])
  const status = g => g.open > 0 ? 'open' : g.dupes.length ? 'dupes' : variantTrouble(g) ? 'check' : 'done'
  const visible = feed.slice(0, cards).map(p => byParent.get(p)).filter(Boolean)
  const doneInFeed = feed.filter(p => byParent.get(p) && status(byParent.get(p)) === 'done').length
  const openCells = groups.reduce((n, g) => n + g.open, 0)
  const openParents = groups.filter(g => g.open > 0).length
  const remembered = Object.keys(memory).length

  const group = editing && byParent.get(editing.parent)
  const row = group?.skus.find(s => s.sku === editing.sku)
  const target = row?.cells[editing.col]
  const list = target && result.lists?.[headerKey(editing.col)]
  const suggestions = useMemo(() => (target && list ? list.suggest(target.cell.raw, 8) : []), [target?.cell, list])
  const results = useMemo(() => (list && search.trim() ? list.search(search, 30) : []), [list, search])

  useEffect(() => { setSearch('') }, [editing?.sku, editing?.col])
  // The value being matched stays in view (and its card loaded).
  useEffect(() => {
    if (!editing || view !== 'products') return
    const i = feed.indexOf(editing.parent)
    if (i >= cards) setCards(i + PAGE)
    const t = setTimeout(() => document.getElementById(cellId(editing.sku, editing.col))?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60)
    return () => clearTimeout(t)
  }, [editing?.sku, editing?.col])

  // Next undecided value after a given one — products in list order, then the
  // rest — read from the state after the latest pick, within the column filter.
  const order = useMemo(() => {
    const inFeed = new Set(feed)
    const items = [...feed.flatMap(p => byParent.get(p)?.skus.map(s => s.item) || []), ...result.items.filter(it => !inFeed.has(it.parent))]
    return items.flatMap(it => it.cells.filter(c => c.listed).map(c => ({ parent: it.parent, sku: it.sku, col: c.col })))
  }, [feed, result])
  const stateOf = useMemo(() => {
    const m = new Map()
    for (const g of groups) for (const s of g.skus) for (const [c, v] of Object.entries(s.cells)) m.set(`${s.sku}|${c}`, v.state)
    return m
  }, [groups])
  const [advanceFrom, setAdvanceFrom] = useState(initial.view === 'values' || ['dupes', 'changed', 'all'].includes(initial.state) ? null : { start: true })
  useEffect(() => {
    if (!advanceFrom) return
    const i = order.findIndex(o => o.sku === advanceFrom.sku && o.col === advanceFrom.col)
    let next = null
    for (let k = 1; k <= order.length && !next; k++) {
      const o = order[(i + k + order.length) % order.length]
      if (colMatches(colFilter, o.col) && stateOf.get(`${o.sku}|${o.col}`) === 'open') next = o
    }
    setAdvanceFrom(null)
    if (next) {
      // Not in the list (a filter or search hides it): widen to "needs attention".
      if (!feed.includes(next.parent)) { setPState('attention'); setQuery('') }
      setEditing(next); setFocus(next.parent)
    }
    else if (!advanceFrom.start) setEditing(null)
  }, [advanceFrom, stateOf, order])

  const keyFor = sc => sc === 'sku' ? decisionKey.sku(row.item, target.cell)
    : sc === 'parent' ? decisionKey.parent(row.item, target.cell) : decisionKey.all(target.cell)
  const decide = d => {
    setDecisions(prev => {
      const next = { ...prev }
      // A wider pick replaces narrower ones for this cell, so it takes effect here too.
      for (const sc of ['sku', 'parent', 'all']) {
        if (sc === scope) break
        delete next[keyFor(sc)]
      }
      next[keyFor(scope)] = d
      return next
    })
    setAdvanceFrom(editing)
  }
  const reset = () => setDecisions(prev => {
    const next = { ...prev }
    for (const sc of ['sku', 'parent', 'all']) delete next[keyFor(sc)]
    return next
  })
  const goNext = () => setAdvanceFrom(editing)
  const openCell = (g, s, c) => {
    if (editing?.sku === s.sku && editing?.col === c) { setEditing(null); return }
    setEditing({ parent: g.parent, sku: s.sku, col: c }); setFocus(g.parent); setScope('all')
  }

  // Keys while a value is open in the editor: 1–8 pick a suggestion, K keeps
  // the seller's value, N skips, Esc closes.
  useEffect(() => {
    if (view !== 'products' || !target) return
    const onKey = e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= suggestions.length) { e.preventDefault(); decide({ value: suggestions[n - 1] }) }
      else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); decide({ keep: true }) }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); goNext() }
      else if (e.key === 'Escape') setEditing(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── By value ──
  const vq = view === 'values' ? q : ''
  const vTest = { open: v => v.status === 'open', changed: v => v.status === 'changed', kept: v => v.status === 'kept', all: () => true }
  const vInCol = values.filter(v => colMatches(colFilter, v.col))
  const vCount = Object.fromEntries(Object.entries(vTest).map(([k, t]) => [k, vInCol.filter(t).length]))
  const vShown = vInCol.filter(v => vTest[vState](v) && (!vq || v.raw.toLowerCase().includes(vq) || v.now.some(n => String(n).toLowerCase().includes(vq))))
    .sort((a, b) => vState === 'changed' ? (RISK[b.how] ?? 0) - (RISK[a.how] ?? 0) || b.skus - a.skus : (b.open - a.open) || b.skus - a.skus)
  const fuzzy = vInCol.filter(v => v.status === 'changed' && v.how === 'similar').length
  const decideValue = (v, d) => setDecisions(prev => ({ ...prev, [v.key]: d }))
  const undoValue = v => setDecisions(prev => { const next = { ...prev }; delete next[v.key]; return next })
  const editedValue = values.find(v => v.key === valueEdit)
  const valueList = editedValue && result.lists?.[headerKey(editedValue.col)]
  const valueResults = useMemo(() => (valueList && valueSearch.trim() ? valueList.search(valueSearch, 30) : []), [valueList, valueSearch])
  const rowSuggest = useMemo(() => {
    const m = new Map()
    for (const v of vShown.slice(0, limit)) if (v.status === 'open' || v.key === valueEdit) m.set(v.key, result.lists?.[headerKey(v.col)]?.suggest(v.raw, v.key === valueEdit ? 8 : 3) || [])
    return m
  }, [vShown.map(v => v.key).join('\n'), limit, valueEdit, result.lists])
  // A value's products, as cards with all their variants.
  const showProducts = v => { setView('products'); setColFilter(`c:${v.col}`); setPState('all'); setQuery(v.raw); setEditing(null) }

  // ── Quick fixes (in each product card) ──
  // For a product whose variants need a look: complete ways to set a variant
  // column for all its SKUs at once (each SKU gets its own pick), and — on the
  // card last worked on — the same fix for every similar product (same
  // category and columns, same kind of fix).
  const fixKey = (sku, col) => `sku|${sku}|${col}`   // = decisionKey.sku
  const fixesOf = g => {
    const fixedHere = g.skus.some(s => COMBO_TARGETS.some(c => decisions[fixKey(s.sku, c)]))
    if (!variantTrouble(g) && !fixedHere) return []
    // Only the columns with the trouble (not on the list, numbered, size put in Color);
    // variants that are merely alike (or already fixed): every variant column.
    const troubled = c => g.skus.some(s => { const v = s.cells[c]; return (v && cellTrouble(v)) || s.item.aiDisagree?.some(d => d.col === c) })
    const variantCols = g.cols.filter(c => COMBO_TARGETS.includes(c))
    const cols = variantCols.some(troubled) ? variantCols.filter(troubled) : variantCols
    return cols.map(col => ({ col, plans: productFixes(g.skus.map(s => s.item), col, result.lists) })).filter(f => f.plans.length)
  }
  const fixesBy = useMemo(() => new Map(visible.map(g => [g.parent, fixesOf(g)])), [visible.map(g => g.parent).join('|'), groups])
  const focusGroup = visible.find(g => g.parent === focus) || visible.find(g => status(g) !== 'done')
  const similar = useMemo(() => {
    const fixes = focusGroup && fixesBy.get(focusGroup.parent)
    if (!fixes?.length) return {}
    const shape = g => `${g.category}|${(g.skus[0]?.item.applicable || []).join(',')}`
    const others = groups.filter(g => g.parent !== focusGroup.parent && shape(g) === shape(focusGroup) && variantTrouble(g))
    const out = {}
    for (const { col, plans } of fixes) for (const plan of plans) {
      out[`${col}|${plan.id}`] = others.map(g => productFixes(g.skus.map(s => s.item), col, result.lists).find(x => x.id === plan.id)).filter(Boolean)
    }
    return out
  }, [focusGroup?.parent, fixesBy, groups])
  const isApplied = (col, plan) => plan.values.every(r => decisions[fixKey(r.sku, col)]?.value === r.value)
  const applyFixes = (g, col, plans) => { setFocus(g.parent); setDecisions(prev => {
    const next = { ...prev }
    for (const plan of plans) for (const r of plan.values) next[fixKey(r.sku, col)] = r.onList ? { value: r.value } : { value: r.value, keep: true }
    return next
  }) }
  const undoFix = (col, plan) => setDecisions(prev => {
    const next = { ...prev }
    for (const r of plan.values) delete next[fixKey(r.sku, col)]
    return next
  })

  const btn = { display:'flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:8, fontSize:12.5, fontWeight:600, cursor:'pointer', border:'1.5px solid #e2e8f0', background:'#fff', color:'#334155' }
  const mini = { ...btn, padding:'3px 8px', fontSize:11.5, gap:4 }
  const chip = { padding:'5px 10px', borderRadius:16, fontSize:12, cursor:'pointer', border:'1px solid #c7d2fe', background:'#eef2ff', color:'#3730a3' }
  const seg = (on, label, click, key) => (
    <button key={key || label} onClick={click} style={{ padding:'5px 10px', border:'none', borderRadius:6, fontSize:11.5, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap',
      background: on ? '#fff' : 'transparent', color: on ? '#4f46e5' : '#64748b', boxShadow: on ? '0 1px 2px rgba(0,0,0,0.06)' : 'none' }}>{label}</button>
  )
  const segBox = { display:'flex', gap:2, background:'#f1f5f9', borderRadius:8, padding:3, flexWrap:'wrap' }

  // The match editor, right under the SKU row whose value is being matched.
  const editor = () => (
    <div data-cell-editor style={{ border:'1.5px solid #c7d2fe', borderRadius:10, padding:12, background:'#fafaff' }}>
      <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:8 }}>
        <div style={{ flex:1, fontSize:12.5 }}>
          <b>{colLabel(editing.col)}</b> for <span style={{ fontFamily:'monospace' }}>{row.sku}</span> — seller wrote <b>"{target.cell.raw}"</b>
          {target.value !== target.cell.raw && <> · now <b style={{ color:'#4338ca' }}>{target.value}</b></>}
          <span style={{ color:'#64748b' }}> · combo "{row.combo || '—'}"</span>
          {target.conflict && <div style={{ color:'#b45309', fontSize:12 }}>Auto-match undone: {target.conflict}</div>}
        </div>
        <button onClick={() => setEditing(null)} style={{ ...btn, padding:5 }} title="Close (Esc)"><X size={13} /></button>
      </div>
      <div style={{ display:'flex', gap:14, flexWrap:'wrap', fontSize:12, color:'#334155', marginBottom:8 }}>
        <span style={{ fontWeight:600 }}>Apply to:</span>
        {[['sku', 'this SKU only'],
          ['parent', `this product (${counts.parent.get(decisionKey.parent(row.item, target.cell)) || 1} SKU)`],
          ['all', `every SKU with "${target.cell.raw}" (${counts.all.get(decisionKey.all(target.cell)) || 1}) — remembered`]].map(([k, label]) => (
          <label key={k} style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
            <input type="radio" checked={scope === k} onChange={() => setScope(k)} style={{ accentColor:'#4f46e5' }} /> {label}
          </label>
        ))}
      </div>
      {suggestions.length > 0 && (
        <div style={{ marginBottom:8 }}>
          <div style={{ fontSize:11.5, color:'#64748b', marginBottom:5 }}>Closest on CartUp's {colLabel(editing.col)} list</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {suggestions.map((sg, n) => (
              <button key={sg} onClick={() => decide({ value: sg })} style={chip} title={`Key ${n + 1}`}>
                <span style={{ fontSize:10, opacity:0.6, marginRight:5 }}>{n + 1}</span>{sg}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ position:'relative', marginBottom:8, maxWidth:360 }}>
        <Search size={13} color='#94a3b8' style={{ position:'absolute', left:9, top:9 }} />
        <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search the list"
          onKeyDown={e => { if (e.key === 'Enter' && results[0]) decide({ value: results[0] }); if (e.key === 'Escape') e.currentTarget.blur() }}
          placeholder={`Search the ${list?.size?.toLocaleString() || ''} ${colLabel(editing.col)} values… (Enter = first)`}
          style={{ width:'100%', padding:'7px 10px 7px 28px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:12.5, boxSizing:'border-box' }} />
      </div>
      {results.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, maxHeight:110, overflow:'auto', marginBottom:8 }}>
          {results.map(r => <button key={r} onClick={() => decide({ value: r })} style={{ ...chip, background:'#fff' }}>{r}</button>)}
        </div>
      )}
      {search.trim() && !results.length && <div style={{ fontSize:12, color:'#94a3b8', marginBottom:8 }}>Nothing on the list contains "{search}".</div>}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
        <button onClick={() => decide({ keep: true })} style={{ ...btn, borderColor:'#fde68a', color:'#92400e' }}>
          <Plus size={13} /> Keep "{target.cell.raw}" as a new value <span style={{ fontSize:10, opacity:0.6 }}>K</span>
        </button>
        {editing.col === 'Warranty Period' && (
          <button onClick={() => decide({ noWarranty: true })} style={btn}><ShieldOff size={13} /> Set No Warranty (clears the period)</button>
        )}
        {editing.col === '**Brand' && (
          <button onClick={() => decide({ value: list?.match('No Brand')?.value || 'No Brand' })} style={btn}><ShieldOff size={13} /> No Brand</button>
        )}
        <button onClick={reset} style={btn}><RotateCcw size={13} /> Back to automatic</button>
        <button onClick={goNext} style={btn}>Skip <span style={{ fontSize:10, opacity:0.6 }}>N</span> <ChevronRight size={13} /></button>
        <span style={{ fontSize:11, color:'#94a3b8' }}>Keys: 1–8 pick · K keep · N next · Esc close</span>
      </div>
    </div>
  )

  // One product: the Parent SKU with every variant, its problems, its quick fixes.
  const card = g => {
    const st = status(g), look = CARD[st], fixes = fixesBy.get(g.parent) || []
    const focused = focusGroup?.parent === g.parent
    return (
      <div key={g.parent} data-product={g.parent} data-status={st} onClick={() => focus !== g.parent && setFocus(g.parent)}
        style={{ border:'1px solid #e2e8f0', borderLeft:`4px solid ${look.bar}`, borderRadius:12, padding:'12px 14px', marginBottom:12, background:'#fff',
          boxShadow: focused ? '0 2px 10px rgba(79,70,229,0.10)' : 'none' }}>
        <div style={{ display:'flex', gap:12, alignItems:'flex-start', marginBottom:10 }}>
          <Thumb src={g.skus[0]?.item.productImage} size={big ? 72 : 52} onOpen={setZoom} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:14 }}>{g.name || '(no name)'}</div>
            <div style={{ fontSize:12, color:'#64748b', marginTop:2, display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
              Parent SKU <span style={{ fontFamily:'monospace', fontWeight:600, color:'#334155' }}>{g.parent}</span><CopyButton text={g.parent} title="Copy the Parent SKU" />
              · {g.skus.length} variant{g.skus.length > 1 ? 's' : ''}<CopyButton text={g.skus.map(s => s.sku).join('\n')} label="Copy SKUs" title="Copy every Seller SKU of this product (one per line)" />
              {g.category ? <span>· {g.category}</span> : ''}
            </div>
            {g.skus[0]?.item.images?.length > 1 && (
              <div style={{ display:'flex', gap:4, marginTop:6, flexWrap:'wrap' }}>
                {g.skus[0].item.images.slice(0, 8).map((src, i) => <Thumb key={i} src={src} size={big ? 48 : 28} onOpen={setZoom} />)}
              </div>
            )}
          </div>
          <span style={{ ...look.badge, fontSize:11, fontWeight:700, borderRadius:12, padding:'3px 10px', display:'inline-flex', alignItems:'center', gap:4, whiteSpace:'nowrap' }}>
            {st === 'done' ? <><CheckCircle size={12} /> Done</> : st === 'open' ? `${g.open} ${look.label}` : look.label}
          </span>
        </div>

        {g.dupes.map(d => (
          <div key={d.join()} style={{ display:'flex', gap:6, alignItems:'center', fontSize:12, color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'6px 10px', marginBottom:8 }}>
            <AlertTriangle size={13} /> {d.join(', ')} have the same variant values — CartUp needs them different. Click a value to change it, or use a quick fix.
          </div>
        ))}

        <div style={{ border:'1px solid #eef2f7', borderRadius:9, overflow:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                {['', 'Seller SKU', 'Variations Combo'].map((h, i) => <th key={i} style={{ textAlign:'left', padding:'7px 10px', color:'#64748b', fontWeight:600, borderBottom:'1px solid #e2e8f0', whiteSpace:'nowrap' }}>{h}</th>)}
                {g.cols.map(c => (
                  <th key={c} style={{ textAlign:'left', padding:'7px 10px', fontWeight:600, borderBottom:'1px solid #e2e8f0', whiteSpace:'nowrap',
                    color: colFilter !== 'all' && colMatches(colFilter, c) ? '#4f46e5' : '#64748b', background: colFilter !== 'all' && colMatches(colFilter, c) ? '#eef2ff' : undefined }}>{colLabel(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.skus.map(s => {
                const editingRow = editing?.sku === s.sku && editing?.parent === g.parent && target
                return [
                  <tr key={s.sku} style={{ borderBottom: editingRow ? 'none' : '1px solid #f1f5f9', background: editingRow ? '#fafaff' : q && s.sku.toLowerCase().includes(q) ? '#fefce8' : undefined }}>
                    <td style={{ padding:'5px 10px', width: big ? 96 : 40 }}><Thumb src={s.item.image} size={big ? 96 : 40} onOpen={setZoom} /></td>
                    <td style={{ padding:'5px 10px', fontFamily:'monospace', fontSize:12 }}><span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>{s.sku}<CopyButton text={s.sku} title="Copy the Seller SKU" /></span></td>
                    <td style={{ padding:'5px 10px', color:'#475569' }}>{splitCombo(s.combo).join(' · ') || '—'}</td>
                    {g.cols.map(c => {
                      const v = s.cells[c]
                      if (!v) return <td key={c} style={{ padding:'5px 10px', color:'#cbd5e1' }}>—</td>
                      const active = editing?.sku === s.sku && editing?.col === c
                      return (
                        <td key={c} style={{ padding:'4px 8px' }}>
                          <div id={cellId(s.sku, c)} data-cell={c} data-state={v.state} onClick={e => { e.stopPropagation(); openCell(g, s, c) }}
                            title={v.conflict || v.note || 'Click to match or change'}
                            style={{ ...STATE_STYLE[v.state] || STATE_STYLE.ok, borderRadius:7, padding:'4px 8px', cursor:'pointer', minWidth:110, maxWidth:240,
                              outline: active ? '2px solid #4f46e5' : 'none', outlineOffset:1 }}>
                            <div style={{ fontWeight:600 }}>{v.noWarranty ? 'No Warranty' : v.value}</div>
                            {(v.state !== 'ok' || v.value !== v.cell.raw) && (
                              <div style={{ fontSize:10.5, opacity:0.8 }}>
                                {v.state === 'auto' && v.how ? HOW_NOTE[v.how] || STATE_NOTE.auto : STATE_NOTE[v.state]}{v.value !== v.cell.raw ? ` · was ${v.cell.raw}` : ''}
                              </div>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>,
                  editingRow && (
                    <tr key={`${s.sku}-edit`} style={{ borderBottom:'1px solid #f1f5f9', background:'#fafaff' }}>
                      <td colSpan={3 + g.cols.length} style={{ padding:'2px 10px 10px' }}>{editor()}</td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
        {g.open > 0 && !(editing?.parent === g.parent && target) && (
          <div style={{ marginTop:6, fontSize:11.5, color:'#64748b' }}>Click a red value to match it — you see the product's other variants while you pick.</div>
        )}

        {fixes.length > 0 && (
          <div data-quick-fix style={{ marginTop:10, border:'1px solid #c7d2fe', background:'#f5f7ff', borderRadius:10, padding:'9px 11px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, fontWeight:700, fontSize:12.5, color:'#3730a3', marginBottom:7 }}>
              <Wand2 size={14} /> Quick fix — set {fixes.map(f => colLabel(f.col)).join(' / ')} for all {g.skus.length} variants at once
            </div>
            {fixes.map(({ col, plans }) => (
              <div key={col} style={{ marginBottom:4 }}>
                {fixes.length > 1 && <div style={{ fontSize:11.5, fontWeight:700, color:'#475569', margin:'4px 0' }}>{colLabel(col)}</div>}
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {plans.map(plan => {
                    const applied = isApplied(col, plan)
                    const now = !applied && plan.values.every(r => g.skus.find(x => x.sku === r.sku)?.cells[col]?.value === r.value)
                    const more = focused ? similar[`${col}|${plan.id}`] || [] : []
                    return (
                      <div key={plan.id} data-fix={plan.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 10px', background:'#fff', border: applied ? '1.5px solid #22c55e' : '1px solid #e2e8f0', borderRadius:8, flexWrap:'wrap' }}>
                        <div style={{ minWidth:180 }}>
                          <div style={{ fontWeight:700, fontSize:12.5, color:'#0f172a' }}>{plan.label}{applied && <span style={{ color:'#15803d', fontWeight:600 }}> · in use</span>}{now && <span style={{ color:'#4f46e5', fontWeight:600 }}> · what it has now</span>}</div>
                          <div style={{ fontSize:11, color:'#64748b' }}>{plan.why}</div>
                        </div>
                        <div style={{ flex:1, display:'flex', flexWrap:'wrap', gap:4, minWidth:200 }}>
                          {plan.values.map(r => (
                            <span key={r.sku} title={`${r.sku}${r.onList ? '' : ' — new value'}`} style={{ fontSize:11.5, padding:'2px 8px', borderRadius:10,
                              background: r.onList ? '#ecfdf5' : '#fffbeb', color: r.onList ? '#065f46' : '#92400e', border: `1px solid ${r.onList ? '#a7f3d0' : '#fde68a'}` }}>{r.value}</span>
                          ))}
                        </div>
                        <span style={{ fontSize:11, color: plan.newValues ? '#92400e' : '#15803d', fontWeight:600, whiteSpace:'nowrap' }}>
                          {plan.newValues ? `${plan.newValues} new value${plan.newValues > 1 ? 's' : ''} for CartUp` : 'all on CartUp\'s list'}
                        </span>
                        {applied
                          ? <button onClick={() => undoFix(col, plan)} style={mini}><RotateCcw size={12} /> Undo</button>
                          : <button onClick={() => applyFixes(g, col, [plan])} style={{ ...mini, background:'#4f46e5', borderColor:'#4f46e5', color:'#fff' }}><Check size={12} /> Use this</button>}
                        {more.length > 0 && (
                          <button onClick={() => applyFixes(g, col, [plan, ...more])} style={mini} title={`Same category and columns: ${more.map(p => p.values[0]?.sku).slice(0, 5).join(', ')}…`}>
                            <Layers size={12} /> Use for this + {more.length} similar product{more.length > 1 ? 's' : ''}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            <div style={{ fontSize:11, color:'#64748b', marginTop:5 }}>
              Green = on CartUp's list · amber = a new value (the "new values" sheet, #N/A until CartUp adds it). A quick fix is a pick per variant — click any value above to change just one.
              {!focused && ' Click this card to also see "use for similar products".'}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Rendered into <body>: the page's entry animation leaves a transform on its
  // container, which would otherwise confine a fixed overlay to the content area.
  return createPortal(
    <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.5)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ width:'min(1280px, 100%)', height:'min(880px, 100%)', background:'#fff', borderRadius:14, display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 64px rgba(15,23,42,0.3)' }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 18px', borderBottom:'1px solid #e2e8f0', flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:260 }}>
            <div style={{ fontWeight:700, fontSize:15 }}>Check &amp; match values to CartUp's lists</div>
            <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
              {openCells
                ? <>{openCells.toLocaleString()} values in {openParents.toLocaleString()} products are not on CartUp's lists — pick a match, or keep the seller's value as a new list value.</>
                : <span style={{ color:'#15803d' }}>Every value is matched or decided.</span>}
            </div>
          </div>
          <div style={segBox}>
            {seg(view === 'products', <span style={{ display:'flex', alignItems:'center', gap:5 }}><Layers size={13} /> By product (with all variants)</span>, () => setView('products'), 'products')}
            {seg(view === 'values', <span style={{ display:'flex', alignItems:'center', gap:5 }}><Rows3 size={13} /> By value</span>, () => setView('values'), 'values')}
          </div>
          <button onClick={onClose} title="Close" style={{ ...btn, padding:7 }}><X size={15} /></button>
        </div>

        {/* Filters */}
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 18px', borderBottom:'1px solid #f1f5f9', background:'#fafbff', flexWrap:'wrap' }}>
          <Filter size={13} color='#64748b' />
          <select aria-label="Column" value={colFilter} onChange={e => { setColFilter(e.target.value); setEditing(null) }}
            style={{ padding:'5px 8px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:12, background:'#fff' }}>
            <option value="all">All columns</option>
            {groupsPresent.length > 1 && groupsPresent.map(g => <option key={g} value={`g:${g}`}>{GROUP_LABEL[g]}</option>)}
            {columns.map(([c, open]) => <option key={c} value={`c:${c}`}>{colLabel(c)}{open ? ` — ${open} open` : ''}</option>)}
          </select>
          {view === 'products' ? (
            <div style={segBox}>
              {[['attention', 'Needs attention'], ['variants', 'Variants to check'], ['open', 'Open values'], ['dupes', 'Same variant'], ['changed', 'Changed automatically'], ['all', 'All']]
                .map(([k, label]) => seg(pState === k, `${label} (${pCount[k]})`, () => { setPState(k); setEditing(null) }, k))}
            </div>
          ) : (
            <div style={segBox}>
              {[['open', 'Not on list'], ['changed', 'Matched automatically'], ['kept', 'Kept as new'], ['all', 'All']]
                .map(([k, label]) => seg(vState === k, `${label} (${vCount[k]})`, () => { setVState(k); setLimit(200) }, k))}
            </div>
          )}
          <div style={{ position:'relative', flex:1, minWidth:200, maxWidth:340 }}>
            <Search size={13} color='#94a3b8' style={{ position:'absolute', left:9, top:8 }} />
            <input value={query} onChange={e => setQuery(e.target.value)} aria-label="Search"
              placeholder={view === 'products' ? 'Parent SKU, Seller SKU, name or value' : 'Seller value or CartUp value'}
              style={{ width:'100%', padding:'6px 10px 6px 28px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:12.5, boxSizing:'border-box' }} />
          </div>
          {view === 'products' && (
            <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'#475569', cursor:'pointer' }}>
              <input type="checkbox" checked={big} onChange={e => setBig(e.target.checked)} style={{ accentColor:'#4f46e5' }} /> Large images
            </label>
          )}
          {(colFilter !== 'all' || query) && <button onClick={() => { setColFilter('all'); setQuery('') }} style={{ ...mini, border:'none', background:'none', color:'#4f46e5' }}>Clear filters</button>}
        </div>

        {view === 'values' ? (
          <div style={{ flex:1, overflow:'auto', padding:'12px 18px' }}>
            <div style={{ fontSize:12.5, color:'#475569', marginBottom:10, lineHeight:1.5 }}>
              {vState === 'changed'
                ? <>Seller values the system matched to another CartUp value. <b>Close spelling</b> matches are listed first{fuzzy ? ` (${fuzzy})` : ''} — they're the ones worth a glance. Pick another value if one is wrong.</>
                : <>Each seller value once, for all products. Pick the CartUp value, keep it as a <b>new value</b> for CartUp to add{colFilter === 'c:**Brand' || colFilter === 'g:brand' ? <>, or use <b>No Brand</b></> : ''}. A pick here covers every SKU with that value and is remembered for next time. To see a value with its product's other variants, use <b>In product</b>.</>}
            </div>
            <div style={{ border:'1px solid #e2e8f0', borderRadius:10, overflow:'hidden' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
                <thead>
                  <tr style={{ background:'#f8fafc' }}>
                    {['Column', 'Seller value', 'Seller SKU', 'Products', 'SKUs', 'Now', ''].map((h, i) => <th key={i} style={{ textAlign:'left', padding:'8px 10px', color:'#64748b', fontWeight:600, borderBottom:'1px solid #e2e8f0', whiteSpace:'nowrap' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {vShown.slice(0, limit).map(v => {
                    const style = STATE_STYLE[v.status === 'changed' ? (v.by || 'changed') : v.status] || STATE_STYLE.ok
                    const sugg = rowSuggest.get(v.key) || []
                    const editingThis = valueEdit === v.key
                    return [
                      <tr key={v.key} style={{ borderBottom: editingThis ? 'none' : '1px solid #f1f5f9', background: editingThis ? '#fafaff' : '#fff' }}>
                        <td style={{ padding:'7px 10px', color:'#64748b', whiteSpace:'nowrap' }}>{colLabel(v.col)}</td>
                        <td style={{ padding:'7px 10px', fontWeight:600 }} title={v.conflict || ''}>{v.raw}{v.conflict && <AlertTriangle size={11} color='#b45309' style={{ marginLeft:5, verticalAlign:'-1px' }} />}</td>
                        <td style={{ padding:'5px 10px', whiteSpace:'nowrap' }}>
                          <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
                            <span style={{ fontFamily:'monospace', fontSize:11.5, color:'#334155', maxWidth:210, overflow:'hidden', textOverflow:'ellipsis' }} title={v.skuList.join('\n')}>{v.skuList[0]}</span>
                            {v.skuList.length > 1 && <span style={{ fontSize:11, color:'#64748b' }}>+{v.skuList.length - 1}</span>}
                            <CopyButton text={v.skuList.join('\n')} title={v.skuList.length > 1 ? `Copy the ${v.skuList.length} Seller SKUs (one per line)` : 'Copy the Seller SKU'} />
                          </span>
                        </td>
                        <td style={{ padding:'7px 10px' }}>{v.parents.size}</td>
                        <td style={{ padding:'7px 10px' }}>{v.skus}</td>
                        <td style={{ padding:'5px 10px' }}>
                          <span style={{ ...style, borderRadius:7, padding:'3px 8px', display:'inline-block', maxWidth:260 }}>
                            {v.status === 'open' ? (v.open < v.skus ? `${v.open} of ${v.skus} open` : '—') : v.now.slice(0, 3).join(', ') + (v.now.length > 3 ? ` +${v.now.length - 3}` : '')}
                            <span style={{ fontSize:10.5, opacity:0.8, marginLeft:5 }}>
                              {v.status === 'open' ? 'not on list' : v.status === 'kept' ? 'new value' : v.status === 'ok' ? 'on list' : v.decided ? 'picked' : v.by === 'remembered' ? 'remembered' : HOW_NOTE[v.how] || 'changed'}
                            </span>
                          </span>
                        </td>
                        <td style={{ padding:'5px 10px' }}>
                          <div style={{ display:'flex', gap:5, flexWrap:'wrap', justifyContent:'flex-end', alignItems:'center' }}>
                            {v.status === 'open' && !editingThis && sugg.map(sg => <button key={sg} onClick={() => decideValue(v, { value: sg })} style={{ ...chip, padding:'3px 9px', fontSize:11.5 }} title={`Use "${sg}" for every SKU with "${v.raw}"`}>{sg}</button>)}
                            {v.col === '**Brand' && <button onClick={() => decideValue(v, { value: result.lists?.[headerKey('**Brand')]?.match('No Brand')?.value || 'No Brand' })} style={mini}><ShieldOff size={12} /> No Brand</button>}
                            {v.col === 'Warranty Period' && <button onClick={() => decideValue(v, { noWarranty: true })} style={mini}><ShieldOff size={12} /> No Warranty</button>}
                            {v.status !== 'kept' && v.status !== 'ok' && <button onClick={() => decideValue(v, { keep: true })} style={{ ...mini, borderColor:'#fde68a', color:'#92400e' }}><Plus size={12} /> Keep as new</button>}
                            <button onClick={() => { setValueEdit(editingThis ? null : v.key); setValueSearch('') }} style={mini}><Tag size={12} /> Pick…</button>
                            {v.decided && <button onClick={() => undoValue(v)} style={mini} title="Back to automatic"><RotateCcw size={12} /></button>}
                            <button onClick={() => showProducts(v)} style={{ ...mini, border:'none', background:'none', color:'#4f46e5' }} title="See it in its product, next to the other variants">In product <ChevronRight size={12} /></button>
                          </div>
                        </td>
                      </tr>,
                      editingThis && (
                        <tr key={`${v.key}-edit`} style={{ borderBottom:'1px solid #f1f5f9', background:'#fafaff' }}>
                          <td colSpan={7} style={{ padding:'4px 10px 12px' }}>
                            <div style={{ fontSize:12, color:'#475569', marginBottom:6 }}>CartUp's {colLabel(v.col)} value for <b>"{v.raw}"</b> — every SKU with it, remembered:</div>
                            {sugg.length > 0 && (
                              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:8 }}>
                                {sugg.map(sg => <button key={sg} onClick={() => { decideValue(v, { value: sg }); setValueEdit(null) }} style={chip}>{sg}</button>)}
                              </div>
                            )}
                            <div style={{ position:'relative', maxWidth:360 }}>
                              <Search size={13} color='#94a3b8' style={{ position:'absolute', left:9, top:9 }} />
                              <input value={valueSearch} onChange={e => setValueSearch(e.target.value)} autoFocus aria-label="Search the list"
                                onKeyDown={e => { if (e.key === 'Enter' && valueResults[0]) { decideValue(v, { value: valueResults[0] }); setValueEdit(null) } if (e.key === 'Escape') setValueEdit(null) }}
                                placeholder={`Search the ${valueList?.size?.toLocaleString() || ''} ${colLabel(v.col)} values… (Enter = first)`}
                                style={{ width:'100%', padding:'7px 10px 7px 28px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:12.5, boxSizing:'border-box' }} />
                            </div>
                            {valueResults.length > 0 && (
                              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8, maxHeight:110, overflow:'auto' }}>
                                {valueResults.map(r => <button key={r} onClick={() => { decideValue(v, { value: r }); setValueEdit(null) }} style={{ ...chip, background:'#fff' }}>{r}</button>)}
                              </div>
                            )}
                            {valueSearch.trim() && !valueResults.length && <div style={{ fontSize:12, color:'#94a3b8', marginTop:6 }}>Nothing on the list contains "{valueSearch}".</div>}
                          </td>
                        </tr>
                      ),
                    ]
                  })}
                </tbody>
              </table>
              {!vShown.length && <div style={{ padding:16, fontSize:12.5, color:'#15803d' }}>{vState === 'open' ? 'Nothing left to match here.' : 'No values match.'}</div>}
            </div>
            {vShown.length > limit && <button onClick={() => setLimit(l => l + 300)} style={{ ...btn, marginTop:10 }}>Show more ({(vShown.length - limit).toLocaleString()} left)</button>}
          </div>
        ) : (
          <div data-product-feed style={{ flex:1, overflow:'auto', padding:'12px 18px', background:'#f8fafc' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:12, color:'#475569', marginBottom:10, flexWrap:'wrap' }}>
              <span><b>{feed.length.toLocaleString()}</b> product{feed.length === 1 ? '' : 's'} (Parent SKU) with all their variants</span>
              {doneInFeed > 0 && <span style={{ color:'#15803d', fontWeight:600 }}>· {doneInFeed.toLocaleString()} done ✓</span>}
              <span style={{ color:'#94a3b8' }}>· click a red value to match it; the next one opens by itself</span>
            </div>
            {visible.map(card)}
            {feed.length > cards && <button onClick={() => setCards(n => n + PAGE)} style={{ ...btn, margin:'4px auto 8px' }}>Show more products ({(feed.length - cards).toLocaleString()} left)</button>}
            {!feed.length && <div style={{ padding:16, fontSize:12.5, color: pState === 'attention' || pState === 'open' ? '#15803d' : '#64748b' }}>{pState === 'attention' || pState === 'open' ? 'Nothing needs attention here.' : 'No products match the filters.'}</div>}
          </div>
        )}

        {/* Footer */}
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 18px', borderTop:'1px solid #e2e8f0', background:'#f8fafc', flexWrap:'wrap' }}>
          <div style={{ flex:1, fontSize:12, color:'#64748b', minWidth:240 }}>
            {openCells > 0 && <>Values left open go to the <b>new values</b> sheet as "not reviewed" (they show #N/A until matched or added). </>}
            {remembered > 0 && <>{remembered.toLocaleString()} remembered picks · <button onClick={onForgetMemory} style={{ border:'none', background:'none', color:'#4f46e5', cursor:'pointer', padding:0, fontSize:12 }}>forget them</button></>}
          </div>
          <button onClick={onClose} style={btn}>Close</button>
          <button onClick={onDownload} style={{ ...btn, background:'#4f46e5', borderColor:'#4f46e5', color:'#fff' }}><Download size={14} /> Download file</button>
        </div>
      </div>

      {zoom && (
        <div onClick={() => setZoom(null)} style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.75)', zIndex:110, display:'flex', alignItems:'center', justifyContent:'center', cursor:'zoom-out', padding:24 }}>
          <img src={zoom} alt="" style={{ maxWidth:'90vw', maxHeight:'88vh', borderRadius:10, background:'#fff' }} />
        </div>
      )}
    </div>,
    document.body,
  )
}
