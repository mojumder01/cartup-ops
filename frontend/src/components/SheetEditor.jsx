import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { headerKey, colLabel } from '../utils/variantReview'
import { X, Search, Download, RotateCcw, Check, AlertTriangle, ImageOff } from 'lucide-react'

// The whole output sheet, Excel-style: every row and column, problem cells
// marked, any cell editable. Rows are virtualised so thousands stay smooth.
//   red    — required and empty, or a dropdown value not on CartUp's list (#N/A)
//   amber  — flagged: weight under 0.01 kg, image link without a key…
//   blue   — edited here
// Edits are kept per Seller SKU and applied (and logged) when the file is built.

const ROW_H = 30, HEAD_H = 34, FIRST_W = 210
const WIDE = /name|highlight|description|box|policy|path|report|image|combo/i
const widthOf = c => (WIDE.test(c) ? 220 : 130)

export default function SheetEditor({ output, items, columns, lists, keyOf, edits, setEdits, onDownload, onClose }) {
  const rows = output.rows
  const [onlyProblems, setOnlyProblems] = useState(true)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(null)       // { i, col }
  const [draft, setDraft] = useState('')
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

  // Every cell's problem, once per change of the output.
  const issues = useMemo(() => {
    const m = new Map()
    const flagged = new Map(output.problems.map(p => [`${p.row}|${p.column}`, p.problem]))
    rows.forEach((r, i) => {
      for (const c of columns) {
        const v = String(r[c] ?? '').trim()
        const list = lists?.[headerKey(c)]
        if (c.startsWith('**') && !v) m.set(`${i}|${c}`, { level: 'error', text: 'Required — empty' })
        else if (v && list && list.match(v)?.how !== 'exact') m.set(`${i}|${c}`, { level: 'error', text: `Not on CartUp's ${colLabel(c)} list — shows #N/A` })
        else if (flagged.has(`${i}|${c}`)) m.set(`${i}|${c}`, { level: 'warn', text: flagged.get(`${i}|${c}`) })
      }
    })
    return m
  }, [output, rows, columns, lists])
  const problemRows = useMemo(() => new Set([...issues.keys()].map(k => +k.split('|')[0])), [issues])
  const colCounts = useMemo(() => {
    const n = {}
    for (const k of issues.keys()) { const c = k.slice(k.indexOf('|') + 1); n[c] = (n[c] || 0) + 1 }
    return n
  }, [issues])

  const q = query.trim().toLowerCase()
  const shown = useMemo(() => rows.map((_, i) => i).filter(i =>
    (!onlyProblems || problemRows.has(i)) &&
    (!q || String(rows[i]['**Seller SKU'] ?? '').toLowerCase().includes(q) || String(rows[i]['**Parent Sku'] ?? '').toLowerCase().includes(q) || String(rows[i]['**Name (English)'] ?? '').toLowerCase().includes(q))
  ), [rows, onlyProblems, problemRows, q])

  const totalW = FIRST_W + columns.reduce((n, c) => n + widthOf(c), 0)
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 5)
  const last = Math.min(shown.length, Math.ceil((scrollTop + height) / ROW_H) + 5)

  const isEdited = (i, c) => edits[keyOf(i)]?.[c] !== undefined
  const select = (i, col) => { setSel({ i, col }); setDraft(String(rows[i][col] ?? '')) }
  useEffect(() => { if (sel) input.current?.focus() }, [sel])

  const commit = () => {
    if (!sel) return
    const k = keyOf(sel.i)
    setEdits(prev => ({ ...prev, [k]: { ...(prev[k] || {}), [sel.col]: draft } }))
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
          <div style={{ display:'flex', gap:3, background:'#f1f5f9', borderRadius:8, padding:3 }}>
            {[[true, 'Rows with problems'], [false, 'All rows']].map(([v, label]) => (
              <button key={label} onClick={() => { setOnlyProblems(v); scroller.current && (scroller.current.scrollTop = 0) }}
                style={{ padding:'5px 10px', border:'none', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', background: onlyProblems === v ? '#fff' : 'transparent', color: onlyProblems === v ? '#4f46e5' : '#64748b' }}>{label}</button>
            ))}
          </div>
          <div style={{ position:'relative' }}>
            <Search size={13} color='#94a3b8' style={{ position:'absolute', left:9, top:9 }} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Seller / Parent SKU or name"
              style={{ padding:'7px 10px 7px 28px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:12.5, width:220 }} />
          </div>
          <div style={{ display:'flex', gap:10, fontSize:11, color:'#64748b', marginLeft:'auto', alignItems:'center' }}>
            <span><span style={{ display:'inline-block', width:10, height:10, background:'#fee2e2', border:'1px solid #fecaca', marginRight:4 }} />#N/A / required</span>
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
                <div key={c} title={c} style={{ width:widthOf(c), flexShrink:0, padding:'0 8px', display:'flex', alignItems:'center', gap:5, fontWeight:600, color:'#475569', borderRight:'1px solid #f1f5f9', overflow:'hidden', whiteSpace:'nowrap' }}>
                  <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{colLabel(c)}</span>
                  {colCounts[c] > 0 && <span style={{ fontSize:10, fontWeight:700, color:'#b91c1c', background:'#fee2e2', borderRadius:8, padding:'0 5px' }}>{colCounts[c]}</span>}
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
                    return (
                      <div key={c} onClick={() => select(i, c)} title={issue?.text || String(r[c] ?? '')}
                        style={{ width:widthOf(c), flexShrink:0, padding:'0 8px', display:'flex', alignItems:'center', cursor:'cell', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                          background: cellBg(issue?.level, isEdited(i, c)), borderRight:'1px solid #f1f5f9',
                          outline: active ? '2px solid #4f46e5' : 'none', outlineOffset:-2, color: issue?.level === 'error' ? '#991b1b' : '#1e293b' }}>
                        <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{String(r[c] ?? '')}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          {!shown.length && <div style={{ position:'absolute', top:HEAD_H + 20, left:20, fontSize:13, color:'#15803d' }}>{onlyProblems ? 'No rows with problems.' : 'No rows match.'}</div>}
        </div>

        {/* Edit bar */}
        <div style={{ borderTop:'1px solid #e2e8f0', background:'#f8fafc', padding:'10px 14px', minHeight:64 }}>
          {!sel ? (
            <div style={{ fontSize:12.5, color:'#64748b' }}>Click a cell to edit it. Red cells would be rejected by the upload; amber ones are worth a look.</div>
          ) : (
            <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
              <Thumb src={item?.image || item?.productImage} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, color:'#475569', marginBottom:5, display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                  <b>{colLabel(sel.col)}</b> · row {sel.i + 3} · <span style={{ fontFamily:'monospace' }}>{rows[sel.i]['**Seller SKU']}</span>
                  {selIssue && <span style={{ display:'flex', alignItems:'center', gap:4, color: selIssue.level === 'error' ? '#b91c1c' : '#b45309' }}><AlertTriangle size={12} /> {selIssue.text}</span>}
                  {isEdited(sel.i, sel.col) && <span style={{ color:'#2563eb' }}>edited</span>}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  {WIDE.test(sel.col) && !list ? (
                    <textarea ref={input} aria-label="Cell value" value={draft} onChange={e => setDraft(e.target.value)} rows={2}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit() }}
                      style={{ flex:1, padding:'7px 10px', border:'1.5px solid #c7d2fe', borderRadius:7, fontSize:12.5, fontFamily:'inherit', resize:'vertical' }} />
                  ) : (
                    <input ref={input} aria-label="Cell value" value={draft} onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setSel(null) }}
                      style={{ flex:1, padding:'7px 10px', border:'1.5px solid #c7d2fe', borderRadius:7, fontSize:12.5 }} />
                  )}
                  <button onClick={commit} style={{ ...tbtn, background:'#4f46e5', borderColor:'#4f46e5', color:'#fff' }}><Check size={13} /> Save</button>
                  {isEdited(sel.i, sel.col) && <button onClick={resetCell} style={tbtn}><RotateCcw size={13} /> Undo edit</button>}
                </div>
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
