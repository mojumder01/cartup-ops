import { useState, useRef, useMemo } from 'react'
import { getApiKey } from '../utils/gemini'
import {
  QC_COLUMNS, readQcFile, uniqueByProductId, runQcChecks,
  buildQcViewFile, buildQcPassFile, basicChecks,
} from '../utils/qcProcessor'
import {
  CheckSquare, FileSpreadsheet, CheckCircle, AlertCircle, Loader, Upload,
  Pause, Eye, X, Download, RefreshCw, Flag, Image as ImageIcon,
} from 'lucide-react'

const SHORT_COLS = {
  'ProductId':'Product ID','SellerId':'Seller ID','ShopName':'Shop','CategoryId':'Cat ID',
  'CategoryPath':'Category Path','Name (English)':'Name','Product Image1':'Image',
  'HighlightEn':'HL En','HighlightBn':'HL Bn','DescriptionEn':'Desc En','DescriptionBn':'Desc Bn',
  'Package Weight (kg)':'Weight','Parent Sku':'Parent SKU','Price(MRP)':'Price',
}
const HTML_COLS = ['HighlightEn','HighlightBn','DescriptionEn','DescriptionBn']

function download(buf, name) {
  const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

export default function QC() {
  const apiKey = getApiKey()
  const [rows, setRows]         = useState(null)      // all rows
  const [fileName, setFileName] = useState('')
  const [view, setView]         = useState('unique')  // 'all' | 'unique'
  const [status, setStatus]     = useState('')        // '' | processing | paused | done
  const [passInfo, setPassInfo] = useState(null)
  const [error, setError]       = useState('')
  const [issues, setIssues]     = useState({})        // pid → [issues]
  const [manualFlags, setManualFlags] = useState({})  // pid → ['Image: poor quality (manual)']
  const [preview, setPreview]   = useState(null)      // {title, html}
  const [imgView, setImgView]   = useState(null)      // {pid, url, name}
  const [inputKey, setInputKey] = useState(0)
  const signalRef               = useRef({ paused:false })

  const uniqueRows  = useMemo(() => rows ? uniqueByProductId(rows) : [], [rows])
  const displayRows = view === 'unique' ? uniqueRows : (rows || [])
  const checksRun   = Object.keys(issues).length > 0

  const handleFile = async e => {
    const f = e.target.files[0]
    if (!f) return
    setError(''); setIssues({}); setManualFlags({}); setStatus(''); setPassInfo(null)
    try {
      const parsed = await readQcFile(f)
      if (!parsed.length) { setError('No valid rows found (ProductId required)'); return }
      setRows(parsed); setFileName(f.name)
    } catch(err) { setError('Failed to read file: ' + err.message) }
  }

  const handleRun = async () => {
    if (!uniqueRows.length) return
    setError(''); setStatus('processing')
    signalRef.current = { paused:false }
    try {
      const res = await runQcChecks(uniqueRows, apiKey, setPassInfo, signalRef.current)
      setIssues(res.issuesByProduct)
      setStatus(res.paused ? 'paused' : 'done')
    } catch(err) { setStatus(''); setError(err.message) }
  }

  const handlePause = () => { signalRef.current.paused = true }

  const handleReset = () => {
    setRows(null); setFileName(''); setIssues({}); setManualFlags({})
    setStatus(''); setError(''); setPassInfo(null); setInputKey(k => k + 1)
  }

  const toggleManualFlag = pid => {
    setManualFlags(f => {
      const cur = f[pid] || []
      return { ...f, [pid]: cur.length ? [] : ['Image: poor quality/blur (manual)'] }
    })
  }

  const productIssues = pid => [...(issues[pid] || (rows && !checksRun ? [] : [])), ...(manualFlags[pid] || [])]

  const rejectCount = uniqueRows.filter(r => productIssues(r['ProductId']).length).length

  const handleDownloadView = () => download(buildQcViewFile(uniqueRows, issues, manualFlags), 'cartup_unique_qc_view.xlsx')
  const handleDownloadPass = () => download(buildQcPassFile(uniqueRows, issues, manualFlags), 'cartup_qc_pass.xlsx')

  const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:20, marginBottom:14 }
  const btn = (bg, color, border) => ({
    display:'flex', alignItems:'center', gap:7, padding:'9px 16px', background:bg, color,
    border:`1.5px solid ${border || bg}`, borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer',
  })

  return (
    <div>
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'18px 28px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <CheckSquare size={20} color='#16a34a'/>
          <div>
            <h1 style={{ fontSize:17, fontWeight:700, color:'#1a202c', margin:0 }}>QC</h1>
            <p style={{ fontSize:12, color:'#718096', margin:0 }}>Quality check — sequential column checks, unique by Product ID</p>
          </div>
        </div>
      </div>

      <div style={{ padding:'22px 28px' }}>

        {/* Upload */}
        {!rows && (
          <div style={{ ...card, maxWidth:560 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'#718096', textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:10 }}>
              QC Input File <span style={{ color:'#dc2626' }}>*</span>
            </div>
            <label style={{
              display:'flex', alignItems:'center', gap:10, padding:'12px 14px',
              border:'1.5px dashed #e2e8f0', borderRadius:8, cursor:'pointer', background:'#fafafa',
            }}>
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
            {/* Toolbar */}
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'#dcfce7', border:'1px solid #bbf7d0', borderRadius:8, fontSize:12, color:'#15803d', fontWeight:500 }}>
                <CheckCircle size={13}/>{fileName} — {rows.length} rows, {uniqueRows.length} unique products
              </div>

              {/* View toggle */}
              <div style={{ display:'flex', border:'1.5px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
                <button onClick={() => setView('all')}
                  style={{ padding:'8px 14px', fontSize:12, fontWeight:600, border:'none', cursor:'pointer',
                    background: view==='all' ? '#4f46e5' : '#fff', color: view==='all' ? '#fff' : '#64748b' }}>
                  All Products ({rows.length})
                </button>
                <button onClick={() => setView('unique')}
                  style={{ padding:'8px 14px', fontSize:12, fontWeight:600, border:'none', cursor:'pointer',
                    background: view==='unique' ? '#4f46e5' : '#fff', color: view==='unique' ? '#fff' : '#64748b' }}>
                  Unique-QC View ({uniqueRows.length})
                </button>
              </div>

              <div style={{ flex:1 }}/>

              {status !== 'processing' && (
                <>
                  <button onClick={handleRun} style={btn('#4f46e5','#fff')} disabled={!apiKey}>
                    <Upload size={14}/> {status==='paused' ? 'Continue Checks' : 'Run QC Checks'}
                  </button>
                  <button onClick={handleReset} style={btn('#fff','#94a3b8','#e2e8f0')}>
                    <RefreshCw size={13}/> Reset
                  </button>
                </>
              )}
              {status === 'processing' && (
                <button onClick={handlePause} style={btn('#fff','#d97706','#fde68a')}>
                  <Pause size={14}/> Pause
                </button>
              )}
            </div>

            {/* Progress */}
            {status === 'processing' && passInfo && (
              <div style={{ ...card, padding:14 }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#64748b', marginBottom:6 }}>
                  <span style={{ fontWeight:600 }}>Pass {passInfo.pass}/{passInfo.totalPasses}: {passInfo.label}</span>
                  <span>{passInfo.done} / {passInfo.total}</span>
                </div>
                <div style={{ background:'#e2e8f0', borderRadius:999, height:7 }}>
                  <div style={{ width:`${Math.round((passInfo.done/passInfo.total)*100)}%`, background:'#4f46e5', borderRadius:999, height:7, transition:'width 0.3s' }}/>
                </div>
              </div>
            )}

            {/* Done summary + downloads */}
            {(status === 'done' || checksRun) && status !== 'processing' && (
              <div style={{ ...card, padding:14, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <span style={{ fontSize:13, color:'#15803d', fontWeight:600 }}>
                  ✓ Checks complete — {uniqueRows.length - rejectCount} OK, {rejectCount} with issues
                </span>
                <div style={{ flex:1 }}/>
                <button onClick={handleDownloadView} style={btn('#16a34a','#fff')}>
                  <Download size={14}/> Unique-QC View
                </button>
                <button onClick={handleDownloadPass} style={btn('#0369a1','#fff')}>
                  <Download size={14}/> QC Pass File
                </button>
              </div>
            )}

            {/* Table */}
            <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, overflow:'auto', maxHeight:'62vh' }}>
              <table style={{ borderCollapse:'collapse', fontSize:12, width:'100%', minWidth:1300 }}>
                <thead>
                  <tr>
                    {QC_COLUMNS.map(c => (
                      <th key={c} style={{ position:'sticky', top:0, background:'#f8fafc', borderBottom:'1.5px solid #e2e8f0', padding:'9px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:'#475569', whiteSpace:'nowrap', zIndex:1 }}>
                        {SHORT_COLS[c] || c}
                      </th>
                    ))}
                    <th style={{ position:'sticky', top:0, background:'#f8fafc', borderBottom:'1.5px solid #e2e8f0', padding:'9px 10px', textAlign:'left', fontSize:11, fontWeight:700, color:'#475569', zIndex:1 }}>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((r, i) => {
                    const pid = r['ProductId']
                    const pIssues = productIssues(pid)
                    const flagged = (manualFlags[pid] || []).length > 0
                    return (
                      <tr key={i} style={{ borderBottom:'1px solid #f1f5f9', background: checksRun && pIssues.length ? '#fef2f2' : '#fff' }}>
                        {QC_COLUMNS.map(c => {
                          if (c === 'Product Image1') {
                            return (
                              <td key={c} style={{ padding:'6px 10px' }}>
                                {r[c] ? (
                                  <div style={{ position:'relative', display:'inline-block' }}>
                                    <img src={r[c]} alt="" loading="lazy"
                                      onClick={() => setImgView({ pid, url:r[c], name:r['Name (English)'] })}
                                      style={{ width:42, height:42, objectFit:'cover', borderRadius:6, cursor:'pointer', border: flagged ? '2px solid #dc2626' : '1px solid #e2e8f0' }}
                                      onError={e => { e.target.style.opacity=0.25 }}
                                    />
                                    {flagged && <Flag size={11} color='#dc2626' style={{ position:'absolute', top:-4, right:-4, background:'#fff', borderRadius:3 }}/>}
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
                                  <button onClick={() => setPreview({ title:`${SHORT_COLS[c]} — ${r['Name (English)'].slice(0,60)}`, html:r[c] })}
                                    style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 8px', fontSize:11, background:'#eef2ff', color:'#4f46e5', border:'1px solid #c7d2fe', borderRadius:6, cursor:'pointer', fontWeight:600 }}>
                                    <Eye size={11}/> View
                                  </button>
                                ) : <span style={{ color:'#dc2626', fontSize:11 }}>empty</span>}
                              </td>
                            )
                          }
                          const wide = c === 'Name (English)' || c === 'CategoryPath'
                          return (
                            <td key={c} style={{ padding:'6px 10px', maxWidth: wide ? 260 : 110, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'#334155' }} title={r[c]}>
                              {r[c]}
                            </td>
                          )
                        })}
                        <td style={{ padding:'6px 10px', minWidth:180, maxWidth:340 }}>
                          {checksRun || (manualFlags[pid]||[]).length
                            ? pIssues.length
                              ? <span style={{ color:'#dc2626', fontSize:11 }}>{pIssues.join('; ')}</span>
                              : <span style={{ color:'#16a34a', fontSize:11, fontWeight:600 }}>OK</span>
                            : <span style={{ color:'#cbd5e1', fontSize:11 }}>—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* HTML preview modal */}
      {preview && (
        <div onClick={() => setPreview(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:12, width:'min(720px, 92vw)', maxHeight:'82vh', display:'flex', flexDirection:'column' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid #e2e8f0' }}>
              <span style={{ fontSize:13, fontWeight:700, color:'#1a202c' }}>{preview.title}</span>
              <button onClick={() => setPreview(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8' }}><X size={18}/></button>
            </div>
            <div style={{ padding:'16px 20px', overflow:'auto', fontSize:13, lineHeight:1.6, color:'#334155' }}
              dangerouslySetInnerHTML={{ __html: preview.html }}/>
          </div>
        </div>
      )}

      {/* Image viewer modal */}
      {imgView && (
        <div onClick={() => setImgView(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:12, padding:18, maxWidth:'min(560px, 92vw)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
              <span style={{ fontSize:12, fontWeight:600, color:'#1a202c', display:'flex', alignItems:'center', gap:6 }}>
                <ImageIcon size={14}/>{imgView.name?.slice(0, 55)}
              </span>
              <button onClick={() => setImgView(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8' }}><X size={18}/></button>
            </div>
            <img src={imgView.url} alt="" style={{ maxWidth:'100%', maxHeight:'58vh', borderRadius:8, display:'block', margin:'0 auto' }}/>
            <div style={{ display:'flex', gap:10, marginTop:14, justifyContent:'center' }}>
              <button onClick={() => { toggleManualFlag(imgView.pid); setImgView(null) }}
                style={{
                  display:'flex', alignItems:'center', gap:7, padding:'9px 18px', borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer',
                  background: (manualFlags[imgView.pid]||[]).length ? '#dcfce7' : '#fef2f2',
                  color: (manualFlags[imgView.pid]||[]).length ? '#15803d' : '#dc2626',
                  border: `1.5px solid ${(manualFlags[imgView.pid]||[]).length ? '#bbf7d0' : '#fecaca'}`,
                }}>
                <Flag size={14}/>
                {(manualFlags[imgView.pid]||[]).length ? 'Remove flag (image OK)' : 'Flag: poor quality / blur'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
