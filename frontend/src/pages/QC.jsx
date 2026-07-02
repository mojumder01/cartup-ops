import { useState, useRef, useMemo } from 'react'
import { getApiKey } from '../utils/gemini'
import {
  QC_COLUMNS, readQcFile, uniqueByProductId, runQcChecks,
  buildQcViewFile, buildQcPassFile,
  getQcLists, saveQcLists, DEFAULT_LISTS,
  loadQcCheckpoint, clearQcCheckpoint,
  getQcBatchSize, saveQcBatchSize,
} from '../utils/qcProcessor'
import {
  CheckSquare, FileSpreadsheet, CheckCircle, AlertCircle, Upload,
  Pause, Eye, X, Download, RefreshCw, Flag, Image as ImageIcon,
  Pencil, ChevronLeft, ChevronRight, MessageSquarePlus, Loader,
  Trash2, Settings, RotateCcw, Undo2,
} from 'lucide-react'

const SHORT_COLS = {
  'ProductId':'Product ID','SellerId':'Seller ID','ShopName':'Shop','CategoryId':'Cat ID',
  'CategoryPath':'Category Path','Name (English)':'Name','Product Image1':'Image',
  'HighlightEn':'HL En','HighlightBn':'HL Bn','DescriptionEn':'Desc En','DescriptionBn':'Desc Bn',
  'Package Weight (kg)':'Weight','Parent Sku':'Parent SKU','Price(MRP)':'Price',
}
const HTML_COLS = ['HighlightEn','HighlightBn','DescriptionEn','DescriptionBn']
const WRAP_COLS = ['ShopName','CategoryPath','Name (English)']
const FILTER_COLS = ['ProductId','SellerId','ShopName','CategoryId','CategoryPath','Name (English)','Parent Sku']

const CHECK_TOGGLES = [
  { key:'name',        label:'Name' },
  { key:'category',    label:'Category' },
  { key:'image',       label:'Image' },
  { key:'highlights',  label:'Highlights' },
  { key:'description', label:'Description' },
  { key:'weight',      label:'Weight' },
  { key:'restricted',  label:'Restricted' },
  { key:'competitor',  label:'Competitor' },
]

// two light alternating colors for variant groups
const VG_COLORS = ['#eff6ff', '#fefce8']

