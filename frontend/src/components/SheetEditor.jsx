import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { headerKey, colLabel } from '../utils/variantReview'
import { ISSUE_TYPES } from '../utils/checks'
import { COLUMN_SECTIONS } from '../utils/processor'
import CopyButton from './CopyButton'
import { HoverZoomToggle, zoomProps, hideZoom } from './HoverZoom'
import { X, Search, Download, RotateCcw, Check, AlertTriangle, ImageOff, ChevronRight, ChevronLeft, Replace, Trash2, Undo2,
  Table2, ListChecks, Pencil, Columns3, Eye, EyeOff, Sparkles, Box, CircleSlash } from 'lucide-react'

// The whole output sheet, Excel-style, built around one job: find what needs
// fixing and fix it quickly.
//   left    — what to show: every row, rows needing attention, each problem
//             type (red = fix, amber = check) with counts, and which column
//             groups to show (or only the columns with problems)
//   middle  — the grid: rows virtualised so thousands stay smooth; Seller SKU
//             fixed on the left; problem cells marked; tick rows to delete
//             them from the upload (or restore them), or copy their SKUs
//   right   — the selected cell: its problem, the value (list suggestions and
//             search for dropdown columns), the same value for the whole
//             product, previous / next problem
// Find & replace changes hundreds of cells in one go. Every change is a hand
// edit, kept per Seller SKU and applied (and logged) when the file is built.

const ROW_H = 34, BAND_H = 22, HEAD_H = 34
const CHECK_W = 36, NUM_W = 46, THUMB_W = 40, SKU_W = 190
const FIRST_W = CHECK_W + NUM_W + THUMB_W + SKU_W
const WIDE = /name|highlight|description|box|policy|path|report|image|combo|tags/i
const widthOf = c => (WIDE.test(c) ? 230 : 140)
const AI_MISSED = 'AI unavailable'
const STOCK_COL = '**Current Stock Qty'
// Filters that aren't problem types: the column they are about.
const SPECIAL_COL = { name: '**Name (English)', stock0: STOCK_COL }
const SECTION_COLOR = { 'Basic Information': '#6366f1', 'Product Attribute': '#10b981', 'Product Description': '#f59e0b', Service: '#ec4899', Delivery: '#0ea5e9', 'Variant Attribute': '#8b5cf6', Extra: '#94a3b8' }
const LEVEL = { error: { bg: '#fef2f2', bar: '#ef4444', text: '#991b1b', soft: '#fee2e2' }, warn: { bg: '#fffbeb', bar: '#f59e0b', text: '#92400e', soft: '#fef3c7' } }

