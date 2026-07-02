import { useState, useRef } from 'react'
import { getApiKey } from '../utils/gemini'
import { processGovernanceFile, loadCheckpoint, clearCheckpoint } from '../utils/governanceProcessor'
import {
  Shield, FileSpreadsheet, CheckCircle, AlertCircle, Loader,
  Upload, Type, Weight, AlignLeft, AlignJustify, Tag,
  ToggleLeft, ToggleRight, Pause, Play, RotateCcw, RefreshCw,
  CheckSquare, Square,
} from 'lucide-react'

const CHECK_DEFS = [
  { key:'name',        label:'Name',        desc:'Remove duplicates, translate to English, fix typos',            note:'Source: Name',               color:'#4f46e5', bg:'#eef2ff',  icon:Type         },
  { key:'weight',      label:'Weight',      desc:'Estimate shipping weight (kg) with confidence score',           note:'Source: Name',               color:'#0369a1', bg:'#e0f2fe',  icon:Weight       },
  { key:'highlights',  label:'Highlights',  desc:'Fix/recreate <ul><li> — all specs preserved, no add/remove',   note:'Source: cleaned Name + Desc', color:'#15803d', bg:'#dcfce7',  icon:AlignLeft    },
  { key:'description', label:'Description', desc:'Fix/recreate <p> — all specs preserved, no add/remove',        note:'Source: cleaned Name + HL',   color:'#b45309', bg:'#fef3c7',  icon:AlignJustify },
  { key:'category',    label:'Category',    desc:'Match to CartUp category (same mapping as Production)',         note:'Source: Name',               color:'#7c3aed', bg:'#ede9fe',  icon:Tag          },
]

const CHECK_COLORS = {
  name:'#4f46e5', weight:'#0369a1', category:'#7c3aed',
  highlights:'#15803d', description:'#b45309',
}
const PASS_ORDER = ['name','weight','category','highlights','description']