function download(buf, name) {
  const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

export default function QC() {
  const apiKey = getApiKey()
  const [rows, setRows]         = useState(null)
  const [fileName, setFileName] = useState('')
  const [view, setView]         = useState('unique')   // all | unique | variants
  const [status, setStatus]     = useState('')          // '' | processing | paused | done
  const [passInfo, setPassInfo] = useState(null)
  const [error, setError]       = useState('')
  const [issues, setIssues]     = useState({})          // pid → [ai+basic issues]
  const [manualFlags, setManualFlags] = useState({})    // pid → [manual issues]
  const [reportEdit, setReportEdit]   = useState({})    // pid → edited report string (overrides)
  const [editModal, setEditModal]     = useState(null)  // {pid, text}
  const [modal, setModal]       = useState(null)        // {col, index} — preview with prev/next
  const [comment, setComment]   = useState('')
  const [checks, setChecks]     = useState({ name:true, category:true, image:true, highlights:true, description:true, weight:true, restricted:true, competitor:true })
  const [context, setContext]   = useState('')
  const [filters, setFilters]   = useState({})
  const [showFilters, setShowFilters] = useState(false)
  const [variantOk, setVariantOk]     = useState({})    // pid → true (manually checked OK)
  const [removedIds, setRemovedIds]   = useState(new Set())
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [removeModal, setRemoveModal] = useState(false) // paste-list modal
  const [removeText, setRemoveText]   = useState('')
  const [listsModal, setListsModal]   = useState(null)  // {competitors, restrictedKeywords} strings
  const [hasCheckpoint, setHasCheckpoint] = useState(false)
  const [batchSize, setBatchSize] = useState(getQcBatchSize())
  const [fileObj, setFileObj]   = useState(null)
  const [inputKey, setInputKey] = useState(0)
  const signalRef               = useRef({ paused:false })

  const activeRows  = useMemo(() => (rows || []).filter(r => !removedIds.has(r['ProductId'])), [rows, removedIds])
  const uniqueRows  = useMemo(() => uniqueByProductId(activeRows), [activeRows])
  const variantRows = useMemo(() => {
    const counts = {}
    for (const r of activeRows) counts[r['ProductId']] = (counts[r['ProductId']] || 0) + 1
    return activeRows.filter(r => counts[r['ProductId']] > 1)
  }, [activeRows])
  // variant group parity for alternating colors
  const variantGroupIdx = useMemo(() => {
    const map = {}; let i = 0
    for (const r of variantRows) if (!(r['ProductId'] in map)) map[r['ProductId']] = i++
    return map
  }, [variantRows])
  const checksRun   = Object.keys(issues).length > 0

  const baseRows = view === 'unique' ? uniqueRows : view === 'variants' ? variantRows : activeRows
  const displayRows = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v)
    if (!active.length) return baseRows
    return baseRows.filter(r => active.every(([c, v]) => String(r[c] || '').toLowerCase().includes(v.toLowerCase())))
  }, [baseRows, filters])

  // merged issues per product (manual edits override)
  const mergedIssues = pid => {
    if (reportEdit[pid] !== undefined) {
      return reportEdit[pid].trim() ? reportEdit[pid].split(';').map(s => s.trim()).filter(Boolean) : []
    }
    return [...(issues[pid] || []), ...(manualFlags[pid] || [])]
  }
  const allMerged = () => {
    const out = {}
    for (const r of uniqueRows) out[r['ProductId']] = mergedIssues(r['ProductId'])
    return out
  }
  const rejectCount = uniqueRows.filter(r => mergedIssues(r['ProductId']).length).length

  const handleFile = async e => {
    const f = e.target.files[0]
    e.target.value = ''   // allow re-selecting the same file name later
    if (!f) return
    // full state wipe — nothing from the previous file survives
    setRows(null); setIssues({}); setManualFlags({}); setReportEdit({}); setVariantOk({})
    setStatus(''); setError(''); setPassInfo(null); setFilters({})
    setRemovedIds(new Set()); setSelectedIds(new Set()); setView('unique')
    signalRef.current = { paused: true }  // stop any running checks from the old file
    try {
      const parsed = await readQcFile(f)
      if (!parsed.length) { setError('No valid rows found (ProductId required)'); return }
      const cp = loadQcCheckpoint(f)
      if (!cp) clearQcCheckpoint()   // old file's checkpoint — throw away
      setRows(parsed); setFileName(f.name); setFileObj(f)
      setHasCheckpoint(!!cp)
      setInputKey(k => k + 1)
    } catch(err) { setError('Failed to read file: ' + err.message) }
  }

  const handleRun = async () => {
    if (!uniqueRows.length) return
    setError(''); setStatus('processing')
    signalRef.current = { paused:false }
    try {
      const res = await runQcChecks(uniqueRows, apiKey, checks, context, setPassInfo, signalRef.current, fileObj)
      setIssues(res.issuesByProduct)
      setStatus(res.paused ? 'paused' : 'done')
      setHasCheckpoint(res.paused)
    } catch(err) { setStatus(''); setError(err.message) }
  }

  const handlePause = () => { signalRef.current.paused = true }
  const handleReset = () => {
    clearQcCheckpoint()
    setRows(null); setFileName(''); setFileObj(null); setIssues({}); setManualFlags({}); setReportEdit({})
    setVariantOk({}); setStatus(''); setError(''); setPassInfo(null); setFilters({})
    setRemovedIds(new Set()); setSelectedIds(new Set()); setHasCheckpoint(false); setInputKey(k => k + 1)
  }

  // ── Product remove ──
  const toggleSelect = pid => setSelectedIds(s => {
    const n = new Set(s); n.has(pid) ? n.delete(pid) : n.add(pid); return n
  })
  const removeSelected = () => {
    setRemovedIds(r => new Set([...r, ...selectedIds]))
    setSelectedIds(new Set())
  }
  const removeFromText = () => {
    const ids = removeText.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
    setRemovedIds(r => new Set([...r, ...ids]))
    setRemoveText(''); setRemoveModal(false)
  }
  const undoRemove = () => setRemovedIds(new Set())

  const addManual = (pid, text) => {
    if (!text.trim()) return
    setManualFlags(f => ({ ...f, [pid]: [...(f[pid] || []), text.trim()] }))
  }
  const toggleImageFlag = pid => {
    const flag = 'Image: poor quality/blur (manual)'
    setManualFlags(f => {
      const cur = f[pid] || []
      return { ...f, [pid]: cur.includes(flag) ? cur.filter(x => x !== flag) : [...cur, flag] }
    })
  }
  const toggleVariantFlag = pid => {
    const flag = 'Variant: issue found (manual)'
    setManualFlags(f => {
      const cur = f[pid] || []
      return { ...f, [pid]: cur.includes(flag) ? cur.filter(x => x !== flag) : [...cur, flag] }
    })
  }

  const handleDownloadView = () => download(buildQcViewFile(uniqueRows, allMerged()), 'cartup_unique_qc_view.xlsx')
  const handleDownloadPass = () => download(buildQcPassFile(uniqueRows, allMerged()), 'cartup_qc_pass.xlsx')

  // modal helpers
  const modalRow = modal ? displayRows[modal.index] : null
  const modalNav = dir => {
    setComment('')
    setModal(m => {
      let i = m.index + dir
      if (i < 0) i = displayRows.length - 1
      if (i >= displayRows.length) i = 0
      return { ...m, index: i }
    })
  }

  const btn = (bg, color, border) => ({
    display:'flex', alignItems:'center', gap:6, padding:'8px 14px', background:bg, color,
    border:`1.5px solid ${border || bg}`, borderRadius:8, fontWeight:600, fontSize:12.5, cursor:'pointer',
  })

  const isImgModal = modal?.col === 'Product Image1' || modal?.col === 'Variant Image1'

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* Compact top bar */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'10px 20px', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <CheckSquare size={17} color='#16a34a'/>
        <span style={{ fontSize:14, fontWeight:700, color:'#1a202c' }}>QC</span>
        <span style={{ fontSize:11, color:'#94a3b8' }}>Sequential column checks · unique by Product ID</span>

        {rows && (
          <>
            <span style={{ fontSize:11, color:'#15803d', background:'#dcfce7', padding:'3px 10px', borderRadius:999, fontWeight:600 }}>
              {fileName} · {rows.length} rows · {uniqueRows.length} unique
            </span>
            <div style={{ flex:1 }}/>
            {status === 'processing' && passInfo && (
              <span style={{ display:'flex', alignItems:'center', gap:7, fontSize:11.5, color:'#1d4ed8', background:'#eff6ff', padding:'4px 12px', borderRadius:999 }}>
                <Loader size={11} style={{ animation:'spin 1s linear infinite' }}/>
                Pass {passInfo.pass}/{passInfo.totalPasses} {passInfo.label} — {passInfo.done}/{passInfo.total}
              </span>
            )}
            {status !== 'processing' && (
              <button onClick={handleRun} style={btn('#4f46e5','#fff')} disabled={!apiKey}>
                <Upload size={13}/> {status==='paused' ? 'Continue' : 'Run QC Checks'}
              </button>
            )}
            {status === 'processing' && (
              <button onClick={handlePause} style={btn('#fff','#d97706','#fde68a')}><Pause size={13}/> Pause</button>
            )}
            <label style={{ ...btn('#fff','#4f46e5','#c7d2fe'), display:'flex' }}>
              <input key={inputKey + '_new'} type="file" accept=".xlsx" style={{ display:'none' }} onChange={handleFile}/>
              <FileSpreadsheet size={13}/> New File
            </label>
            <button onClick={handleReset} style={btn('#fff','#94a3b8','#e2e8f0')}><RefreshCw size={12}/> Reset</button>
          </>
        )}
      </div>

      {/* Controls row: check toggles + context input */}
      {rows && (
        <div style={{ background:'#fafbfc', borderBottom:'1px solid #e2e8f0', padding:'8px 20px', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <span style={{ fontSize:10.5, fontWeight:700, color:'#94a3b8', textTransform:'uppercase' }}>Checks:</span>
          {CHECK_TOGGLES.map(({ key, label }) => (
            <button key={key} onClick={() => setChecks(c => ({ ...c, [key]: !c[key] }))}
              style={{
                padding:'4px 11px', borderRadius:999, fontSize:11, fontWeight:600, cursor:'pointer',
                background: checks[key] ? '#eef2ff' : '#f1f5f9',
                color: checks[key] ? '#4f46e5' : '#94a3b8',
                border:`1.5px solid ${checks[key] ? '#c7d2fe' : '#e2e8f0'}`,
              }}>
              {checks[key] ? '✓ ' : ''}{label}
            </button>
          ))}
          <div style={{ width:1, height:20, background:'#e2e8f0', margin:'0 4px' }}/>
          <input value={context} onChange={e => setContext(e.target.value)}
            placeholder="Product type / category context (e.g. kitchen appliances) — helps AI accuracy"
            style={{ flex:1, minWidth:220, padding:'6px 12px', fontSize:12, border:'1.5px solid #e2e8f0', borderRadius:8, outline:'none', background:'#fff' }}/>
          <div style={{ width:1, height:20, background:'#e2e8f0', margin:'0 4px' }}/>
          <span style={{ fontSize:10.5, fontWeight:700, color:'#94a3b8', textTransform:'uppercase' }}
            title={'BATCH SIZE — কত products একসাথে AI-কে পাঠানো হবে:\n\n• ছোট (1-5): প্রতি product-এ AI-র বেশি মনোযোগ = বেশি accuracy। কিন্তু API call বেশি = ধীর, daily quota তাড়াতাড়ি শেষ।\n\n• বড় (10-20): কম API call = দ্রুত, quota বাঁচে। কিন্তু AI মাঝে মাঝে শেষের product গুলোতে মনোযোগ হারায় = accuracy কমে।\n\n• Recommended: ছোট file (<200) হলে 5, বড় file হলে 10।'}>
            Batch: ⓘ
          </span>
          <input type="number" min={1} max={20} value={batchSize}
            onChange={e => {
              const v = parseInt(e.target.value, 10)
              if (!isNaN(v)) { setBatchSize(v); saveQcBatchSize(v) }
            }}
            title="Small = accurate but slow (more API calls) · Large = fast but less accurate"
            style={{ width:52, padding:'6px 8px', fontSize:12, border:'1.5px solid #e2e8f0', borderRadius:8, outline:'none', background:'#fff', textAlign:'center' }}/>
        </div>
      )}

      <div style={{ flex:1, overflow:'auto', padding:'14px 20px' }}>

        {/* Upload */}
        {!rows && (
          <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:24, maxWidth:560 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'#718096', textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:10 }}>
              QC Input File <span style={{ color:'#dc2626' }}>*</span>
            </div>
            <label style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px', border:'1.5px dashed #e2e8f0', borderRadius:8, cursor:'pointer', background:'#fafafa' }}>
              <input key={inputKey} type="file" accept=".xlsx" style={{ display:'none' }} onChange={handleFile}/>
              <FileSpreadsheet size={16} color='#94a3b8'/>
              <span style={{ fontSize:13, color:'#94a3b8' }}>Choose Admin QC .xlsx file...</span>
            </label>
          </div>
        )}

        {error && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, marginBottom:12, maxWidth:560 }}>
            <AlertCircle size={15} color='#dc2626'/><span style={{ fontSize:13, color:'#dc2626' }}>{error}</span>
          </div>
        )}

        {rows && (
          <>
            {/* Views + downloads */}
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
              <div style={{ display:'flex', border:'1.5px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
                {[['all',`All Products (${rows.length})`],['unique',`Unique-QC View (${uniqueRows.length})`],['variants',`Variant Check (${variantRows.length})`]].map(([v, lbl]) => (
                  <button key={v} onClick={() => setView(v)}
                    style={{ padding:'7px 14px', fontSize:12, fontWeight:600, border:'none', cursor:'pointer',
                      background: view===v ? '#4f46e5' : '#fff', color: view===v ? '#fff' : '#64748b' }}>
                    {lbl}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowFilters(s => !s)}
                style={btn(showFilters ? '#eef2ff' : '#fff', showFilters ? '#4f46e5' : '#64748b', showFilters ? '#c7d2fe' : '#e2e8f0')}>
                Filter {Object.values(filters).filter(Boolean).length ? `(${Object.values(filters).filter(Boolean).length})` : ''}
              </button>

              {/* Remove controls */}
              {selectedIds.size > 0 && (
                <button onClick={removeSelected} style={btn('#dc2626','#fff')}>
                  <Trash2 size={13}/> Remove Selected ({selectedIds.size})
                </button>
              )}
              <button onClick={() => setRemoveModal(true)} style={btn('#fff','#dc2626','#fecaca')}>
                <Trash2 size={13}/> Remove by ID
              </button>
              {removedIds.size > 0 && (
                <button onClick={undoRemove} style={btn('#fef2f2','#dc2626','#fecaca')} title="Undo all removals">
                  <Undo2 size={13}/> Removed: {removedIds.size}
                </button>
              )}

              <button onClick={() => { const l = getQcLists(); setListsModal({ competitors: l.competitors.join(', '), restrictedKeywords: l.restrictedKeywords.join(', ') }) }}
                style={btn('#fff','#64748b','#e2e8f0')} title="Edit competitor & restricted keyword lists">
                <Settings size={13}/> Lists
              </button>

              {hasCheckpoint && status !== 'processing' && (
                <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a', padding:'5px 10px', borderRadius:999 }}>
                  <RotateCcw size={11}/> Checkpoint saved — Continue resumes
                </span>
              )}
              <div style={{ flex:1 }}/>
              {(checksRun || Object.keys(manualFlags).length > 0 || Object.keys(reportEdit).length > 0) && (
                <>
                  <span style={{ fontSize:12, color:'#15803d', fontWeight:600 }}>
                    {uniqueRows.length - rejectCount} OK · {rejectCount} issues
                  </span>
                  <button onClick={handleDownloadView} style={btn('#16a34a','#fff')}><Download size={13}/> Unique-QC View</button>
                  <button onClick={handleDownloadPass} style={btn('#0369a1','#fff')}><Download size={13}/> QC Pass File</button>
                </>
              )}
            </div>

            {/* ── Variant check table ── */}
            {view === 'variants' && (
              <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, overflow:'auto', maxHeight:'calc(100vh - 210px)' }}>
                <table style={{ borderCollapse:'collapse', fontSize:12, width:'100%' }}>
                  <thead>
                    <tr>
                      {['SL','Product ID','Variant Name','Variant Image','Shop','Manual Check','Report'].map(h => (
                        <th key={h} style={{ position:'sticky', top:0, background:'#f8fafc', borderBottom:'1.5px solid #e2e8f0', padding:'9px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'#475569', zIndex:1 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((r, i) => {
                      const pid = r['ProductId']
                      const flagged = (manualFlags[pid] || []).some(x => x.startsWith('Variant:'))
                      const okd = variantOk[pid]
                      const groupColor = VG_COLORS[(variantGroupIdx[pid] ?? 0) % 2]
                      return (
                        <tr key={i} style={{ borderBottom:'1px solid #f1f5f9', background: flagged ? '#fef2f2' : okd ? '#f0fdf4' : groupColor }}>
                          <td style={{ padding:'6px 12px', color:'#94a3b8' }}>{i + 1}</td>
                          <td style={{ padding:'6px 12px', color:'#334155', fontWeight:600 }}>{pid}</td>
                          <td style={{ padding:'6px 12px', color:'#334155' }}>{r['VariantName']}</td>
                          <td style={{ padding:'6px 12px' }}>
                            {r['Variant Image1']
                              ? <img src={r['Variant Image1']} alt="" loading="lazy"
                                  onClick={() => setModal({ col:'Variant Image1', index:i })}
                                  style={{ width:44, height:44, objectFit:'cover', borderRadius:6, cursor:'pointer', border:'1px solid #e2e8f0' }}
                                  onError={e => { e.target.style.opacity=0.25 }}/>
                              : <span style={{ color:'#dc2626', fontSize:11 }}>missing</span>}
                          </td>
                          <td style={{ padding:'6px 12px', color:'#334155', whiteSpace:'normal', maxWidth:160 }}>{r['ShopName']}</td>
                          <td style={{ padding:'6px 12px' }}>
                            <div style={{ display:'flex', gap:6 }}>
                              <button onClick={() => { setVariantOk(v => ({ ...v, [pid]: true })); if (flagged) toggleVariantFlag(pid) }}
                                style={{ padding:'4px 10px', fontSize:11, fontWeight:600, borderRadius:6, cursor:'pointer',
                                  background: okd ? '#16a34a' : '#f0fdf4', color: okd ? '#fff' : '#16a34a', border:'1.5px solid #bbf7d0' }}>
                                OK
                              </button>
                              <button onClick={() => { setVariantOk(v => ({ ...v, [pid]: false })); if (!flagged) toggleVariantFlag(pid) }}
                                style={{ padding:'4px 10px', fontSize:11, fontWeight:600, borderRadius:6, cursor:'pointer',
                                  background: flagged ? '#dc2626' : '#fef2f2', color: flagged ? '#fff' : '#dc2626', border:'1.5px solid #fecaca' }}>
                                <Flag size={10} style={{ display:'inline' }}/> Issue
                              </button>
                            </div>
                          </td>
                          <td style={{ padding:'6px 12px', fontSize:11, color: flagged ? '#dc2626' : '#16a34a', maxWidth:220 }}>
                            {mergedIssues(pid).length ? mergedIssues(pid).join('; ') : (okd ? 'OK' : '—')}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Main table ── */}
            {view !== 'variants' && (
              <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, overflow:'auto', maxHeight:'calc(100vh - 210px)' }}>
                <table style={{ borderCollapse:'collapse', fontSize:12, width:'100%', minWidth:1400 }}>
                  <thead>
                    <tr>
                      <th style={{ position:'sticky', top:0, background:'#f8fafc', borderBottom:'1.5px solid #e2e8f0', padding:'9px 8px', zIndex:1 }}>
                        <input type="checkbox"
                          checked={displayRows.length > 0 && displayRows.every(r => selectedIds.has(r['ProductId']))}
                          onChange={e => {
                            const pids = displayRows.map(r => r['ProductId'])
                            setSelectedIds(s => {
                              const n = new Set(s)
                              e.target.checked ? pids.forEach(p => n.add(p)) : pids.forEach(p => n.delete(p))
                              return n
                            })
                          }}
                          style={{ cursor:'pointer' }}/>
                      </th>
                      <th style={{ position:'sticky', top:0, background:'#f8fafc', borderBottom:'1.5px solid #e2e8f0', padding:'9px 8px', textAlign:'left', fontSize:11, fontWeight:700, color:'#475569', zIndex:1 }}>SL</th>
                      {QC_COLUMNS.map(c => (
                        <th key={c} style={{ position:'sticky', top:0, background:'#f8fafc', borderBottom:'1.5px solid #e2e8f0', padding:'9px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:'#475569', whiteSpace:'nowrap', zIndex:1 }}>
                          {SHORT_COLS[c] || c}
                        </th>
                      ))}
                      <th style={{ position:'sticky', top:0, background:'#f8fafc', borderBottom:'1.5px solid #e2e8f0', padding:'9px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:'#475569', zIndex:1 }}>Report</th>
                    </tr>
                    {showFilters && (
                      <tr>
                        <th style={{ position:'sticky', top:33, background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'4px 8px', zIndex:1 }}/>
                        <th style={{ position:'sticky', top:33, background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'4px 8px', zIndex:1 }}/>
                        {QC_COLUMNS.map(c => (
                          <th key={c} style={{ position:'sticky', top:33, background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'4px 6px', zIndex:1 }}>
                            {FILTER_COLS.includes(c) && (
                              <input value={filters[c] || ''} onChange={e => setFilters(f => ({ ...f, [c]: e.target.value }))}
                                placeholder="filter..."
                                style={{ width:'100%', minWidth:70, padding:'4px 7px', fontSize:11, border:'1px solid #e2e8f0', borderRadius:5, outline:'none' }}/>
                            )}
                          </th>
                        ))}
                        <th style={{ position:'sticky', top:33, background:'#fff', borderBottom:'1px solid #e2e8f0', zIndex:1 }}/>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {displayRows.map((r, i) => {
                      const pid = r['ProductId']
                      const pIssues = mergedIssues(pid)
                      const hasAny = checksRun || (manualFlags[pid]||[]).length || reportEdit[pid] !== undefined
                      const imgFlagged = (manualFlags[pid] || []).some(x => x.startsWith('Image:'))
                      return (
                        <tr key={i} style={{ borderBottom:'1px solid #f1f5f9', background: hasAny && pIssues.length ? '#fef2f2' : '#fff' }}>
                          <td style={{ padding:'6px 8px' }}>
                            <input type="checkbox" checked={selectedIds.has(pid)} onChange={() => toggleSelect(pid)} style={{ cursor:'pointer' }}/>
                          </td>
                          <td style={{ padding:'6px 8px', color:'#94a3b8', fontSize:11 }}>{i + 1}</td>
                          {QC_COLUMNS.map(c => {
                            if (c === 'Product Image1') {
                              return (
                                <td key={c} style={{ padding:'6px 10px' }}>
                                  {r[c] ? (
                                    <div style={{ position:'relative', display:'inline-block' }}>
                                      <img src={r[c]} alt="" loading="lazy"
                                        onClick={() => setModal({ col:c, index:i })}
                                        style={{ width:42, height:42, objectFit:'cover', borderRadius:6, cursor:'pointer', border: imgFlagged ? '2px solid #dc2626' : '1px solid #e2e8f0' }}
                                        onError={e => { e.target.style.opacity=0.25 }}/>
                                      {imgFlagged && <Flag size={11} color='#dc2626' style={{ position:'absolute', top:-4, right:-4, background:'#fff', borderRadius:3 }}/>}
                                    </div>
                                  ) : <span style={{ color:'#dc2626', fontSize:11 }}>missing</span>}
                                </td>
                              )
                            }
                            if (HTML_COLS.includes(c)) {
                              const has = String(r[c] || '').trim()
                              return (
                                <td key={c} style={{ padding:'6px 10px' }}>
                                  {has ? (
                                    <button onClick={() => setModal({ col:c, index:i })}
                                      style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 8px', fontSize:11, background:'#eef2ff', color:'#4f46e5', border:'1px solid #c7d2fe', borderRadius:6, cursor:'pointer', fontWeight:600 }}>
                                      <Eye size={11}/> View
                                    </button>
                                  ) : <span style={{ color:'#dc2626', fontSize:11 }}>empty</span>}
                                </td>
                              )
                            }
                            const wrap = WRAP_COLS.includes(c)
                            return (
                              <td key={c} style={{
                                padding:'6px 10px', color:'#334155',
                                maxWidth: wrap ? 220 : 110,
                                whiteSpace: wrap ? 'normal' : 'nowrap',
                                overflow: wrap ? 'visible' : 'hidden',
                                textOverflow: wrap ? 'clip' : 'ellipsis',
                                wordBreak: wrap ? 'break-word' : 'normal',
                                fontSize: wrap ? 11.5 : 12,
                              }} title={r[c]}>
                                {r[c]}
                              </td>
                            )
                          })}
                          <td style={{ padding:'6px 10px', minWidth:200, maxWidth:340 }}>
                            <div style={{ display:'flex', alignItems:'flex-start', gap:6 }}>
                              <div style={{ flex:1 }}>
                                {hasAny
                                  ? pIssues.length
                                    ? <span style={{ color:'#dc2626', fontSize:11, whiteSpace:'normal' }}>{pIssues.join('; ')}</span>
                                    : <span style={{ color:'#16a34a', fontSize:11, fontWeight:600 }}>OK</span>
                                  : <span style={{ color:'#cbd5e1', fontSize:11 }}>—</span>}
                              </div>
                              {hasAny && (
                                <button onClick={() => setEditModal({ pid, text: pIssues.join('; ') })} title="Edit report"
                                  style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', padding:2, flexShrink:0 }}>
                                  <Pencil size={12}/>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Preview modal (image / HTML) with prev-next + comment ── */}
      {modal && modalRow && (
        <div onClick={() => { setModal(null); setComment('') }} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          {/* Prev */}
          <button onClick={e => { e.stopPropagation(); modalNav(-1) }}
            style={{ position:'absolute', left:18, background:'rgba(255,255,255,0.9)', border:'none', borderRadius:'50%', width:44, height:44, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 8px rgba(0,0,0,0.2)' }}>
            <ChevronLeft size={22} color='#334155'/>
          </button>

          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:12, width:'min(760px, 90vw)', maxHeight:'86vh', display:'flex', flexDirection:'column' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 18px', borderBottom:'1px solid #e2e8f0', gap:10 }}>
              <span style={{ fontSize:12.5, fontWeight:700, color:'#1a202c', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {isImgModal ? <ImageIcon size={13} style={{ display:'inline', marginRight:6 }}/> : null}
                {SHORT_COLS[modal.col] || modal.col} — {modalRow['Name (English)']?.slice(0, 65)}
              </span>
              <span style={{ fontSize:11, color:'#94a3b8', flexShrink:0 }}>{modal.index + 1} / {displayRows.length}</span>
              <button onClick={() => { setModal(null); setComment('') }} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', flexShrink:0 }}><X size={18}/></button>
            </div>

            <div style={{ padding:'14px 20px', overflow:'auto', flex:1 }}>
              {isImgModal
                ? <img src={modalRow[modal.col]} alt="" style={{ maxWidth:'100%', maxHeight:'52vh', borderRadius:8, display:'block', margin:'0 auto' }}/>
                : <div style={{ fontSize:13, lineHeight:1.6, color:'#334155' }} dangerouslySetInnerHTML={{ __html: modalRow[modal.col] }}/>}
            </div>

            {/* Footer: flag + comment */}
            <div style={{ borderTop:'1px solid #e2e8f0', padding:'12px 18px', display:'flex', flexDirection:'column', gap:10 }}>
              {isImgModal && (
                <button onClick={() => toggleImageFlag(modalRow['ProductId'])}
                  style={{
                    alignSelf:'center', display:'flex', alignItems:'center', gap:7, padding:'8px 16px', borderRadius:8, fontWeight:600, fontSize:12.5, cursor:'pointer',
                    background: (manualFlags[modalRow['ProductId']]||[]).some(x => x.startsWith('Image:')) ? '#dcfce7' : '#fef2f2',
                    color: (manualFlags[modalRow['ProductId']]||[]).some(x => x.startsWith('Image:')) ? '#15803d' : '#dc2626',
                    border:`1.5px solid ${(manualFlags[modalRow['ProductId']]||[]).some(x => x.startsWith('Image:')) ? '#bbf7d0' : '#fecaca'}`,
                  }}>
                  <Flag size={13}/>
                  {(manualFlags[modalRow['ProductId']]||[]).some(x => x.startsWith('Image:')) ? 'Remove flag (image OK)' : 'Flag: poor quality / blur'}
                </button>
              )}
              <div style={{ display:'flex', gap:8 }}>
                <input value={comment} onChange={e => setComment(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && comment.trim()) { addManual(modalRow['ProductId'], `${SHORT_COLS[modal.col] || modal.col}: ${comment} (manual)`); setComment('') } }}
                  placeholder="Add comment to report... (Enter to add)"
                  style={{ flex:1, padding:'8px 12px', fontSize:12.5, border:'1.5px solid #e2e8f0', borderRadius:8, outline:'none' }}/>
                <button onClick={() => { if (comment.trim()) { addManual(modalRow['ProductId'], `${SHORT_COLS[modal.col] || modal.col}: ${comment} (manual)`); setComment('') } }}
                  style={btn('#4f46e5','#fff')}>
                  <MessageSquarePlus size={13}/> Add
                </button>
              </div>
              {(manualFlags[modalRow['ProductId']] || []).length > 0 && (
                <div style={{ fontSize:11, color:'#b45309' }}>
                  Manual: {(manualFlags[modalRow['ProductId']] || []).join('; ')}
                </div>
              )}
            </div>
          </div>

          {/* Next */}
          <button onClick={e => { e.stopPropagation(); modalNav(1) }}
            style={{ position:'absolute', right:18, background:'rgba(255,255,255,0.9)', border:'none', borderRadius:'50%', width:44, height:44, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 8px rgba(0,0,0,0.2)' }}>
            <ChevronRight size={22} color='#334155'/>
          </button>
        </div>
      )}

      {/* ── Report edit modal ── */}
      {editModal && (
        <div onClick={() => setEditModal(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:110 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:12, width:'min(540px, 90vw)', padding:20 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <span style={{ fontSize:13, fontWeight:700, color:'#1a202c' }}>Edit Report — Product {editModal.pid}</span>
              <button onClick={() => setEditModal(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8' }}><X size={17}/></button>
            </div>
            <textarea value={editModal.text} onChange={e => setEditModal(m => ({ ...m, text: e.target.value }))}
              rows={5} placeholder="Separate issues with ; — leave empty for OK"
              style={{ width:'100%', padding:'10px 12px', fontSize:12.5, border:'1.5px solid #e2e8f0', borderRadius:8, outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box' }}/>
            <div style={{ display:'flex', gap:8, marginTop:12, justifyContent:'flex-end' }}>
              <button onClick={() => setEditModal(null)} style={btn('#fff','#64748b','#e2e8f0')}>Cancel</button>
              <button onClick={() => { setReportEdit(re => ({ ...re, [editModal.pid]: editModal.text })); setEditModal(null) }}
                style={btn('#16a34a','#fff')}>Save Report</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove by ID modal ── */}
      {removeModal && (
        <div onClick={() => setRemoveModal(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:110 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:12, width:'min(480px, 90vw)', padding:20 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <span style={{ fontSize:13, fontWeight:700, color:'#1a202c' }}>Remove Products</span>
              <button onClick={() => setRemoveModal(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8' }}><X size={17}/></button>
            </div>
            <div style={{ fontSize:11.5, color:'#64748b', marginBottom:8 }}>
              Paste Product IDs — single or multiple (separate with comma, space, or new line). Removed products are excluded from both output files.
            </div>
            <textarea value={removeText} onChange={e => setRemoveText(e.target.value)}
              rows={5} placeholder={'2394727\n2394723, 2390907'}
              style={{ width:'100%', padding:'10px 12px', fontSize:12.5, border:'1.5px solid #e2e8f0', borderRadius:8, outline:'none', resize:'vertical', fontFamily:'monospace', boxSizing:'border-box' }}/>
            <div style={{ display:'flex', gap:8, marginTop:12, justifyContent:'flex-end' }}>
              <button onClick={() => setRemoveModal(false)} style={btn('#fff','#64748b','#e2e8f0')}>Cancel</button>
              <button onClick={removeFromText} disabled={!removeText.trim()} style={btn('#dc2626','#fff')}>
                <Trash2 size={13}/> Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lists editor modal ── */}
      {listsModal && (
        <div onClick={() => setListsModal(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:110 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:12, width:'min(560px, 90vw)', padding:20, maxHeight:'85vh', overflow:'auto' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <span style={{ fontSize:13, fontWeight:700, color:'#1a202c' }}>Check Lists (comma separated)</span>
              <button onClick={() => setListsModal(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8' }}><X size={17}/></button>
            </div>
            <div style={{ fontSize:11.5, fontWeight:600, color:'#64748b', marginBottom:5 }}>Competitor names / sites</div>
            <textarea value={listsModal.competitors} onChange={e => setListsModal(m => ({ ...m, competitors: e.target.value }))}
              rows={4} style={{ width:'100%', padding:'9px 12px', fontSize:12, border:'1.5px solid #e2e8f0', borderRadius:8, outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box', marginBottom:12 }}/>
            <div style={{ fontSize:11.5, fontWeight:600, color:'#64748b', marginBottom:5 }}>Restricted keywords</div>
            <textarea value={listsModal.restrictedKeywords} onChange={e => setListsModal(m => ({ ...m, restrictedKeywords: e.target.value }))}
              rows={4} style={{ width:'100%', padding:'9px 12px', fontSize:12, border:'1.5px solid #e2e8f0', borderRadius:8, outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box' }}/>
            <div style={{ display:'flex', gap:8, marginTop:12, justifyContent:'space-between' }}>
              <button onClick={() => setListsModal({ competitors: DEFAULT_LISTS.competitors.join(', '), restrictedKeywords: DEFAULT_LISTS.restrictedKeywords.join(', ') })}
                style={btn('#fff','#94a3b8','#e2e8f0')}>Restore defaults</button>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => setListsModal(null)} style={btn('#fff','#64748b','#e2e8f0')}>Cancel</button>
                <button onClick={() => {
                  saveQcLists({
                    competitors: listsModal.competitors.split(',').map(s => s.trim()).filter(Boolean),
                    restrictedKeywords: listsModal.restrictedKeywords.split(',').map(s => s.trim()).filter(Boolean),
                  })
                  setListsModal(null)
                }} style={btn('#16a34a','#fff')}>Save Lists</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