// initialFilter: 'problems' | 'all' | 'edited' | 'deleted' | 'name' | 'stock0' | an ISSUE_TYPES key
export default function SheetEditor({ output, items, columns, lists, issues, keyOf, edits, setEdits, deleted = new Set(), setDeleted = () => {}, initialFilter = 'problems', onDownload, onClose }) {
  const rows = output.rows
  useEffect(() => hideZoom, [])   // the sheet closes: no image preview left behind
  const [filter, setFilter] = useState(initialFilter)
  const [colOnly, setColOnly] = useState(SPECIAL_COL[initialFilter] || null)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(null)       // { i, col } — the cell in the side panel
  const [draft, setDraft] = useState('')
  const [toParent, setToParent] = useState(false)
  const [picked, setPicked] = useState(() => new Set())   // ticked rows
  const [lastTick, setLastTick] = useState(null)
  const [hidden, setHidden] = useState(() => new Set())   // column sections not shown
  const [problemCols, setProblemCols] = useState(false)   // only columns with problems
  const [listQuery, setListQuery] = useState('')
  const [fr, setFr] = useState(null)         // find & replace: { find, to, col, whole, matchCase, inView }
  const [frDone, setFrDone] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const scroller = useRef(null)
  const input = useRef(null)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const isEdited = (i, c) => edits[keyOf(i)]?.[c] !== undefined
  const isDeleted = i => deleted.has(keyOf(i))
  const aiMissed = i => String(items[i]?.nameHow || '').includes(AI_MISSED)

  // Counts per problem type, per column and per row.
  const { typeCounts, colCounts, problemRows } = useMemo(() => {
    const typeCounts = {}, colCounts = {}, problemRows = new Set()
    for (const [k, v] of issues) {
      const bar = k.indexOf('|')
      typeCounts[v.type] = (typeCounts[v.type] || 0) + 1
      const c = k.slice(bar + 1)
      colCounts[c] = (colCounts[c] || 0) + 1
      problemRows.add(+k.slice(0, bar))
    }
    return { typeCounts, colCounts, problemRows }
  }, [issues])
  const all = useMemo(() => rows.map((_, i) => i), [rows])
  const editedRows = useMemo(() => all.filter(i => Object.keys(edits[keyOf(i)] || {}).length), [all, edits])
  const deletedRows = useMemo(() => all.filter(isDeleted), [all, deleted])
  const missedRows = useMemo(() => all.filter(aiMissed), [all, items])
  const stockZero = i => String(rows[i][STOCK_COL] ?? '').trim() !== '' && Number(rows[i][STOCK_COL]) === 0
  const zeroRows = useMemo(() => all.filter(stockZero), [all, rows])
  const editCount = Object.values(edits).reduce((n, r) => n + Object.keys(r).length, 0)
  const fixTypes = Object.entries(ISSUE_TYPES).filter(([t, d]) => d.level === 'error' && typeCounts[t])
  const checkTypes = Object.entries(ISSUE_TYPES).filter(([t, d]) => d.level === 'warn' && typeCounts[t])
  const fixCells = fixTypes.reduce((n, [t]) => n + typeCounts[t], 0), checkCells = checkTypes.reduce((n, [t]) => n + typeCounts[t], 0)

  // Columns shown: by section, minus hidden sections (or only those with problems).
  const sections = useMemo(() => {
    const known = new Set(COLUMN_SECTIONS.flatMap(s => s.cols))
    const list = COLUMN_SECTIONS.map(s => ({ ...s, cols: s.cols.filter(c => columns.includes(c)) }))
    const rest = columns.filter(c => !known.has(c))
    if (rest.length) list[list.length - 1].cols.push(...rest)
    return list.filter(s => s.cols.length)
  }, [columns])
  const cols = useMemo(() => sections.filter(s => !hidden.has(s.name)).flatMap(s => s.cols).filter(c => !problemCols || colCounts[c] || c === colOnly), [sections, hidden, problemCols, colCounts, colOnly])
  const sectionOf = useMemo(() => Object.fromEntries(sections.flatMap(s => s.cols.map(c => [c, s.name]))), [sections])

  // Is this cell one the current view is about?
  const wanted = (i, c) => {
    if (colOnly && c !== colOnly) return false
    if (filter === 'edited') return isEdited(i, c)
    if (filter === 'name') return c === '**Name (English)' && aiMissed(i)
    if (filter === 'stock0') return c === STOCK_COL && stockZero(i)
    const issue = issues.get(`${i}|${c}`)
    return !!issue && (filter === 'problems' || filter === 'all' || filter === 'deleted' || issue.type === filter)
  }
  const q = query.trim().toLowerCase()
  const shown = useMemo(() => all.filter(i => {
    if (filter === 'deleted' ? !isDeleted(i) : filter !== 'all' && isDeleted(i)) return false
    if (filter === 'edited' && !colOnly) { if (!editedRows.includes(i)) return false }
    else if ((filter !== 'all' && filter !== 'deleted') || colOnly) { if (!columns.some(c => wanted(i, c))) return false }
    return !q || ['**Seller SKU', '**Parent Sku', '**Name (English)'].some(c => String(rows[i][c] ?? '').toLowerCase().includes(q))
  }), [all, filter, colOnly, issues, edits, deleted, q, columns])

  const colX = useMemo(() => {
    const x = {}
    let at = FIRST_W
    for (const c of cols) { x[c] = at; at += widthOf(c) }
    return x
  }, [cols])
  const totalW = FIRST_W + cols.reduce((n, c) => n + widthOf(c), 0)
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 6)
  const last = Math.min(shown.length, Math.ceil((scrollTop + height) / ROW_H) + 6)

  const select = (i, col) => { setSel({ i, col }); setDraft(String(rows[i][col] ?? '')); setListQuery('') }
  // Bring a cell into view.
  const reveal = (i, col) => {
    const el = scroller.current
    const n = shown.indexOf(i)
    if (!el || n < 0) return
    const top = n * ROW_H, head = BAND_H + HEAD_H
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - head - ROW_H * 2) el.scrollTop = Math.max(0, top - el.clientHeight / 3)
    const x = colX[col]
    if (x === undefined) return
    if (x - FIRST_W < el.scrollLeft || x + widthOf(col) > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, x - FIRST_W - 40)
  }
  // The cells the view is about, in order — for previous / next problem.
  const problemCells = useMemo(() => {
    const out = []
    for (const i of shown) for (const c of cols) if (filter === 'all' && !colOnly ? issues.has(`${i}|${c}`) : wanted(i, c)) out.push({ i, col: c })
    return out
  }, [shown, cols, filter, colOnly, issues, edits])
  const step = dir => {
    if (!problemCells.length) return
    const at = sel ? problemCells.findIndex(p => p.i === sel.i && p.col === sel.col) : -1
    let k
    if (at >= 0) k = (at + dir + problemCells.length) % problemCells.length
    else if (sel) {
      // From a cell that isn't a problem: the first problem after (or before) it.
      const n = shown.indexOf(sel.i)
      k = problemCells.findIndex(p => shown.indexOf(p.i) > n || (p.i === sel.i && cols.indexOf(p.col) > cols.indexOf(sel.col)))
      if (dir < 0) k = (k < 0 ? problemCells.length : k) - 1
      if (k < 0) k = dir > 0 ? 0 : problemCells.length - 1
    } else k = dir > 0 ? 0 : problemCells.length - 1
    const p = problemCells[k]
    select(p.i, p.col); reveal(p.i, p.col)
  }

  // Rows of the selected SKU's Parent SKU, for "same value for all".
  const siblings = useMemo(() => {
    if (!sel) return []
    const parent = String(rows[sel.i]['**Parent Sku'] ?? '')
    return parent ? all.filter(i => String(rows[i]['**Parent Sku'] ?? '') === parent) : [sel.i]
  }, [sel?.i, rows])

  const commit = andNext => {
    if (!sel) return
    const targets = toParent && siblings.length > 1 ? siblings : [sel.i]
    setEdits(prev => {
      const next = { ...prev }
      for (const i of targets) next[keyOf(i)] = { ...(next[keyOf(i)] || {}), [sel.col]: draft }
      return next
    })
    if (andNext) step(1)
  }
  const resetCell = () => {
    if (!sel) return
    const k = keyOf(sel.i)
    setEdits(prev => {
      const row = { ...(prev[k] || {}) }
      delete row[sel.col]
      const next = { ...prev, [k]: row }
      if (!Object.keys(row).length) delete next[k]
      return next
    })
  }
  // Keep the draft in step with the cell once edits are applied.
  useEffect(() => { if (sel) setDraft(String(rows[sel.i]?.[sel.col] ?? '')) }, [rows])

  // Keyboard: F8 / Shift+F8 next / previous problem; arrows move between cells; Esc closes the panel.
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'F8') { e.preventDefault(); step(e.shiftKey ? -1 : 1); return }
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)
      if (e.key === 'Escape') { if (typing) document.activeElement.blur(); else if (sel) setSel(null); return }
      if (typing || !sel) return
      const n = shown.indexOf(sel.i), c = cols.indexOf(sel.col)
      const move = (dn, dc) => {
        e.preventDefault()
        const i = shown[Math.min(shown.length - 1, Math.max(0, n + dn))], col = cols[Math.min(cols.length - 1, Math.max(0, c + dc))]
        if (i !== undefined && col) { select(i, col); reveal(i, col) }
      }
      if (e.key === 'ArrowDown') move(1, 0)
      else if (e.key === 'ArrowUp') move(-1, 0)
      else if (e.key === 'ArrowRight') move(0, 1)
      else if (e.key === 'ArrowLeft') move(0, -1)
      else if (e.key === 'Enter') { e.preventDefault(); input.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Dropdown columns: suggestions and a search of the whole CartUp list.
  const list = sel && lists?.[headerKey(sel.col)]
  const onList = !!list && !!draft.trim() && list.match(draft.trim())?.how === 'exact'
  const suggestions = useMemo(() => {
    if (!list) return []
    const t = draft.trim()
    if (!t || list.match(t)?.how === 'exact') return []
    return [...new Set([...list.suggest(t, 6), ...list.search(t, 8)])].slice(0, 10)
  }, [list, draft])
  const searched = useMemo(() => list && listQuery.trim() ? list.search(listQuery.trim(), 30) : [], [list, listQuery])
  const selIssue = sel && issues.get(`${sel.i}|${sel.col}`)
  const item = sel && items[sel.i]

  // Ticked rows: delete from the upload, restore, copy their Seller SKUs.
  const tick = (i, shift) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (shift && lastTick !== null && shown.includes(lastTick)) {
        const [a, b] = [shown.indexOf(lastTick), shown.indexOf(i)].sort((x, y) => x - y)
        const on = !prev.has(i)
        for (const r of shown.slice(a, b + 1)) on ? next.add(r) : next.delete(r)
      } else next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
    setLastTick(i)
  }
  const allTicked = shown.length > 0 && shown.every(i => picked.has(i))
  const tickAll = () => setPicked(allTicked ? new Set() : new Set(shown))
  const pickedRows = [...picked].filter(i => i < rows.length)
  const pickedDeleted = pickedRows.filter(isDeleted).length
  const removeRows = del => {
    setDeleted(prev => {
      const next = new Set(prev)
      for (const i of pickedRows) del ? next.add(keyOf(i)) : next.delete(keyOf(i))
      return next
    })
    setPicked(new Set())
  }

  // Find & replace — every matching cell becomes a hand edit.
  const escapeRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const frMatches = useMemo(() => {
    if (!fr || !fr.find) return []
    const inCols = fr.col ? [fr.col] : columns
    const re = new RegExp(fr.whole ? `^\\s*${escapeRe(fr.find.trim())}\\s*$` : escapeRe(fr.find), fr.matchCase ? 'g' : 'gi')
    const out = []
    for (const i of fr.inView ? shown : all) for (const c of inCols) {
      const v = String(rows[i][c] ?? '')
      re.lastIndex = 0
      if (v && re.test(v)) { re.lastIndex = 0; out.push({ i, c, to: fr.whole ? fr.to : v.replace(re, () => fr.to) }) }
    }
    return out
  }, [fr, rows, columns, shown])
  const frRows = useMemo(() => new Set(frMatches.map(m => m.i)).size, [frMatches])
  const frList = fr?.col && lists?.[headerKey(fr.col)]
  const frOnList = !frList || !fr.to.trim() || frList.match(fr.to.trim())?.how === 'exact'
  const replaceAll = () => {
    if (!frMatches.length) return
    setEdits(prev => {
      const next = { ...prev }
      for (const m of frMatches) next[keyOf(m.i)] = { ...(next[keyOf(m.i)] || {}), [m.c]: m.to }
      return next
    })
    setFrDone(`Replaced in ${frMatches.length.toLocaleString()} cell${frMatches.length === 1 ? '' : 's'} (${frRows.toLocaleString()} row${frRows === 1 ? '' : 's'})`)
  }

  // A problem type scrolls the grid to the first column that has it.
  const pickFilter = f => {
    setFilter(f); setColOnly(SPECIAL_COL[f] || null); setPicked(new Set())
    if (!scroller.current) return
    scroller.current.scrollTop = 0
    let col = SPECIAL_COL[f]
    if (!col && ISSUE_TYPES[f]) {
      const withType = new Set([...issues].filter(([, v]) => v.type === f).map(([k]) => k.slice(k.indexOf('|') + 1)))
      col = cols.find(c => withType.has(c))
    }
    scroller.current.scrollLeft = col && colX[col] !== undefined ? Math.max(0, colX[col] - FIRST_W - 40) : 0
  }
  const toggleSection = name => setHidden(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })

  // ── styles ──
  const btn = { display:'inline-flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:8, fontSize:12.5, fontWeight:600, cursor:'pointer', border:'1px solid #e2e8f0', background:'#fff', color:'#334155', whiteSpace:'nowrap' }
  const primary = { ...btn, background:'#4f46e5', borderColor:'#4f46e5', color:'#fff' }
  const field = { padding:'7px 10px', border:'1px solid #cbd5e1', borderRadius:8, fontSize:12.5, background:'#fff', outline:'none' }
  const navItem = (key, label, count, { dot, icon } = {}) => {
    const on = filter === key
    return (
      <button key={key} onClick={() => pickFilter(key)} data-nav={key}
        style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'7px 10px', border:'none', borderRadius:8, cursor:'pointer', textAlign:'left', fontSize:12.5,
          background: on ? '#eef2ff' : 'transparent', color: on ? '#3730a3' : '#334155', fontWeight: on ? 700 : 500 }}>
        {dot ? <span style={{ width:8, height:8, borderRadius:4, background:dot, flexShrink:0 }} /> : icon}
        <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={label}>{label}</span>
        <span style={{ fontSize:11.5, fontVariantNumeric:'tabular-nums', color: on ? '#4338ca' : '#94a3b8', fontWeight:600 }}>{count.toLocaleString()}</span>
      </button>
    )
  }
  const navHead = t => <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'0.06em', color:'#94a3b8', textTransform:'uppercase', padding:'12px 10px 4px' }}>{t}</div>
  const filterLabel = filter === 'problems' ? 'Rows needing attention' : filter === 'all' ? 'All rows' : filter === 'edited' ? 'Edited by hand' : filter === 'deleted' ? 'Deleted rows'
    : filter === 'name' ? 'Names not cleaned by AI' : filter === 'stock0' ? 'Stock 0' : ISSUE_TYPES[filter]?.label || filter

  return createPortal(
    <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.55)', zIndex:100, display:'flex', padding:10 }}>
      <div data-sheet-editor style={{ flex:1, background:'#fff', borderRadius:14, display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 64px rgba(15,23,42,0.35)', minWidth:0 }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 16px', borderBottom:'1px solid #e2e8f0' }}>
          <div style={{ width:34, height:34, borderRadius:9, background:'#eef2ff', display:'flex', alignItems:'center', justifyContent:'center' }}><Table2 size={17} color='#4f46e5' /></div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:15, color:'#0f172a' }}>Upload sheet</div>
            <div style={{ display:'flex', gap:12, fontSize:12, color:'#64748b', flexWrap:'wrap' }}>
              <span>{(rows.length - deletedRows.length).toLocaleString()} rows in the upload</span>
              <span style={{ color: fixCells ? '#b91c1c' : '#15803d' }}>● {fixCells.toLocaleString()} to fix</span>
              <span style={{ color: checkCells ? '#b45309' : '#64748b' }}>● {checkCells.toLocaleString()} to check</span>
              <span style={{ color:'#2563eb' }}>{editCount.toLocaleString()} edit{editCount === 1 ? '' : 's'}</span>
              {deletedRows.length > 0 && <span>{deletedRows.length.toLocaleString()} deleted</span>}
            </div>
          </div>
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            <button onClick={onDownload} style={primary}><Download size={14} /> Download file</button>
            <button onClick={onClose} style={{ ...btn, padding:8 }} title="Close (your edits are kept)"><X size={15} /></button>
          </div>
        </div>

        <div style={{ flex:1, display:'flex', minHeight:0 }}>
          {/* Sidebar: what to show */}
          <div style={{ width:236, flexShrink:0, borderRight:'1px solid #e2e8f0', background:'#f8fafc', overflow:'auto', padding:'6px 8px 12px' }}>
            {navHead('View')}
            {navItem('problems', 'Needs attention', [...problemRows].filter(i => !isDeleted(i)).length, { icon: <ListChecks size={14} color='#4f46e5' /> })}
            {navItem('all', 'All rows', rows.length, { icon: <Table2 size={14} color='#64748b' /> })}
            {fixTypes.length > 0 && <>{navHead('To fix')}{fixTypes.map(([t, d]) => navItem(t, d.label, typeCounts[t], { dot: '#ef4444' }))}</>}
            {checkTypes.length > 0 && <>{navHead('To check')}{checkTypes.map(([t, d]) => navItem(t, d.label, typeCounts[t], { dot: '#f59e0b' }))}</>}
            {navHead('More')}
            {missedRows.length > 0 && navItem('name', 'Names not cleaned by AI', missedRows.length, { icon: <Sparkles size={14} color='#a855f7' /> })}
            {zeroRows.length > 0 && navItem('stock0', 'Stock 0', zeroRows.length, { icon: <Box size={14} color='#64748b' /> })}
            {navItem('edited', 'Edited by hand', editedRows.length, { icon: <Pencil size={14} color='#2563eb' /> })}
            {navItem('deleted', 'Deleted rows', deletedRows.length, { icon: <CircleSlash size={14} color='#64748b' /> })}

            {navHead('Columns')}
            <label style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', fontSize:12.5, cursor:'pointer', color:'#334155' }}>
              <input type="checkbox" checked={problemCols} onChange={e => setProblemCols(e.target.checked)} style={{ accentColor:'#4f46e5' }} /> Only columns with problems
            </label>
            {sections.map(s => {
              const n = s.cols.reduce((t, c) => t + (colCounts[c] || 0), 0)
              const off = hidden.has(s.name)
              return (
                <button key={s.name} onClick={() => toggleSection(s.name)} title={off ? 'Show these columns' : 'Hide these columns'}
                  style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'6px 10px', border:'none', borderRadius:8, cursor:'pointer', background:'transparent', fontSize:12.5, color: off ? '#94a3b8' : '#334155', textAlign:'left' }}>
                  <span style={{ width:4, height:14, borderRadius:2, background: off ? '#cbd5e1' : SECTION_COLOR[s.name] || '#94a3b8', flexShrink:0 }} />
                  <span style={{ flex:1 }}>{s.name}</span>
                  {n > 0 && <span style={{ fontSize:11, color:'#b91c1c', fontWeight:700 }}>{n}</span>}
                  {off ? <EyeOff size={13} /> : <Eye size={13} color='#94a3b8' />}
                </button>
              )
            })}
          </div>

          {/* Main */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
            {/* Toolbar */}
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 12px', borderBottom:'1px solid #e2e8f0', flexWrap:'wrap' }}>
              <div style={{ fontWeight:700, fontSize:13, color:'#0f172a', marginRight:4 }}>{filterLabel} <span style={{ color:'#94a3b8', fontWeight:500 }}>· {shown.length.toLocaleString()} row{shown.length === 1 ? '' : 's'}</span></div>
              {colOnly && (
                <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, background:'#eef2ff', color:'#3730a3', borderRadius:14, padding:'3px 6px 3px 10px' }}>
                  <Columns3 size={12} /> {colLabel(colOnly)}
                  <button onClick={() => setColOnly(null)} title="Every column" style={{ border:'none', background:'none', cursor:'pointer', color:'#3730a3', display:'flex', padding:2 }}><X size={12} /></button>
                </span>
              )}
              <HoverZoomToggle style={{ marginLeft:'auto' }} />
              <div style={{ position:'relative' }}>
                <Search size={13} color='#94a3b8' style={{ position:'absolute', left:10, top:10 }} />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search Seller / Parent SKU or name" aria-label="Search rows"
                  style={{ ...field, paddingLeft:30, width:230 }} />
              </div>
              <button onClick={() => { setFr(f => f ? null : { find: sel ? String(rows[sel.i][sel.col] ?? '') : '', to: '', col: sel?.col || colOnly || '', whole: !!sel, matchCase: false, inView: false }); setFrDone('') }}
                style={{ ...btn, ...(fr ? { background:'#eef2ff', borderColor:'#c7d2fe', color:'#3730a3' } : {}) }} title="Replace a value in many cells at once"><Replace size={14} /> Find &amp; replace</button>
              <div style={{ display:'flex' }}>
                <button onClick={() => step(-1)} disabled={!problemCells.length} style={{ ...btn, borderRadius:'8px 0 0 8px', padding:'7px 9px' }} title="Previous problem (Shift+F8)"><ChevronLeft size={14} /></button>
                <button onClick={() => step(1)} disabled={!problemCells.length} style={{ ...btn, borderRadius:'0 8px 8px 0', borderLeft:'none' }} title="Next problem (F8)">Next problem <ChevronRight size={14} /></button>
              </div>
            </div>

            {/* Find & replace */}
            {fr && (
              <div data-find-replace style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 12px', borderBottom:'1px solid #e2e8f0', background:'#f8fafc', flexWrap:'wrap', fontSize:12.5 }}>
                <input aria-label="Find" value={fr.find} onChange={e => { setFr({ ...fr, find: e.target.value }); setFrDone('') }} placeholder="Find (e.g. Multi Color)" style={{ ...field, width:180 }} autoFocus />
                <ChevronRight size={14} color='#94a3b8' />
                <input aria-label="Replace with" value={fr.to} onChange={e => { setFr({ ...fr, to: e.target.value }); setFrDone('') }} placeholder="Replace with (empty = clear)" style={{ ...field, width:180 }} />
                <select aria-label="In column" value={fr.col} onChange={e => { setFr({ ...fr, col: e.target.value }); setFrDone('') }} style={{ ...field, maxWidth:180 }}>
                  <option value="">Every column</option>
                  {columns.map(c => <option key={c} value={c}>{colLabel(c)}</option>)}
                </select>
                {[['whole', 'Whole cell'], ['matchCase', 'Match case'], ['inView', 'Only rows shown']].map(([k, l]) => (
                  <label key={k} style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer', color:'#334155' }}>
                    <input type="checkbox" checked={fr[k]} onChange={e => setFr({ ...fr, [k]: e.target.checked })} style={{ accentColor:'#4f46e5' }} /> {l}
                  </label>
                ))}
                <span data-fr-count style={{ color: frMatches.length ? '#0f172a' : '#94a3b8', fontWeight:600 }}>
                  {fr.find ? `${frMatches.length.toLocaleString()} cell${frMatches.length === 1 ? '' : 's'} · ${frRows.toLocaleString()} row${frRows === 1 ? '' : 's'}` : 'type what to find'}
                </span>
                {!frOnList && <span style={{ color:'#b45309', display:'flex', alignItems:'center', gap:4 }}><AlertTriangle size={13} /> "{fr.to}" isn't on CartUp's {colLabel(fr.col)} list (#N/A)</span>}
                <button onClick={replaceAll} disabled={!frMatches.length} style={{ ...primary, padding:'6px 12px', opacity: frMatches.length ? 1 : 0.45 }}>Replace all</button>
                {frDone && <span data-fr-done style={{ color:'#15803d', display:'flex', alignItems:'center', gap:4 }}><Check size={13} /> {frDone} — Edited by hand shows them</span>}
              </div>
            )}

            {/* Ticked rows */}
            {pickedRows.length > 0 && (
              <div data-selection style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', borderBottom:'1px solid #c7d2fe', background:'#eef2ff', fontSize:12.5, color:'#3730a3', flexWrap:'wrap' }}>
                <b>{pickedRows.length.toLocaleString()} row{pickedRows.length === 1 ? '' : 's'} selected</b>
                {pickedRows.length > pickedDeleted && <button onClick={() => removeRows(true)} style={{ ...btn, padding:'5px 10px', color:'#b91c1c', borderColor:'#fecaca' }}><Trash2 size={13} /> Delete from upload</button>}
                {pickedDeleted > 0 && <button onClick={() => removeRows(false)} style={{ ...btn, padding:'5px 10px' }}><Undo2 size={13} /> Restore {pickedDeleted}</button>}
                <CopyButton text={pickedRows.map(i => rows[i]['**Seller SKU']).join('\n')} label="Copy Seller SKUs" title="Copy the selected rows' Seller SKUs (one per line)" style={{ padding:'5px 10px', fontSize:12 }} />
                <button onClick={() => setPicked(new Set())} style={{ ...btn, padding:'5px 10px', border:'none', background:'none', color:'#4f46e5' }}>Clear selection</button>
                <span style={{ color:'#6366f1', fontSize:11.5 }}>Deleted rows leave the upload and are listed in "invalid"; restore them any time. Shift-click ticks a range.</span>
              </div>
            )}

            {/* Grid */}
            <div ref={scroller} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} style={{ flex:1, overflow:'auto', position:'relative', fontSize:12.5 }}>
              <div style={{ width: totalW, height: BAND_H + HEAD_H + shown.length * ROW_H, position:'relative' }}>
                {/* Section band + column headers */}
                <div style={{ position:'sticky', top:0, zIndex:3, width: totalW, background:'#f8fafc' }}>
                  <div style={{ display:'flex', height:BAND_H }}>
                    <div style={{ position:'sticky', left:0, zIndex:4, width:FIRST_W, flexShrink:0, background:'#f1f5f9', borderRight:'1px solid #e2e8f0' }} />
                    {sections.filter(s => !hidden.has(s.name)).map(s => {
                      const n = s.cols.filter(c => cols.includes(c))
                      if (!n.length) return null
                      return <div key={s.name} style={{ width: n.reduce((t, c) => t + widthOf(c), 0), flexShrink:0, fontSize:10.5, fontWeight:700, letterSpacing:'0.04em', textTransform:'uppercase', color: SECTION_COLOR[s.name], padding:'4px 8px', borderBottom:`2px solid ${SECTION_COLOR[s.name]}`, boxSizing:'border-box', overflow:'hidden', whiteSpace:'nowrap' }}>{s.name}</div>
                    })}
                  </div>
                  <div style={{ display:'flex', height:HEAD_H, borderBottom:'1px solid #e2e8f0' }}>
                    <div style={{ position:'sticky', left:0, zIndex:4, width:FIRST_W, flexShrink:0, background:'#f1f5f9', display:'flex', alignItems:'center', borderRight:'1px solid #e2e8f0', fontWeight:700, color:'#475569' }}>
                      <span style={{ width:CHECK_W, display:'flex', justifyContent:'center' }}><input type="checkbox" checked={allTicked} onChange={tickAll} aria-label="Select all rows shown" style={{ accentColor:'#4f46e5' }} /></span>
                      <span style={{ width:NUM_W, color:'#94a3b8', fontWeight:600 }}>Row</span>
                      <span style={{ width:THUMB_W }} />
                      <span>Seller SKU</span>
                    </div>
                    {cols.map(c => (
                      <div key={c} title={c} style={{ width:widthOf(c), flexShrink:0, padding:'0 8px', display:'flex', alignItems:'center', gap:5, fontWeight:600, color: colOnly === c ? '#4f46e5' : '#475569', background: colOnly === c ? '#eef2ff' : undefined, borderRight:'1px solid #eef2f7', overflow:'hidden', whiteSpace:'nowrap', boxSizing:'border-box' }}>
                        <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{colLabel(c)}{c.startsWith('**') && <span style={{ color:'#ef4444' }}> *</span>}</span>
                        {colCounts[c] > 0 && (
                          <button onClick={() => { setColOnly(colOnly === c ? null : c); if (filter === 'all' || filter === 'deleted') setFilter('problems') }} title={colOnly === c ? 'Show every column' : `Only rows with a problem in ${colLabel(c)}`}
                            style={{ fontSize:10, fontWeight:700, color:'#b91c1c', background:'#fee2e2', borderRadius:8, padding:'1px 6px', border:'none', cursor:'pointer' }}>{colCounts[c]}</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {shown.slice(first, last).map((i, n) => {
                  const r = rows[i]
                  const gone = isDeleted(i), ticked = picked.has(i), selRow = sel?.i === i
                  const it = items[i]
                  return (
                    <div key={i} data-row={r['**Seller SKU']} style={{ position:'absolute', top: BAND_H + HEAD_H + (first + n) * ROW_H, left:0, height:ROW_H, width: totalW, display:'flex', borderBottom:'1px solid #f1f5f9', opacity: gone ? 0.5 : 1, background: ticked ? '#f5f7ff' : '#fff' }}>
                      <div style={{ position:'sticky', left:0, zIndex:2, width:FIRST_W, flexShrink:0, display:'flex', alignItems:'center', borderRight:'1px solid #e2e8f0',
                        background: ticked ? '#eef2ff' : selRow ? '#f8fafc' : problemRows.has(i) && !gone ? '#fffafa' : '#fcfcfd', boxShadow: selRow ? 'inset 3px 0 0 #4f46e5' : 'none' }}>
                        <span style={{ width:CHECK_W, display:'flex', justifyContent:'center' }}>
                          <input type="checkbox" checked={ticked} onChange={() => {}} onClick={e => tick(i, e.shiftKey)} aria-label={`Select ${r['**Seller SKU']}`} style={{ accentColor:'#4f46e5', cursor:'pointer' }} />
                        </span>
                        <span style={{ width:NUM_W, color:'#94a3b8', fontVariantNumeric:'tabular-nums', fontSize:11.5 }}>{i + 3}</span>
                        <span style={{ width:THUMB_W }}><Thumb src={it?.image || it?.productImage} size={26} /></span>
                        <span style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', gap:5, paddingRight:8 }}>
                          <span style={{ fontFamily:'monospace', fontSize:11.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textDecoration: gone ? 'line-through' : 'none', color:'#0f172a' }} title={r['**Seller SKU']}>{r['**Seller SKU']}</span>
                          {gone && <span style={{ fontSize:10, background:'#f1f5f9', color:'#64748b', borderRadius:6, padding:'1px 5px' }}>deleted</span>}
                        </span>
                      </div>
                      {cols.map(c => {
                        const issue = !gone && issues.get(`${i}|${c}`)
                        const lv = issue && LEVEL[issue.level]
                        const active = selRow && sel.col === c
                        const edited = isEdited(i, c)
                        return (
                          <div key={c} onClick={() => select(i, c)} onDoubleClick={() => { select(i, c); setTimeout(() => input.current?.focus(), 0) }} title={issue?.text || String(r[c] ?? '')}
                            style={{ width:widthOf(c), flexShrink:0, padding:'0 8px', display:'flex', alignItems:'center', gap:5, cursor:'cell', whiteSpace:'nowrap', overflow:'hidden', position:'relative', boxSizing:'border-box',
                              background: lv ? lv.bg : edited ? '#eff6ff' : 'transparent', borderRight:'1px solid #f3f4f6', boxShadow: lv ? `inset 3px 0 0 ${lv.bar}` : 'none',
                              outline: active ? '2px solid #4f46e5' : 'none', outlineOffset:-2, color: lv?.text || '#1e293b', opacity: colOnly && c !== colOnly && !active ? 0.5 : 1 }}>
                            <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{String(r[c] ?? '') || (issue ? <span style={{ color: lv.bar, fontStyle:'italic', fontSize:11.5 }}>empty</span> : '')}</span>
                            {edited && <span style={{ position:'absolute', top:4, right:4, width:6, height:6, borderRadius:3, background:'#3b82f6' }} title="Edited by hand" />}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
              {!shown.length && (
                <div style={{ position:'absolute', top: BAND_H + HEAD_H + 30, left:0, right:0, textAlign:'center', fontSize:13.5, color:'#15803d' }}>
                  <Check size={22} style={{ display:'block', margin:'0 auto 6px' }} />
                  {q ? 'No rows match the search.' : filter === 'deleted' ? 'No deleted rows.' : filter === 'all' ? 'No rows.' : 'Nothing here — all clear.'}
                </div>
              )}
            </div>

            {/* Status bar */}
            <div style={{ display:'flex', gap:16, alignItems:'center', padding:'6px 12px', borderTop:'1px solid #e2e8f0', background:'#f8fafc', fontSize:11.5, color:'#64748b', flexWrap:'wrap' }}>
              <span><span style={{ display:'inline-block', width:10, height:10, background:'#fef2f2', boxShadow:'inset 3px 0 0 #ef4444', marginRight:5, verticalAlign:'-1px' }} />to fix</span>
              <span><span style={{ display:'inline-block', width:10, height:10, background:'#fffbeb', boxShadow:'inset 3px 0 0 #f59e0b', marginRight:5, verticalAlign:'-1px' }} />to check</span>
              <span><span style={{ display:'inline-block', width:6, height:6, borderRadius:3, background:'#3b82f6', marginRight:5 }} />edited</span>
              <span style={{ marginLeft:'auto' }}>Click a cell to edit · ↑↓←→ move · Enter edit · F8 next problem · Esc close</span>
            </div>
          </div>

          {/* Side panel: the selected cell */}
          {sel && rows[sel.i] && (
            <div data-cell-panel style={{ width:340, flexShrink:0, borderLeft:'1px solid #e2e8f0', display:'flex', flexDirection:'column', background:'#fff', minHeight:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 14px', borderBottom:'1px solid #f1f5f9' }}>
                <span style={{ width:4, height:18, borderRadius:2, background: SECTION_COLOR[sectionOf[sel.col]] || '#94a3b8' }} />
                <div style={{ fontWeight:700, fontSize:14, color:'#0f172a', flex:1 }}>{colLabel(sel.col)}</div>
                <button onClick={() => setSel(null)} style={{ ...btn, padding:6, border:'none' }} title="Close (Esc)"><X size={15} /></button>
              </div>
              <div style={{ flex:1, overflow:'auto', padding:14, display:'flex', flexDirection:'column', gap:12 }}>
                {/* The row */}
                <div style={{ display:'flex', gap:10, padding:10, border:'1px solid #e2e8f0', borderRadius:10, background:'#fafafa' }}>
                  <Thumb src={item?.image || item?.productImage} size={56} />
                  <div style={{ minWidth:0, flex:1, fontSize:12 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ fontFamily:'monospace', fontWeight:700, color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{rows[sel.i]['**Seller SKU']}</span>
                      <CopyButton text={String(rows[sel.i]['**Seller SKU'] ?? '')} title="Copy the Seller SKU" />
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:6, color:'#64748b', marginTop:3 }}>
                      Parent <span style={{ fontFamily:'monospace' }}>{rows[sel.i]['**Parent Sku']}</span>
                      <CopyButton text={String(rows[sel.i]['**Parent Sku'] ?? '')} title="Copy the Parent SKU" size={11} />
                    </div>
                    <div style={{ color:'#334155', marginTop:4, lineHeight:1.35, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{rows[sel.i]['**Name (English)']}</div>
                    <div style={{ color:'#94a3b8', marginTop:3 }}>Row {sel.i + 3}{item?.combo ? ` · ${item.combo}` : ''}{isDeleted(sel.i) ? ' · deleted' : ''}</div>
                  </div>
                </div>

                {/* Its problem */}
                {selIssue && (
                  <div style={{ display:'flex', gap:8, padding:'9px 11px', borderRadius:9, background: LEVEL[selIssue.level].soft, color: LEVEL[selIssue.level].text, fontSize:12.5, lineHeight:1.45 }}>
                    <AlertTriangle size={15} style={{ flexShrink:0, marginTop:1 }} />
                    <div><b>{ISSUE_TYPES[selIssue.type]?.label}</b><div>{selIssue.text}</div></div>
                  </div>
                )}

                {/* The value */}
                <div>
                  <div style={{ fontSize:11.5, fontWeight:700, color:'#475569', marginBottom:5, display:'flex', alignItems:'center', gap:6 }}>
                    Value {isEdited(sel.i, sel.col) && <span style={{ color:'#2563eb', fontWeight:600 }}>· edited</span>}
                    {list && draft.trim() && <span style={{ marginLeft:'auto', fontWeight:600, color: onList ? '#15803d' : '#b91c1c' }}>{onList ? '✓ on CartUp\'s list' : '✕ not on the list (#N/A)'}</span>}
                  </div>
                  {WIDE.test(sel.col) && !list ? (
                    <textarea ref={input} aria-label="Cell value" value={draft} onChange={e => setDraft(e.target.value)} rows={5}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(true) } }}
                      style={{ ...field, width:'100%', boxSizing:'border-box', fontFamily:'inherit', resize:'vertical', lineHeight:1.45 }} />
                  ) : (
                    <input ref={input} aria-label="Cell value" value={draft} onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(true) } }}
                      style={{ ...field, width:'100%', boxSizing:'border-box', fontSize:13.5, padding:'9px 11px' }} />
                  )}
                  {sel.col === '**Name (English)' && item?.darazName && item.darazName !== rows[sel.i][sel.col] && (
                    <div style={{ fontSize:11.5, color:'#64748b', marginTop:5 }}>Daraz: "{item.darazName}" <button onClick={() => setDraft(item.darazName)} style={{ border:'none', background:'none', color:'#4f46e5', cursor:'pointer', padding:0, fontSize:11.5 }}>use it</button></div>
                  )}
                  <div style={{ fontSize:11, color:'#94a3b8', marginTop:5 }}>{WIDE.test(sel.col) && !list ? 'Ctrl+Enter saves and goes to the next problem' : 'Enter saves and goes to the next problem'}</div>
                </div>

                {/* CartUp list */}
                {list && (
                  <div>
                    {suggestions.length > 0 && <>
                      <div style={{ fontSize:11.5, fontWeight:700, color:'#475569', marginBottom:6 }}>Closest CartUp values</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
                        {suggestions.map(o => <button key={o} onClick={() => setDraft(o)} style={{ padding:'5px 10px', borderRadius:16, fontSize:12, cursor:'pointer', border:'1px solid #c7d2fe', background: draft === o ? '#4f46e5' : '#eef2ff', color: draft === o ? '#fff' : '#3730a3' }}>{o}</button>)}
                      </div>
                    </>}
                    <div style={{ position:'relative' }}>
                      <Search size={13} color='#94a3b8' style={{ position:'absolute', left:10, top:10 }} />
                      <input value={listQuery} onChange={e => setListQuery(e.target.value)} placeholder={`Search the ${colLabel(sel.col)} list…`} aria-label="Search the CartUp list"
                        onKeyDown={e => { if (e.key === 'Enter' && searched[0]) { setDraft(searched[0]); setListQuery('') } }}
                        style={{ ...field, width:'100%', boxSizing:'border-box', paddingLeft:30 }} />
                    </div>
                    {searched.length > 0 && (
                      <div style={{ marginTop:6, border:'1px solid #e2e8f0', borderRadius:8, maxHeight:180, overflow:'auto' }}>
                        {searched.map(o => <button key={o} onClick={() => { setDraft(o); setListQuery('') }} style={{ display:'block', width:'100%', textAlign:'left', padding:'6px 10px', border:'none', borderBottom:'1px solid #f1f5f9', background:'#fff', cursor:'pointer', fontSize:12.5 }}>{o}</button>)}
                      </div>
                    )}
                    {listQuery.trim() && !searched.length && <div style={{ fontSize:12, color:'#94a3b8', marginTop:6 }}>Nothing on the list contains "{listQuery}".</div>}
                  </div>
                )}

                {siblings.length > 1 && (
                  <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:12.5, color:'#334155', cursor:'pointer', padding:'8px 10px', borderRadius:8, background:'#f8fafc', border:'1px solid #e2e8f0' }}>
                    <input type="checkbox" checked={toParent} onChange={e => setToParent(e.target.checked)} style={{ accentColor:'#4f46e5' }} />
                    Same value for all {siblings.length} SKUs of this product
                  </label>
                )}
              </div>

              {/* Actions */}
              <div style={{ padding:12, borderTop:'1px solid #e2e8f0', display:'flex', flexDirection:'column', gap:8 }}>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => commit(true)} style={{ ...primary, flex:1, justifyContent:'center' }}><Check size={14} /> Save &amp; next</button>
                  <button onClick={() => commit(false)} style={{ ...btn, justifyContent:'center' }}>Save</button>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => step(-1)} disabled={!problemCells.length} style={{ ...btn, flex:1, justifyContent:'center' }}><ChevronLeft size={14} /> Previous</button>
                  <button onClick={() => step(1)} disabled={!problemCells.length} style={{ ...btn, flex:1, justifyContent:'center' }}>Next <ChevronRight size={14} /></button>
                  {isEdited(sel.i, sel.col) && <button onClick={resetCell} style={btn} title="Back to the value before your edit"><RotateCcw size={13} /></button>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Thumb({ src, size = 52 }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  const ok = src && /^https?:\/\//.test(src) && !failed
  return (
    <div style={{ width:size, height:size, borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', flexShrink:0, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
      {ok ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} {...zoomProps(src)} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <ImageOff size={Math.max(12, size / 3)} color='#cbd5e1' />}
    </div>
  )
}
