import { useState, useMemo, Fragment } from 'react'
import {
  readAnyWorkbook, classifyColumns, scoreSheet,
  getVal, setVal, buildDataVizFile, scanOverLimit, imageSrc,
} from '../utils/govDataVizProcessor'
import {
  FileSpreadsheet, AlertCircle, RefreshCw, Download, X,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Image as ImageIcon,
  Eye, Layers, Weight as WeightIcon, FileText, MessageSquarePlus, Info,
  Filter, Search, XCircle,
} from 'lucide-react'

function download(buf, name) {
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

// turn "HighlightEn" / "Description (English)" into a short tab label ("En" / "English")
function shortGroupLabel(header) {
  return header.replace(/highlights?|description/ig, '').replace(/[()]/g, '').trim() || header
}

const PAGE_SIZE = 100

// Focused check modes — each shows only the columns needed to make that call,
// plus one-click tags so a report can be written without typing every time.
// `applicable` decides whether the mode makes sense for this file at all — e.g.
// a bulk image-update template with no Name/Weight/Description columns should
// gray those modes out instead of silently showing the same table as Image Check.
const MODES = [
  { key:'all',     label:'All Fields',    applicable: () => true },
  { key:'image',   label:'Image Check',   applicable: c => c.imageCols.length > 0 },
  { key:'weight',  label:'Weight Check',  applicable: c => !!c.weightCol },
  { key:'content', label:'Content Check', applicable: c => c.highlightCols.length > 0 || c.descriptionCols.length > 0 },
]
const PRESET_TAGS = {
  image:   ['Missing', 'Blurry / low-res', 'Wrong product', 'Watermark / text'],
  weight:  ['Missing / invalid', 'Too light', 'Too heavy', 'Price mismatch'],
  content: ['Spelling', 'Grammar', 'Empty / missing', 'Too short', 'Duplicate'],
}
function tagsOf(text) { return String(text || '').split(';').map(s => s.trim()).filter(Boolean) }

// Prefix every quick-tag with which field it's about — a bare "Empty / missing"
// in the report doesn't say whether the image, highlights, or description was
// empty. The table only knows the check mode; the modal also knows the exact
// column, so it can be even more specific (e.g. "Highlights (En)" vs "Description (Bn)").
const MODE_LABEL = { image:'Image', weight:'Weight', content:'Content' }
function modalTagCategory(modal) {
  if (!modal) return ''
  if (modal.kind === 'image') return 'Image'
  const groupLabel = modal.group === 'highlight' ? 'Highlights' : 'Description'
  const colLabel = shortGroupLabel(modal.col)
  return colLabel && colLabel !== modal.col ? `${groupLabel} (${colLabel})` : groupLabel
}

export default function GovernanceDataViz() {
  const [wb, setWb]           = useState(null)   // { sheetNames, sheets }
  const [fileName, setFileName] = useState('')
  const [sheetName, setSheetName] = useState('')
  const [headers, setHeaders] = useState([])
  const [rows, setRows]       = useState([])
  const [report, setReport]   = useState({})     // rid -> text
  const [expanded, setExpanded] = useState(new Set())
  const [page, setPage]       = useState(0)
  const [modal, setModal]     = useState(null)   // {kind:'image'|'text', rid, col, group}
  const [error, setError]     = useState('')
  const [inputKey, setInputKey] = useState(0)
  const [mode, setMode]       = useState('all')  // 'all' | 'image' | 'weight' | 'content'
  const [showFilterBar, setShowFilterBar] = useState(false)
  const [filterText, setFilterText] = useState('')     // matches ID or Name
  const [weightMin, setWeightMin]   = useState('')     // weight-mode custom range filter
  const [weightMax, setWeightMax]   = useState('')

  const classify = useMemo(() => classifyColumns(headers), [headers])
  const showWeight      = mode === 'all' || mode === 'weight'
  const showPrice       = (mode === 'all' || mode === 'weight') && classify.priceCols.length > 0
  const showHighlights  = mode === 'all' || mode === 'content'
  const showDescription = mode === 'all' || mode === 'content'
  const presetTags      = PRESET_TAGS[mode] || null
  const ridIndex = useMemo(() => { const m = {}; rows.forEach((r, i) => { m[r.__rid] = i }); return m }, [rows])

  const weightFilterActive = mode === 'weight' && classify.weightCol && (weightMin !== '' || weightMax !== '')
  const filteredRows = useMemo(() => {
    let out = rows
    const q = filterText.trim().toLowerCase()
    if (q) {
      out = out.filter(r => {
        const idVal = classify.idCol ? getVal(headers, r, classify.idCol) : ''
        const nameVal = classify.nameCol ? getVal(headers, r, classify.nameCol) : ''
        return idVal.toLowerCase().includes(q) || nameVal.toLowerCase().includes(q)
      })
    }
    if (weightFilterActive) {
      const min = weightMin !== '' ? parseFloat(weightMin) : -Infinity
      const max = weightMax !== '' ? parseFloat(weightMax) : Infinity
      out = out.filter(r => {
        const w = parseFloat(getVal(headers, r, classify.weightCol))
        return !isNaN(w) && w >= min && w <= max
      })
    }
    return out
  }, [rows, filterText, weightFilterActive, weightMin, weightMax, classify, headers])
  const filteredRidIndex = useMemo(() => { const m = {}; filteredRows.forEach((r, i) => { m[r.__rid] = i }); return m }, [filteredRows])
  const filtersActive = !!filterText.trim() || weightFilterActive

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const pageRows = useMemo(() => filteredRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), [filteredRows, page])

  const clearFilters = () => { setFilterText(''); setWeightMin(''); setWeightMax(''); setPage(0) }

  const stats = useMemo(() => {
    const reported = Object.values(report).filter(v => v && v.trim()).length
    const missingImage = classify.imageCols.length
      ? rows.filter(r => !classify.imageCols.some(c => getVal(headers, r, c))).length : 0
    const missingWeight = classify.weightCol
      ? rows.filter(r => !getVal(headers, r, classify.weightCol)).length : 0
    return { reported, missingImage, missingWeight }
  }, [rows, report, classify, headers])

  const loadSheet = (wbResult, name) => {
    const sheet = wbResult.sheets[name]
    setSheetName(name)
    setHeaders(sheet.headers)
    setRows(sheet.rows)
    setReport(scanOverLimit(sheet.headers, sheet.rows))
    setExpanded(new Set()); setPage(0); setModal(null); setError(''); setMode('all')
    setShowFilterBar(false); setFilterText(''); setWeightMin(''); setWeightMax('')
  }

  const handleFile = async e => {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    setError('')
    try {
      const result = await readAnyWorkbook(f)
      const usable = result.sheetNames.filter(n => result.sheets[n].headers.length)
      if (!usable.length) { setError('No readable sheets found in this file'); return }
      const best = usable.reduce((a, b) => scoreSheet(result.sheets[b].headers) > scoreSheet(result.sheets[a].headers) ? b : a)
      setWb(result); setFileName(f.name); setInputKey(k => k + 1)
      loadSheet(result, best)
    } catch (err) { setError('Failed to read file: ' + err.message) }
  }

  const handleReset = () => {
    setWb(null); setFileName(''); setSheetName(''); setHeaders([]); setRows([])
    setReport({}); setExpanded(new Set()); setPage(0); setModal(null); setError(''); setInputKey(k => k + 1)
    setMode('all'); setShowFilterBar(false); setFilterText(''); setWeightMin(''); setWeightMax('')
  }

  const updateCell = (rid, col, val) =>
    setRows(rs => rs.map(r => r.__rid === rid ? setVal(headers, r, col, val) : r))

  const toggleExpand = rid => setExpanded(s => {
    const n = new Set(s); n.has(rid) ? n.delete(rid) : n.add(rid); return n
  })

  // one-click preset tag — toggles the tag in/out of that row's report text
  const toggleTag = (rid, tag) => setReport(rp => {
    const tags = tagsOf(rp[rid])
    const idx = tags.indexOf(tag)
    idx >= 0 ? tags.splice(idx, 1) : tags.push(tag)
    return { ...rp, [rid]: tags.join('; ') }
  })

  const handleDownload = () => {
    download(buildDataVizFile(headers, rows, report, sheetName), 'governance_dataviz_' + (fileName.replace(/\.xlsx$/i, '') || 'output') + '.xlsx')
  }

  // ── modal helpers ──
  const modalRow = modal ? rows[ridIndex[modal.rid]] : null
  const modalGroupCols = modal?.group === 'highlight' ? classify.highlightCols
    : modal?.group === 'description' ? classify.descriptionCols
    : classify.imageCols
  const modalPresetTags = modal?.kind === 'image' ? PRESET_TAGS.image
    : modal?.kind === 'text' ? PRESET_TAGS.content
    : null

  const navModalRow = dir => {
    setModal(m => {
      if (!m) return m
      let idx = (filteredRidIndex[m.rid] ?? 0) + dir
      if (idx < 0) idx = filteredRows.length - 1
      if (idx >= filteredRows.length) idx = 0
      const newRid = filteredRows[idx].__rid
      setPage(Math.floor(idx / PAGE_SIZE))
      return { ...m, rid: newRid }
    })
  }

  const btn = (bg, color, border) => ({
    display:'flex', alignItems:'center', gap:6, padding:'8px 14px', background:bg, color,
    border:`1.5px solid ${border || bg}`, borderRadius:8, fontWeight:600, fontSize:12.5, cursor:'pointer',
  })

  const cellIn = { width:'100%', padding:'5px 8px', fontSize:12, border:'1.5px solid #e2e8f0', borderRadius:6, outline:'none', background:'#fff', boxSizing:'border-box' }

  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      {/* Top bar */}
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:12 }}>
        <Layers size={16} color='#4f46e5'/>
        <span style={{ fontSize:13, color:'#718096' }}>Upload any product .xlsx — visual review, live edits, and a live report column.</span>
        {rows.length > 0 && (
          <>
            <span style={{ fontSize:11, color:'#15803d', background:'#dcfce7', padding:'3px 10px', borderRadius:999, fontWeight:600 }}>
              {fileName} · sheet "{sheetName}" · {rows.length} rows
            </span>
            <div style={{ flex:1 }}/>
            <button onClick={handleDownload} className="btn-success" style={btn('#16a34a','#fff')}>
              <Download size={13}/> Download
            </button>
            <label style={{ ...btn('#fff','#4f46e5','#c7d2fe'), display:'flex' }}>
              <input key={inputKey + '_new'} type="file" accept=".xlsx" style={{ display:'none' }} onChange={handleFile}/>
              <FileSpreadsheet size={13}/> New File
            </label>
            <button onClick={handleReset} style={btn('#fff','#94a3b8','#e2e8f0')}><RefreshCw size={12}/> Reset</button>
          </>
        )}
      </div>

      {/* Check mode — shows only the columns needed for that kind of review */}
      {rows.length > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, flexWrap:'wrap' }}>
          <span style={{ fontSize:11, color:'#94a3b8', fontWeight:700, textTransform:'uppercase' }}>Check:</span>
          <div style={{ display:'flex', gap:4, background:'#f1f5f9', borderRadius:9, padding:3 }}>
            {MODES.map(m => {
              const ok = m.applicable(classify)
              return (
                <button key={m.key} onClick={() => { if (ok) { setMode(m.key); setPage(0) } }} disabled={!ok}
                  title={ok ? undefined : `This file has no ${m.key === 'weight' ? 'weight' : m.key === 'content' ? 'highlights/description' : 'image'} column — nothing to check here`}
                  style={{ padding:'6px 14px', borderRadius:7, fontSize:12, fontWeight:600, border:'none',
                    cursor: ok ? 'pointer' : 'not-allowed',
                    background: mode === m.key && ok ? '#fff' : 'transparent',
                    color: !ok ? '#cbd5e1' : mode === m.key ? '#4f46e5' : '#718096',
                    boxShadow: mode === m.key && ok ? '0 1px 4px rgba(0,0,0,0.08)' : 'none', transition:'all 0.15s' }}>
                  {m.label}
                </button>
              )
            })}
          </div>
          {mode !== 'all' && (
            <span style={{ fontSize:11, color:'#94a3b8' }}>
              Showing ID{classify.nameCol ? ', Name' : ''}{classify.imageCols.length ? ', Image' : ''}
              {mode === 'weight' ? ', Weight' + (showPrice ? ', Price' : '') : ''}
              {mode === 'content' ? [classify.highlightCols.length && 'Highlights', classify.descriptionCols.length && 'Description'].filter(Boolean).map(s => ', ' + s).join('') : ''} only
            </span>
          )}
          <div style={{ flex:1 }}/>
          <button onClick={() => setShowFilterBar(s => !s)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer',
              background: showFilterBar || filtersActive ? '#eef2ff' : '#fff',
              color: showFilterBar || filtersActive ? '#4f46e5' : '#64748b',
              border:`1.5px solid ${showFilterBar || filtersActive ? '#c7d2fe' : '#e2e8f0'}` }}>
            <Filter size={13}/> Filter{filtersActive ? ` (${filteredRows.length})` : ''}
          </button>
        </div>
      )}

      {/* Filter bar — ID/Name search always, custom weight range only in Weight Check */}
      {rows.length > 0 && showFilterBar && (
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', padding:'10px 14px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, marginBottom:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, flex:1, minWidth:200, background:'#fff', border:'1.5px solid #e2e8f0', borderRadius:8, padding:'6px 10px' }}>
            <Search size={13} color='#94a3b8'/>
            <input value={filterText} onChange={e => { setFilterText(e.target.value); setPage(0) }}
              placeholder={`Search ${classify.idCol || 'ID'}${classify.nameCol ? ' or Name' : ''}...`}
              style={{ flex:1, border:'none', outline:'none', fontSize:12.5, background:'transparent' }}/>
            {filterText && <button onClick={() => { setFilterText(''); setPage(0) }} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', display:'flex' }}><XCircle size={14}/></button>}
          </div>
          {mode === 'weight' && classify.weightCol && (
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#64748b' }}>
              <WeightIcon size={13} color='#0369a1'/> Weight:
              <input type="number" value={weightMin} onChange={e => { setWeightMin(e.target.value); setPage(0) }} placeholder="min"
                style={{ width:64, padding:'6px 8px', fontSize:12, border:'1.5px solid #e2e8f0', borderRadius:7, outline:'none' }}/>
              –
              <input type="number" value={weightMax} onChange={e => { setWeightMax(e.target.value); setPage(0) }} placeholder="max"
                style={{ width:64, padding:'6px 8px', fontSize:12, border:'1.5px solid #e2e8f0', borderRadius:7, outline:'none' }}/>
              <span style={{ color:'#94a3b8' }}>kg</span>
            </div>
          )}
          {filtersActive && (
            <button onClick={clearFilters} style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 10px', fontSize:12, fontWeight:600, background:'#fff', color:'#dc2626', border:'1.5px solid #fecaca', borderRadius:8, cursor:'pointer' }}>
              <XCircle size={13}/> Clear
            </button>
          )}
        </div>
      )}

      {/* Sheet selector + stats */}
      {wb && wb.sheetNames.length > 1 && (
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, fontSize:12 }}>
          <span style={{ color:'#94a3b8', fontWeight:600 }}>Sheet:</span>
          {wb.sheetNames.map(n => (
            <button key={n} onClick={() => loadSheet(wb, n)}
              style={{ padding:'4px 12px', borderRadius:999, fontWeight:600, cursor:'pointer',
                background: n === sheetName ? '#4f46e5' : '#f1f5f9', color: n === sheetName ? '#fff' : '#64748b', border:'none' }}>
              {n}
            </button>
          ))}
        </div>
      )}

      {rows.length > 0 && !classify.nameCol && !classify.weightCol && !classify.highlightCols.length && !classify.descriptionCols.length && (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, marginBottom:12, fontSize:12, color:'#1d4ed8' }}>
          <Info size={13}/> This sheet only has {classify.idCol || 'an ID'} and Image columns — no Name, Weight, Highlights, or Description found, so those checks are grayed out above.
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display:'flex', gap:16, marginBottom:12, fontSize:12, color:'#64748b', flexWrap:'wrap' }}>
          <span><strong style={{ color:'#1a202c' }}>{rows.length}</strong> rows</span>
          <span><strong style={{ color: stats.reported ? '#b45309' : '#1a202c' }}>{stats.reported}</strong> reported</span>
          {classify.imageCols.length > 0 && <span><strong style={{ color: stats.missingImage ? '#dc2626' : '#1a202c' }}>{stats.missingImage}</strong> missing image</span>}
          {classify.weightCol && <span><strong style={{ color: stats.missingWeight ? '#dc2626' : '#1a202c' }}>{stats.missingWeight}</strong> missing weight</span>}
        </div>
      )}

      {/* Upload */}
      {!rows.length && (
        <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:24, maxWidth:560 }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#718096', textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:10 }}>
            Input File <span style={{ color:'#dc2626' }}>*</span>
          </div>
          <div style={{ fontSize:11, color:'#94a3b8', marginBottom:10 }}>
            Any product .xlsx works — columns for name, images, highlights, description and weight are detected automatically.
          </div>
          <label className="file-drop" style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px', border:'1.5px dashed #cbd5e1', borderRadius:10, cursor:'pointer', background:'#fafafa' }}>
            <input key={inputKey} type="file" accept=".xlsx" style={{ display:'none' }} onChange={handleFile}/>
            <FileSpreadsheet size={16} color='#94a3b8'/>
            <span style={{ fontSize:13, color:'#94a3b8' }}>Choose .xlsx file...</span>
          </label>
        </div>
      )}

      {error && (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, marginBottom:12, maxWidth:560 }}>
          <AlertCircle size={15} color='#dc2626'/><span style={{ fontSize:13, color:'#dc2626' }}>{error}</span>
        </div>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <>
          <div className="table-modern" style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:14, overflow:'auto', maxHeight:'calc(100vh - 300px)' }}>
            <table style={{ borderCollapse:'collapse', fontSize:12, width:'100%', minWidth:900 }}>
              <thead>
                <tr>
                  <th style={th}>SL</th>
                  {classify.idCol && <th style={th}>{classify.idCol}</th>}
                  {classify.imageCols.length > 0 && <th style={th}><ImageIcon size={11} style={{ display:'inline', marginRight:4 }}/>Image</th>}
                  {classify.nameCol && <th style={th}>{classify.nameCol}</th>}
                  {classify.weightCol && showWeight && <th style={th}><WeightIcon size={11} style={{ display:'inline', marginRight:4 }}/>Weight</th>}
                  {showPrice && classify.priceCols.map(c => <th key={c} style={th}>{c}</th>)}
                  {classify.highlightCols.length > 0 && showHighlights && <th style={th}>Highlights</th>}
                  {classify.descriptionCols.length > 0 && showDescription && <th style={th}>Description</th>}
                  <th style={th}>Report</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => {
                  const rid = r.__rid
                  const sl = page * PAGE_SIZE + i + 1
                  const imgs = classify.imageCols.map(c => getVal(headers, r, c)).filter(Boolean)
                  const rpt = report[rid] || ''
                  const isOpen = expanded.has(rid)
                  return (
                    <Fragment key={rid}>
                      <tr style={{ borderBottom:'1px solid #f1f5f9', background: rpt.trim() ? '#fffbeb' : '#fff' }}>
                        <td style={{ ...td, color:'#94a3b8' }}>{sl}</td>
                        {classify.idCol && <td style={{ ...td, fontWeight:600, color:'#334155' }}>{getVal(headers, r, classify.idCol)}</td>}
                        {classify.imageCols.length > 0 && (
                          <td style={td}>
                            {imgs.length
                              ? <img src={imageSrc(imgs[0])} alt="" loading="lazy"
                                  onClick={() => setModal({ kind:'image', rid, col: classify.imageCols.find(c => getVal(headers, r, c) === imgs[0]) })}
                                  style={{ width:42, height:42, objectFit:'cover', borderRadius:6, cursor:'pointer', border:'1px solid #e2e8f0' }}
                                  onError={e => { e.target.style.opacity = 0.25 }}/>
                              : <span style={{ color:'#dc2626', fontSize:11 }}>missing</span>}
                          </td>
                        )}
                        {classify.nameCol && (
                          <td style={{ ...td, minWidth:220 }}>
                            <input value={getVal(headers, r, classify.nameCol)} onChange={e => updateCell(rid, classify.nameCol, e.target.value)} style={cellIn}/>
                          </td>
                        )}
                        {classify.weightCol && showWeight && (
                          <td style={{ ...td, width:90 }}>
                            <input value={getVal(headers, r, classify.weightCol)} onChange={e => updateCell(rid, classify.weightCol, e.target.value)}
                              style={{ ...cellIn, textAlign:'center' }}/>
                          </td>
                        )}
                        {showPrice && classify.priceCols.map(c => (
                          <td key={c} style={{ ...td, width:100 }}>
                            <input value={getVal(headers, r, c)} onChange={e => updateCell(rid, c, e.target.value)}
                              style={{ ...cellIn, textAlign:'center' }}/>
                          </td>
                        ))}
                        {classify.highlightCols.length > 0 && showHighlights && (
                          <td style={td}>
                            <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                              {classify.highlightCols.map(c => {
                                const has = getVal(headers, r, c).trim()
                                return (
                                  <button key={c} onClick={() => setModal({ kind:'text', rid, col:c, group:'highlight' })}
                                    style={{ display:'flex', alignItems:'center', gap:3, padding:'3px 8px', fontSize:10.5, fontWeight:600, borderRadius:6, cursor:'pointer',
                                      background: has ? '#dcfce7' : '#fef2f2', color: has ? '#15803d' : '#dc2626', border:`1px solid ${has ? '#bbf7d0' : '#fecaca'}` }}>
                                    <Eye size={10}/> {shortGroupLabel(c) || 'View'}
                                  </button>
                                )
                              })}
                            </div>
                          </td>
                        )}
                        {classify.descriptionCols.length > 0 && showDescription && (
                          <td style={td}>
                            <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                              {classify.descriptionCols.map(c => {
                                const has = getVal(headers, r, c).trim()
                                return (
                                  <button key={c} onClick={() => setModal({ kind:'text', rid, col:c, group:'description' })}
                                    style={{ display:'flex', alignItems:'center', gap:3, padding:'3px 8px', fontSize:10.5, fontWeight:600, borderRadius:6, cursor:'pointer',
                                      background: has ? '#dcfce7' : '#fef2f2', color: has ? '#15803d' : '#dc2626', border:`1px solid ${has ? '#bbf7d0' : '#fecaca'}` }}>
                                    <Eye size={10}/> {shortGroupLabel(c) || 'View'}
                                  </button>
                                )
                              })}
                            </div>
                          </td>
                        )}
                        <td style={{ ...td, minWidth:220 }}>
                          <input value={rpt} onChange={e => setReport(rp => ({ ...rp, [rid]: e.target.value }))}
                            placeholder="Add note / report..."
                            style={{ ...cellIn, background: rpt.trim() ? '#fffbeb' : '#fff', borderColor: rpt.trim() ? '#fde68a' : '#e2e8f0' }}/>
                          {presetTags && (
                            <div style={{ display:'flex', gap:3, flexWrap:'wrap', marginTop:4 }}>
                              {presetTags.map(tag => {
                                const fullTag = `${MODE_LABEL[mode]}: ${tag}`
                                const active = tagsOf(rpt).includes(fullTag)
                                return (
                                  <button key={tag} onClick={() => toggleTag(rid, fullTag)} title={fullTag}
                                    style={{ padding:'2px 7px', fontSize:9.5, fontWeight:600, borderRadius:5, cursor:'pointer',
                                      background: active ? '#dc2626' : '#f8fafc', color: active ? '#fff' : '#94a3b8',
                                      border:`1px solid ${active ? '#dc2626' : '#e2e8f0'}` }}>
                                    {tag}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, width:30 }}>
                          {classify.otherCols.length > 0 && (
                            <button onClick={() => toggleExpand(rid)} title="More fields"
                              style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', padding:2 }}>
                              {isOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isOpen && classify.otherCols.length > 0 && (
                        <tr style={{ background:'#f8fafc', borderBottom:'1px solid #f1f5f9' }}>
                          <td colSpan={20} style={{ padding:'10px 14px' }}>
                            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:8 }}>
                              {classify.otherCols.map(c => (
                                <div key={c}>
                                  <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600, marginBottom:2 }}>{c}</div>
                                  <input value={getVal(headers, r, c)} onChange={e => updateCell(rid, c, e.target.value)} style={cellIn}/>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:10, fontSize:12, color:'#64748b' }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={btn('#fff', page === 0 ? '#cbd5e1' : '#4f46e5', '#e2e8f0')}>
                <ChevronLeft size={13}/> Prev
              </button>
              <span>Page {page + 1} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={btn('#fff', page >= totalPages - 1 ? '#cbd5e1' : '#4f46e5', '#e2e8f0')}>
                Next <ChevronRight size={13}/>
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Preview / edit modal ── */}
      {modal && modalRow && (
        <div className="dv-modal-backdrop" onClick={() => setModal(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          <button onClick={e => { e.stopPropagation(); navModalRow(-1) }}
            style={{ position:'absolute', left:18, background:'rgba(255,255,255,0.9)', border:'none', borderRadius:'50%', width:44, height:44, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 8px rgba(0,0,0,0.2)' }}>
            <ChevronLeft size={22} color='#334155'/>
          </button>

          <div className="dv-modal-box" onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:12, width: modal.kind === 'text' ? 'min(920px, 92vw)' : 'min(720px, 90vw)', maxHeight:'88vh', display:'flex', flexDirection:'column' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 18px', borderBottom:'1px solid #e2e8f0', gap:10 }}>
              <span style={{ fontSize:12.5, fontWeight:700, color:'#1a202c', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {modal.kind === 'image' ? <ImageIcon size={13} style={{ display:'inline', marginRight:6 }}/> : <FileText size={13} style={{ display:'inline', marginRight:6 }}/>}
                {classify.nameCol ? getVal(headers, modalRow, classify.nameCol).slice(0, 60) : `Row ${(filteredRidIndex[modal.rid] ?? 0) + 1}`}
              </span>
              {modal.kind === 'image' && classify.weightCol && (
                <div style={{ display:'flex', alignItems:'center', gap:5, flexShrink:0, background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:8, padding:'4px 10px' }}>
                  <WeightIcon size={12} color='#0369a1'/>
                  <input value={getVal(headers, modalRow, classify.weightCol)} onChange={e => updateCell(modal.rid, classify.weightCol, e.target.value)}
                    style={{ width:54, border:'none', outline:'none', fontSize:12.5, fontWeight:700, textAlign:'center', background:'transparent', color:'#0369a1' }}/>
                  <span style={{ fontSize:10, color:'#0369a1' }}>kg</span>
                </div>
              )}
              <span style={{ fontSize:11, color:'#94a3b8', flexShrink:0 }}>{(filteredRidIndex[modal.rid] ?? 0) + 1} / {filteredRows.length}</span>
              <button onClick={() => setModal(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', flexShrink:0 }}><X size={18}/></button>
            </div>

            {/* group tabs (language variants etc.) */}
            {modalGroupCols.length > 1 && modal.kind === 'text' && (
              <div style={{ display:'flex', gap:6, padding:'8px 18px 0' }}>
                {modalGroupCols.map(c => (
                  <button key={c} onClick={() => setModal(m => ({ ...m, col:c }))}
                    style={{ padding:'5px 12px', borderRadius:999, fontSize:11.5, fontWeight:600, cursor:'pointer',
                      background: modal.col === c ? '#4f46e5' : '#f1f5f9', color: modal.col === c ? '#fff' : '#64748b', border:'none' }}>
                    {shortGroupLabel(c) || c}
                  </button>
                ))}
              </div>
            )}

            <div style={{ padding:'14px 20px', overflow:'auto', flex:1 }}>
              {modal.kind === 'image' ? (
                <>
                  <img src={imageSrc(getVal(headers, modalRow, modal.col))} alt="" style={{ maxWidth:'100%', maxHeight:'46vh', borderRadius:8, display:'block', margin:'0 auto', background:'#f8fafc' }}/>
                  {modalGroupCols.length > 1 && (
                    <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap', justifyContent:'center' }}>
                      {modalGroupCols.map(c => {
                        const url = getVal(headers, modalRow, c)
                        if (!url) return null
                        return (
                          <img key={c} src={imageSrc(url)} alt="" onClick={() => setModal(m => ({ ...m, col:c }))}
                            style={{ width:52, height:52, objectFit:'cover', borderRadius:6, cursor:'pointer', border: modal.col === c ? '2px solid #4f46e5' : '1px solid #e2e8f0' }}
                            onError={e => { e.target.style.opacity = 0.25 }}/>
                        )
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                  <div>
                    <div style={{ fontSize:10.5, color:'#94a3b8', fontWeight:600, marginBottom:6, textTransform:'uppercase' }}>Source (HTML) — editable</div>
                    <textarea value={getVal(headers, modalRow, modal.col)} onChange={e => updateCell(modal.rid, modal.col, e.target.value)}
                      rows={14} style={{ width:'100%', padding:'10px 12px', fontSize:12, border:'1.5px solid #e2e8f0', borderRadius:8, outline:'none', resize:'vertical', fontFamily:'monospace', boxSizing:'border-box' }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:10.5, color:'#94a3b8', fontWeight:600, marginBottom:6, textTransform:'uppercase' }}>Live Preview</div>
                    <div style={{ fontSize:13, lineHeight:1.6, color:'#334155', border:'1.5px solid #e2e8f0', borderRadius:8, padding:'10px 12px', minHeight:300 }}
                      dangerouslySetInnerHTML={{ __html: getVal(headers, modalRow, modal.col) }}/>
                  </div>
                </div>
              )}
            </div>

            {/* Footer: live report for this row */}
            <div style={{ borderTop:'1px solid #e2e8f0', padding:'12px 18px', display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <MessageSquarePlus size={14} color='#94a3b8'/>
                <input value={report[modal.rid] || ''} onChange={e => setReport(rp => ({ ...rp, [modal.rid]: e.target.value }))}
                  placeholder="Add note / report for this row..."
                  style={{ flex:1, padding:'8px 12px', fontSize:12.5, border:'1.5px solid #e2e8f0', borderRadius:8, outline:'none' }}/>
              </div>
              {modalPresetTags && (
                <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', paddingLeft:22 }}>
                  <span style={{ fontSize:10, color:'#94a3b8', fontWeight:700, textTransform:'uppercase' }}>
                    Tag as {modalTagCategory(modal)}:
                  </span>
                  {modalPresetTags.map(tag => {
                    const fullTag = `${modalTagCategory(modal)}: ${tag}`
                    const active = tagsOf(report[modal.rid]).includes(fullTag)
                    return (
                      <button key={tag} onClick={() => toggleTag(modal.rid, fullTag)} title={fullTag}
                        style={{ padding:'4px 10px', fontSize:11, fontWeight:600, borderRadius:6, cursor:'pointer',
                          background: active ? '#dc2626' : '#f8fafc', color: active ? '#fff' : '#64748b',
                          border:`1px solid ${active ? '#dc2626' : '#e2e8f0'}` }}>
                        {tag}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <button onClick={e => { e.stopPropagation(); navModalRow(1) }}
            style={{ position:'absolute', right:18, background:'rgba(255,255,255,0.9)', border:'none', borderRadius:'50%', width:44, height:44, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 8px rgba(0,0,0,0.2)' }}>
            <ChevronRight size={22} color='#334155'/>
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:12, fontSize:11, color:'#94a3b8' }}>
          <Info size={12}/> All edits (name, weight, highlights/description HTML, other fields, report) are kept live in this session. Click Download any time to export the current state.
        </div>
      )}
    </div>
  )
}

const th = { position:'sticky', top:0, background:'#f8fafc', borderBottom:'1.5px solid #e2e8f0', padding:'9px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:'#475569', whiteSpace:'nowrap', zIndex:1 }
const td = { padding:'6px 10px', color:'#334155', verticalAlign:'middle' }
