import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { headerKey, colLabel } from '../utils/variantReview'
import { ISSUE_TYPES } from '../utils/checks'
import { X, Search, Download, RotateCcw, Check, AlertTriangle, ImageOff, Filter, ChevronRight } from 'lucide-react'

// The whole output sheet, Excel-style: every row and column, problem cells
// marked, any cell editable. Rows are virtualised so thousands stay smooth.
//   red    — would be rejected: not on CartUp's list (#N/A), no category, required and empty
//   amber  — flagged: weight starting with 0.00, image link without a key…
//   blue   — edited here
// Filter by problem type or by column (click a column's count), jump from
// problem to problem, and give one value to every SKU of a Parent SKU at once.
// Edits are kept per Seller SKU and applied (and logged) when the file is built.

const ROW_H = 30, HEAD_H = 34, FIRST_W = 210
const WIDE = /name|highlight|description|box|policy|path|report|image|combo/i
const widthOf = c => (WIDE.test(c) ? 220 : 130)
const AI_MISSED = 'AI unavailable'
const STOCK_COL = '**Current Stock Qty'
// Filters that aren't problem types: the column they are about.
const SPECIAL_COL = { name: '**Name (English)', stock0: STOCK_COL }

// initialFilter: 'problems' | 'all' | 'edited' | 'name' | 'stock0' | an ISSUE_TYPES key
export default function SheetEditor({ output, items, columns, lists, issues, keyOf, edits, setEdits, initialFilter = 'problems', onDownload, onClose }) {
  const rows = output.rows
  const [filter, setFilter] = useState(initialFilter)
  const [colOnly, setColOnly] = useState(SPECIAL_COL[initialFilter] || null)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(null)       // { i, col }
  const [draft, setDraft] = useState('')
  const [toParent, setToParent] = useState(false)
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
  const aiMissed = i => String(items[i]?.nameHow || '').includes(AI_MISSED)

  // Counts per problem type and per column.
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
  const editedRows = useMemo(() => rows.map((_, i) => i).filter(i => Object.keys(edits[keyOf(i)] || {}).length), [rows, edits])
  const missedRows = useMemo(() => rows.map((_, i) => i).filter(aiMissed), [rows, items])
  const stockZero = i => String(rows[i][STOCK_COL] ?? '').trim() !== '' && Number(rows[i][STOCK_COL]) === 0
  const zeroRows = useMemo(() => rows.map((_, i) => i).filter(stockZero), [rows])

  // Is this cell one the current filter is about?
  const wanted = (i, c) => {
    if (colOnly && c !== colOnly) return false
    if (filter === 'edited') return isEdited(i, c)
    if (filter === 'name') return c === '**Name (English)' && aiMissed(i)
    if (filter === 'stock0') return c === STOCK_COL && stockZero(i)
    const issue = issues.get(`${i}|${c}`)
    return !!issue && (filter === 'problems' || filter === 'all' || issue.type === filter)
  }
  const q = query.trim().toLowerCase()
  const shown = useMemo(() => rows.map((_, i) => i).filter(i =>
    (filter === 'all' && !colOnly ? true : columns.some(c => wanted(i, c))) &&
    (!q || String(rows[i]['**Seller SKU'] ?? '').toLowerCase().includes(q) || String(rows[i]['**Parent Sku'] ?? '').toLowerCase().includes(q) || String(rows[i]['**Name (English)'] ?? '').toLowerCase().includes(q))
  ), [rows, filter, colOnly, issues, edits, q, columns])

  const colX = useMemo(() => {
    const x = {}
    let at = FIRST_W
    for (const c of columns) { x[c] = at; at += widthOf(c) }
    return x
  }, [columns])
  const totalW = FIRST_W + columns.reduce((n, c) => n + widthOf(c), 0)
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 5)
  const last = Math.min(shown.length, Math.ceil((scrollTop + height) / ROW_H) + 5)

  const select = (i, col) => { setSel({ i, col }); setDraft(String(rows[i][col] ?? '')) }
  useEffect(() => { if (sel) input.current?.focus() }, [sel])

  // Bring a cell into view.
  const reveal = (i, col) => {
    const el = scroller.current
    const n = shown.indexOf(i)
    if (!el || n < 0) return
    const top = n * ROW_H
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - HEAD_H - ROW_H * 2) el.scrollTop = Math.max(0, top - el.clientHeight / 3)
    const x = colX[col]
    if (x - FIRST_W < el.scrollLeft || x + widthOf(col) > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, x - FIRST_W - 40)
  }
  // The next cell the filter is about, after the selected one (wrapping round).
  const nextProblem = () => {
    if (!shown.length) return
    const start = sel ? Math.max(0, shown.indexOf(sel.i)) : 0
    const startCol = sel && shown.includes(sel.i) ? columns.indexOf(sel.col) + 1 : 0
    for (let n = 0; n <= shown.length; n++) {
      const i = shown[(start + n) % shown.length]
      for (let k = n === 0 ? startCol : 0; k < columns.length; k++) {
        const c = columns[k]
        if (filter === 'all' && !colOnly ? issues.has(`${i}|${c}`) : wanted(i, c)) {
          if (sel && sel.i === i && sel.col === c) continue
          select(i, c); reveal(i, c)
          return
        }
      }
    }
  }
  useEffect(() => {
    const onKey = e => { if (e.key === 'F8') { e.preventDefault(); nextProblem() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Rows of the selected SKU's Parent SKU, for "same value for all".
  const siblings = useMemo(() => {
    if (!sel) return []
    const parent = String(rows[sel.i]['**Parent Sku'] ?? '')
    return parent ? rows.map((r, i) => i).filter(i => String(rows[i]['**Parent Sku'] ?? '') === parent) : [sel.i]
  }, [sel?.i, rows])

  const commit = (andNext = false) => {
    if (!sel) return
    const targets = toParent && siblings.length > 1 ? siblings : [sel.i]
    setEdits(prev => {
      const next = { ...prev }
      for (const i of targets) next[keyOf(i)] = { ...(next[keyOf(i)] || {}), [sel.col]: draft }
      return next
    })
    if (andNext && filter !== 'all' && filter !== 'edited') nextProblem()
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
  useEffect(() => { if (sel) setDraft(String(rows[sel.i]?.[sel.col] ?? "")) }, [rows])

  const list = sel && lists?.[headerKey(sel.col)]
  const options = useMemo(() => {
    if (!list) return []
    const t = draft.trim()
    const exact = list.match(t)
    if (exact?.how === 'exact') return []
    return t ? [...new Set([...list.search(t, 12), ...list.suggest(t, 6)])].slice(0, 14) : []
  }, [list, draft])
  const selIssue = sel && issues.get(`${sel.i}|${sel.col}`)
  const editCount = Object.values(edits).reduce((n, r) => n + Object.keys(r).length, 0)
  const item = sel && items[sel.i]
  const pickFilter = f => {
    setFilter(f)
    if (SPECIAL_COL[f]) setColOnly(SPECIAL_COL[f])
    if (scroller.current) {
      scroller.current.scrollTop = 0
      if (SPECIAL_COL[f]) scroller.current.scrollLeft = Math.max(0, colX[SPECIAL_COL[f]] - FIRST_W - 40)
    }
  }

  const tbtn = { display:'flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:8, fontSize:12.5, fontWeight:600, cursor:'pointer', border:'1.5px solid #e2e8f0', background:'#fff', color:'#334155' }
  const cellBg = (lvl, edited) => lvl === 'error' ? '#fee2e2' : lvl === 'warn' ? '#fef3c7' : edited ? '#eff6ff' : '#fff'

  return createPortal(
    <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.5)', zIndex:100, display:'flex', padding:12 }}>
      <div style={{ flex:1, background:'#fff', borderRadius:12, display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 64px rgba(15,23,42,0.3)' }}>
        {/* Toolbar */}
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:'1px solid #e2e8f0', flexWrap:'wrap' }}>
          <div style={{ fontWeight:700, fontSize:14.5 }}>Upload sheet — view &amp; edit</div>
          <div style={{ fontSize:12, color:'#64748b' }}>
            {rows.length.toLocaleString()} rows · <span style={{ color: problemRows.size ? '#b91c1c' : '#15803d' }}>{problemRows.size.toLocaleString()} with problems</span> · {editCount} edits
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <Filter size={13} color='#64748b' />
            <select aria-label="Show" value={filter} onChange={e => pickFilter(e.target.value)}
              style={{ padding:'6px 8px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:12, background:'#fff' }}>
              <option value="problems">Rows with problems ({problemRows.size.toLocaleString()})</option>
              {Object.entries(ISSUE_TYPES).filter(([t]) => typeCounts[t]).map(([t, { label }]) => <option key={t} value={t}>{label} ({typeCounts[t].toLocaleString()})</option>)}
              {missedRows.length > 0 && <option value="name">Names not cleaned by AI ({missedRows.length.toLocaleString()})</option>}
              {zeroRows.length > 0 && <option value="stock0">Stock 0 ({zeroRows.length.toLocaleString()})</option>}
              <option value="edited">Edited by hand ({editedRows.length.toLocaleString()})</option>
              <option value="all">All rows ({rows.length.toLocaleString()})</option>
            </select>
          </div>
          {colOnly && (
            <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, background:'#eef2ff', color:'#3730a3', borderRadius:14, padding:'3px 6px 3px 10px' }}>
              Column: <b>{colLabel(colOnly)}</b>
              <button onClick={() => setColOnly(null)} title="All columns" style={{ border:'none', background:'none', cursor:'pointer', color:'#3730a3', display:'flex', padding:2 }}><X size={12} /></button>
            </span>
          )}
          <div style={{ position:'relative' }}>
            <Search size={13} color='#94a3b8' style={{ position:'absolute', left:9, top:9 }} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Seller / Parent SKU or name"
              style={{ padding:'7px 10px 7px 28px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:12.5, width:200 }} />
          </div>
          <button onClick={nextProblem} disabled={!shown.length} style={tbtn} title="Next problem cell (F8)">Next problem <ChevronRight size={13} /></button>
          <div style={{ display:'flex', gap:10, fontSize:11, color:'#64748b', marginLeft:'auto', alignItems:'center' }}>
            <span><span style={{ display:'inline-block', width:10, height:10, background:'#fee2e2', border:'1px solid #fecaca', marginRight:4 }} />fix</span>
            <span><span style={{ display:'inline-block', width:10, height:10, background:'#fef3c7', border:'1px solid #fde68a', marginRight:4 }} />check</span>
            <span><span style={{ display:'inline-block', width:10, height:10, background:'#eff6ff', border:'1px solid #bfdbfe', marginRight:4 }} />edited</span>
          </div>
          <button onClick={onDownload} style={{ ...tbtn, background:'#4f46e5', borderColor:'#4f46e5', color:'#fff' }}><Download size={14} /> Download file</button>
          <button onClick={onClose} style={{ ...tbtn, padding:7 }} title="Close"><X size={15} /></button>
        </div>

        {/* Grid */}
        <div ref={scroller} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} style={{ flex:1, overflow:'auto', position:'relative', fontSize:12 }}>
          <div style={{ width: totalW, height: HEAD_H + shown.length * ROW_H, position:'relative' }}>
            <div style={{ position:'sticky', top:0, zIndex:3, display:'flex', height:HEAD_H, background:'#f8fafc', borderBottom:'1px solid #e2e8f0', width: totalW }}>
              <div style={{ position:'sticky', left:0, zIndex:4, width:FIRST_W, flexShrink:0, background:'#f1f5f9', padding:'0 10px', display:'flex', alignItems:'center', fontWeight:700, color:'#475569', borderRight:'1px solid #e2e8f0' }}>Row · Seller SKU</div>
              {columns.map(c => (
                <div key={c} title={c} style={{ width:widthOf(c), flexShrink:0, padding:'0 8px', display:'flex', alignItems:'center', gap:5, fontWeight:600, color: colOnly === c ? '#4f46e5' : '#475569', background: colOnly === c ? '#eef2ff' : undefined, borderRight:'1px solid #f1f5f9', overflow:'hidden', whiteSpace:'nowrap' }}>
                  <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{colLabel(c)}</span>
                  {colCounts[c] > 0 && (
                    <button onClick={() => { setColOnly(colOnly === c ? null : c); if (filter === 'all') setFilter('problems') }} title={colOnly === c ? 'Show every column' : `Only rows with a problem in ${colLabel(c)}`}
                      style={{ fontSize:10, fontWeight:700, color:'#b91c1c', background:'#fee2e2', borderRadius:8, padding:'0 5px', border:'none', cursor:'pointer' }}>{colCounts[c]}</button>
                  )}
                </div>
              ))}
            </div>
            {shown.slice(first, last).map((i, n) => {
              const r = rows[i]
              return (
                <div key={i} style={{ position:'absolute', top: HEAD_H + (first + n) * ROW_H, left:0, height:ROW_H, width: totalW, display:'flex', borderBottom:'1px solid #f1f5f9' }}>
                  <div style={{ position:'sticky', left:0, zIndex:2, width:FIRST_W, flexShrink:0, background: problemRows.has(i) ? '#fff7f7' : '#fafafa', padding:'0 10px', display:'flex', alignItems:'center', gap:8, borderRight:'1px solid #e2e8f0', whiteSpace:'nowrap', overflow:'hidden' }}>
                    <span style={{ color:'#94a3b8', width:34, flexShrink:0 }}>{i + 3}</span>
                    <span style={{ fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis' }}>{r['**Seller SKU']}</span>
                  </div>
                  {columns.map(c => {
                    const issue = issues.get(`${i}|${c}`)
                    const active = sel?.i === i && sel?.col === c
                    const dim = colOnly && c !== colOnly && !active
                    return (
                      <div key={c} onClick={() => select(i, c)} title={issue?.text || String(r[c] ?? '')}
                        style={{ width:widthOf(c), flexShrink:0, padding:'0 8px', display:'flex', alignItems:'center', cursor:'cell', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                          background: cellBg(issue?.level, isEdited(i, c)), borderRight:'1px solid #f1f5f9', opacity: dim ? 0.55 : 1,
                          outline: active ? '2px solid #4f46e5' : 'none', outlineOffset:-2, color: issue?.level === 'error' ? '#991b1b' : '#1e293b' }}>
                        <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{String(r[c] ?? '')}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          {!shown.length && <div style={{ position:'absolute', top:HEAD_H + 20, left:20, fontSize:13, color:'#15803d' }}>{filter === 'all' ? 'No rows match.' : 'Nothing here — all clear.'}</div>}
        </div>

        {/* Edit bar */}
        <div style={{ borderTop:'1px solid #e2e8f0', background:'#f8fafc', padding:'10px 14px', minHeight:64 }}>
          {!sel ? (
            <div style={{ fontSize:12.5, color:'#64748b' }}>Click a cell to edit it, or <b>Next problem</b> (F8) to go through them. Red cells would be rejected by the upload; amber ones are worth a look.</div>
          ) : (
            <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
              <Thumb src={item?.image || item?.productImage} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, color:'#475569', marginBottom:5, display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                  <b>{colLabel(sel.col)}</b> · row {sel.i + 3} · <span style={{ fontFamily:'monospace' }}>{rows[sel.i]['**Seller SKU']}</span>
                  <span style={{ color:'#94a3b8' }}>Parent <span style={{ fontFamily:'monospace' }}>{rows[sel.i]['**Parent Sku']}</span></span>
                  {selIssue && <span style={{ display:'flex', alignItems:'center', gap:4, color: selIssue.level === 'error' ? '#b91c1c' : '#b45309' }}><AlertTriangle size={12} /> {selIssue.text}</span>}
                  {isEdited(sel.i, sel.col) && <span style={{ color:'#2563eb' }}>edited</span>}
                  {sel.col === '**Name (English)' && item?.darazName && item.darazName !== rows[sel.i][sel.col] && <span style={{ color:'#64748b' }}>Daraz: "{item.darazName}"</span>}
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'flex-start', flexWrap:'wrap' }}>
                  {WIDE.test(sel.col) && !list ? (
                    <textarea ref={input} aria-label="Cell value" value={draft} onChange={e => setDraft(e.target.value)} rows={2}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit(true); if (e.key === 'Escape') setSel(null) }}
                      style={{ flex:1, minWidth:220, padding:'7px 10px', border:'1.5px solid #c7d2fe', borderRadius:7, fontSize:12.5, fontFamily:'inherit', resize:'vertical' }} />
                  ) : (
                    <input ref={input} aria-label="Cell value" value={draft} onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') setSel(null) }}
                      style={{ flex:1, minWidth:220, padding:'7px 10px', border:'1.5px solid #c7d2fe', borderRadius:7, fontSize:12.5 }} />
                  )}
                  <button onClick={() => commit(false)} style={{ ...tbtn, background:'#4f46e5', borderColor:'#4f46e5', color:'#fff' }} title="Save (Enter saves and goes to the next problem)"><Check size={13} /> Save</button>
                  {isEdited(sel.i, sel.col) && <button onClick={resetCell} style={tbtn}><RotateCcw size={13} /> Undo edit</button>}
                </div>
                {siblings.length > 1 && (
                  <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#334155', marginTop:6, cursor:'pointer' }}>
                    <input type="checkbox" checked={toParent} onChange={e => setToParent(e.target.checked)} style={{ accentColor:'#4f46e5' }} />
                    Same value for all {siblings.length} SKUs of Parent SKU <span style={{ fontFamily:'monospace' }}>{rows[sel.i]['**Parent Sku']}</span>
                  </label>
                )}
                {options.length > 0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginTop:7, maxHeight:62, overflow:'auto' }}>
                    {options.map(o => (
                      <button key={o} onClick={() => setDraft(o)}
                        style={{ padding:'3px 9px', borderRadius:14, fontSize:11.5, cursor:'pointer', border:'1px solid #c7d2fe', background:'#eef2ff', color:'#3730a3' }}>{o}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Thumb({ src }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  const ok = src && /^https?:\/\//.test(src) && !failed
  return (
    <div style={{ width:52, height:52, borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', flexShrink:0, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
      {ok ? <img src={src} alt="" onError={() => setFailed(true)} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <ImageOff size={18} color='#cbd5e1' />}
    </div>
  )
}