function FileInputBox({ onChange, checkpoint }) {
  const [fileName, setFileName] = useState('')
  return (
    <div>
      <label style={{
        display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
        border:`1.5px dashed ${fileName ? '#16a34a' : '#e2e8f0'}`,
        borderRadius:8, cursor:'pointer', background: fileName ? '#dcfce7' : '#fafafa',
      }}>
        <input type="file" accept=".xlsx" style={{ display:'none' }}
          onChange={e => { const f = e.target.files[0]; if(f){ setFileName(f.name); onChange(f) } }}
        />
        {fileName
          ? <><CheckCircle size={16} color='#16a34a'/><span style={{ fontSize:13, color:'#16a34a', fontWeight:500 }}>{fileName}</span></>
          : <><FileSpreadsheet size={16} color='#94a3b8'/><span style={{ fontSize:13, color:'#94a3b8' }}>Choose .xlsx file...</span></>
        }
      </label>
      {checkpoint && fileName && (
        <div style={{ marginTop:8, padding:'8px 12px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:7, fontSize:12, color:'#92400e', display:'flex', alignItems:'center', gap:8 }}>
          <RotateCcw size={13}/>
          Checkpoint found — Pass {checkpoint.passCompleted} of {['name','weight','category'].some(k => checkpoint.checks?.[k]) ? 1 : 0} completed, <strong>{checkpoint.total}</strong> products total. Resume will continue from here.
        </div>
      )}
    </div>
  )
}

function Toggle({ enabled, onToggle, color }) {
  return (
    <button onClick={onToggle} style={{ background:'none', border:'none', cursor:'pointer', padding:0, display:'flex', color: enabled ? color : '#cbd5e1' }}>
      {enabled ? <ToggleRight size={28}/> : <ToggleLeft size={28}/>}
    </button>
  )
}

function PassProgress({ info, checks }) {
  if (!info || !info.total) return null
  const pct = Math.round((info.done / info.total) * 100)
  const enabledPasses = PASS_ORDER.filter(k => checks?.[k])
  const currentKey = enabledPasses[info.pass - 1]
  const passColor = CHECK_COLORS[currentKey] || '#4f46e5'

  return (
    <div>
      {/* Pass pills */}
      {info.totalPasses > 0 && (
        <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap' }}>
          {enabledPasses.map((key, i) => {
            const done = i + 1 < info.pass
            const active = i + 1 === info.pass
            const col = CHECK_COLORS[key]
            return (
              <div key={key} style={{
                padding:'3px 10px', borderRadius:999, fontSize:11, fontWeight:600,
                background: done ? '#dcfce7' : active ? col : '#f1f5f9',
                color: done ? '#15803d' : active ? '#fff' : '#94a3b8',
              }}>
                {done ? `✓ ${key.charAt(0).toUpperCase()+key.slice(1)}` : `${active ? '▶ ' : ''}${key.charAt(0).toUpperCase()+key.slice(1)}`}
              </div>
            )
          })}
        </div>
      )}
      {/* Bar */}
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#64748b', marginBottom:4 }}>
        <span>{info.label} — {info.done} / {info.total} products</span>
        <span>{pct}%</span>
      </div>
      <div style={{ background:'#e2e8f0', borderRadius:999, height:8 }}>
        <div style={{ width:`${pct}%`, background: passColor, borderRadius:999, height:8, transition:'width 0.3s' }}/>
      </div>
    </div>
  )
}

export default function Governance() {
  const apiKey = getApiKey()
  const [file, setFile]           = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [checkpoint, setCheckpoint] = useState(null)
  const [checks, setChecks]       = useState({ name:true, weight:true, highlights:true, description:true, category:true })
  const [status, setStatus]       = useState('')
  const [passInfo, setPassInfo]   = useState(null)
  const [error, setError]         = useState('')
  const signalRef                 = useRef({ paused:false })

  const toggleCheck = key => setChecks(c => ({ ...c, [key]: !c[key] }))
  const anyChecked  = Object.values(checks).some(Boolean)

  const handleFileChange = f => {
    setFile(f); setStatus(''); setError(''); setPassInfo(null)
    const cp = loadCheckpoint(f)
    setCheckpoint(cp)
    if (cp?.checks) setChecks(cp.checks)
  }

  const handleRun = async () => {
    if (!file) { setError('Please select a file'); return }
    if (!anyChecked) { setError('Please enable at least one check'); return }
    setError(''); setStatus('processing')
    signalRef.current = { paused: false }

    try {
      const result = await processGovernanceFile(
        file, checks, apiKey,
        info => setPassInfo(info),
        signalRef.current,
      )

      if (result.paused) {
        setStatus('paused')
        setCheckpoint(loadCheckpoint(file))
        return
      }

      const blob = new Blob([result.output], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'cartup_governance_output.xlsx'; a.click()
      URL.revokeObjectURL(url)
      setStatus('success'); setCheckpoint(null)

    } catch(e) {
      setStatus('error'); setError(e.message)
    }
  }

  const handlePause = () => {
    signalRef.current.paused = true
    setPassInfo(p => p ? { ...p, label: 'Pausing after this batch...' } : p)
  }

  const handleClearCheckpoint = () => {
    clearCheckpoint(); setCheckpoint(null); setStatus(''); setPassInfo(null)
  }

  const handleReset = () => {
    clearCheckpoint()
    setFile(null); setFileInputKey(k => k + 1); setCheckpoint(null)
    setStatus(''); setError(''); setPassInfo(null)
    setChecks({ name:true, weight:true, highlights:true, description:true, category:true })
  }

  const allChecked  = Object.values(checks).every(Boolean)
  const noneChecked = Object.values(checks).every(v => !v)
  const handleSelectAll   = () => setChecks({ name:true, weight:true, highlights:true, description:true, category:true })
  const handleDeselectAll = () => setChecks({ name:false, weight:false, highlights:false, description:false, category:false })

  const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:24, marginBottom:16 }

  return (
    <div>
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'20px 32px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <Shield size={20} color='#4f46e5'/>
          <div>
            <h1 style={{ fontSize:17, fontWeight:700, color:'#1a202c', margin:0 }}>Governance</h1>
            <p style={{ fontSize:12, color:'#718096', margin:0 }}>Sequential passes — Name first, then Highlights, then Description</p>
          </div>
        </div>
      </div>

      <div style={{ padding:'28px 32px', maxWidth:640 }}>

        {/* File upload */}
        <div style={card}>
          <div style={{ fontSize:12, fontWeight:600, color:'#718096', textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:6 }}>
            Input File <span style={{ color:'#dc2626' }}>*</span>
          </div>
          <div style={{ fontSize:11, color:'#94a3b8', marginBottom:10 }}>
            Required: <code style={{ background:'#f1f5f9', padding:'1px 5px', borderRadius:3 }}>Name</code> and <code style={{ background:'#f1f5f9', padding:'1px 5px', borderRadius:3 }}>SKU ID</code>.
            Optional: Description, Highlights
          </div>
          <FileInputBox key={fileInputKey} onChange={handleFileChange} checkpoint={checkpoint}/>
          {checkpoint && (
            <button onClick={handleClearCheckpoint} style={{ marginTop:6, background:'none', border:'none', fontSize:11, color:'#94a3b8', cursor:'pointer', padding:0, textDecoration:'underline' }}>
              Clear checkpoint &amp; start fresh
            </button>
          )}
        </div>

        {/* Pipeline info */}
        <div style={{ ...card, padding:16, background:'#f8fafc' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#64748b', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.4px' }}>Processing Order</div>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', fontSize:12 }}>
            {PASS_ORDER.filter(k => checks[k]).map((key, i, arr) => {
              const bg = { name:'#eef2ff', weight:'#e0f2fe', category:'#ede9fe', highlights:'#dcfce7', description:'#fef3c7' }[key]
              const color = CHECK_COLORS[key]
              const label = { name:'Name', weight:'Weight', category:'Category', highlights:'Highlights', description:'Description' }[key]
              return (
                <span key={key} style={{ display:'flex', alignItems:'center', gap:6 }}>
                  {i > 0 && <span style={{ color:'#94a3b8' }}>→</span>}
                  <span style={{ background: bg, color, padding:'3px 10px', borderRadius:999, fontWeight:600 }}>
                    Pass {i+1}: {label}
                  </span>
                </span>
              )
            })}
            {!anyChecked && <span style={{ color:'#94a3b8' }}>No checks enabled</span>}
            {anyChecked && <><span style={{ color:'#94a3b8' }}>→</span><span style={{ color:'#64748b', fontWeight:600 }}>Output</span></>}
          </div>
        </div>

        {/* Check toggles */}
        <div style={card}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'#718096', textTransform:'uppercase', letterSpacing:'0.4px' }}>Checks</div>
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={handleSelectAll} disabled={allChecked}
                style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 10px', fontSize:11, fontWeight:600,
                  background: allChecked ? '#f1f5f9' : '#eef2ff', color: allChecked ? '#cbd5e1' : '#4f46e5',
                  border:`1px solid ${allChecked ? '#e2e8f0' : '#c7d2fe'}`, borderRadius:6, cursor: allChecked ? 'default' : 'pointer' }}>
                <CheckSquare size={12}/> All
              </button>
              <button onClick={handleDeselectAll} disabled={noneChecked}
                style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 10px', fontSize:11, fontWeight:600,
                  background: noneChecked ? '#f1f5f9' : '#f8fafc', color: noneChecked ? '#cbd5e1' : '#64748b',
                  border:`1px solid ${noneChecked ? '#e2e8f0' : '#cbd5e1'}`, borderRadius:6, cursor: noneChecked ? 'default' : 'pointer' }}>
                <Square size={12}/> None
              </button>
            </div>
          </div>
          <div style={{ display:'grid', gap:10 }}>
            {CHECK_DEFS.map(({ key, label, desc, note, color, bg, icon: Icon }) => (
              <div key={key} style={{
                display:'flex', alignItems:'center', gap:14, padding:'12px 14px', borderRadius:10,
                background: checks[key] ? bg : '#f8fafc',
                border:`1.5px solid ${checks[key] ? color+'33' : '#e2e8f0'}`,
                transition:'all 0.15s',
              }}>
                <div style={{ width:34, height:34, borderRadius:8, background: checks[key] ? color+'18' : '#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <Icon size={16} color={checks[key] ? color : '#94a3b8'}/>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600, color: checks[key] ? '#1a202c' : '#94a3b8' }}>{label}</div>
                  <div style={{ fontSize:11, color: checks[key] ? '#64748b' : '#cbd5e1', marginTop:1 }}>{desc}</div>
                  <div style={{ fontSize:10, color: checks[key] ? color : '#cbd5e1', marginTop:2, fontStyle:'italic' }}>{note} · AI</div>
                </div>
                <Toggle enabled={checks[key]} onToggle={() => toggleCheck(key)} color={color}/>
              </div>
            ))}
          </div>
          {!apiKey && (
            <div style={{ marginTop:12, padding:'8px 12px', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:8, fontSize:12, color:'#92400e' }}>
              No API key — AI checks skipped. Add key in Profile &amp; Settings.
            </div>
          )}
        </div>

        {/* Progress */}
        {(status === 'processing' || status === 'paused') && passInfo?.total > 0 && (
          <div style={{ ...card, padding:16 }}>
            <PassProgress info={passInfo} checks={checks}/>
          </div>
        )}

        {/* Status */}
        {error && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, marginBottom:12 }}>
            <AlertCircle size={15} color='#dc2626'/><span style={{ fontSize:13, color:'#dc2626' }}>{error}</span>
          </div>
        )}
        {status === 'paused' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, marginBottom:12 }}>
            <Pause size={15} color='#d97706'/>
            <span style={{ fontSize:13, color:'#92400e' }}>Paused — progress saved. Re-upload same file and click Resume.</span>
          </div>
        )}
        {status === 'success' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, marginBottom:12 }}>
            <CheckCircle size={15} color='#16a34a'/><span style={{ fontSize:13, color:'#15803d', fontWeight:500 }}>All passes complete — output downloaded!</span>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          {status !== 'processing' && (
            <button onClick={handleRun} disabled={!anyChecked || !file}
              style={{
                display:'flex', alignItems:'center', gap:8, padding:'11px 24px',
                background: !anyChecked || !file ? '#a5b4fc' : '#4f46e5',
                color:'#fff', border:'none', borderRadius:8, fontWeight:600, fontSize:14,
                cursor: !anyChecked || !file ? 'not-allowed' : 'pointer',
              }}>
              {checkpoint
                ? (() => {
                    const enabled = PASS_ORDER.filter(k => checks[k])
                    const nextKey = enabled[checkpoint.passCompleted]
                    const label = { name:'Name', weight:'Weight', category:'Category', highlights:'Highlights', description:'Description' }[nextKey] || `Pass ${checkpoint.passCompleted + 1}`
                    return <><Play size={15}/> Resume — {label}</>
                  })()
                : <><Upload size={15}/> Run Governance Checks</>}
            </button>
          )}
          {status === 'processing' && (
            <>
              <button onClick={handlePause}
                style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 20px', background:'#fff', color:'#d97706', border:'1.5px solid #fde68a', borderRadius:8, fontWeight:600, fontSize:14, cursor:'pointer' }}>
                <Pause size={15}/> Pause
              </button>
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 16px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8 }}>
                <Loader size={14} color='#3b82f6' style={{ animation:'spin 1s linear infinite' }}/>
                <span style={{ fontSize:13, color:'#1d4ed8' }}>Processing...</span>
              </div>
            </>
          )}
          {status !== 'processing' && (
            <button onClick={handleReset} title="Reset everything"
              style={{ display:'flex', alignItems:'center', gap:6, padding:'11px 14px', background:'#fff', color:'#94a3b8', border:'1.5px solid #e2e8f0', borderRadius:8, fontWeight:600, fontSize:13, cursor:'pointer' }}>
              <RefreshCw size={14}/> Reset
            </button>
          )}
        </div>

        <div style={{ marginTop:10, fontSize:11, color:'#94a3b8' }}>
          Saves after every 10 products. Output downloads only when all passes complete.
        </div>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
