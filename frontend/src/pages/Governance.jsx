import { useState, useRef, useEffect } from 'react'
import { getApiKey } from '../utils/gemini'
import { processGovernanceFile, loadCheckpoint, clearCheckpoint } from '../utils/governanceProcessor'
import {
  Shield, FileSpreadsheet, CheckCircle, AlertCircle, Loader,
  Upload, Type, Weight, AlignLeft, AlignJustify, Tag,
  ToggleLeft, ToggleRight, Pause, Play, RotateCcw,
} from 'lucide-react'

const CHECK_DEFS = [
  { key:'name',        label:'Name',        desc:'Remove duplicates, translate to English, fix typos',                   note:'Source: Name',               color:'#4f46e5', bg:'#eef2ff',  icon:Type        },
  { key:'weight',      label:'Weight',      desc:'Estimate shipping weight (kg) with AI confidence score',               note:'Source: Name',               color:'#0369a1', bg:'#e0f2fe',  icon:Weight      },
  { key:'highlights',  label:'Highlights',  desc:'Fix/recreate <ul><li> — preserves ALL specs, no add/remove',          note:'Source: Name + Description', color:'#15803d', bg:'#dcfce7',  icon:AlignLeft   },
  { key:'description', label:'Description', desc:'Fix/recreate <p> — preserves ALL specs, no add/remove',               note:'Source: Name + Highlights',  color:'#b45309', bg:'#fef3c7',  icon:AlignJustify},
  { key:'category',    label:'Category',    desc:'Match to CartUp category using AI (same mapping as Production)',       note:'Source: Name',               color:'#7c3aed', bg:'#ede9fe',  icon:Tag         },
]

function FileInputBox({ onChange, checkpoint }) {
  const [fileName, setFileName] = useState('')
  return (
    <div>
      <label style={{
        display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
        border:`1.5px dashed ${fileName ? '#16a34a' : '#e2e8f0'}`,
        borderRadius:8, cursor:'pointer',
        background: fileName ? '#dcfce7' : '#fafafa',
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
          <RotateCcw size={13} />
          Checkpoint found: <strong>{checkpoint.done}/{checkpoint.total}</strong> products already processed.
          Re-run will resume from where it stopped.
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

function ProgressBar({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#64748b', marginBottom:4 }}>
        <span>{done} / {total} products</span>
        <span>{pct}%</span>
      </div>
      <div style={{ background:'#e2e8f0', borderRadius:999, height:8 }}>
        <div style={{ width:`${pct}%`, background:'#4f46e5', borderRadius:999, height:8, transition:'width 0.3s' }} />
      </div>
    </div>
  )
}

export default function Governance() {
  const apiKey = getApiKey()
  const [file, setFile]             = useState(null)
  const [checkpoint, setCheckpoint] = useState(null)
  const [checks, setChecks]         = useState({ name:true, weight:true, highlights:true, description:true, category:true })
  const [status, setStatus]         = useState('')   // '' | 'processing' | 'paused' | 'success' | 'error'
  const [progress, setProgress]     = useState('')
  const [progCount, setProgCount]   = useState({ done:0, total:0 })
  const [error, setError]           = useState('')
  const signalRef                   = useRef({ paused: false })

  const toggleCheck = key => setChecks(c => ({ ...c, [key]: !c[key] }))
  const anyChecked  = Object.values(checks).some(Boolean)

  const handleFileChange = f => {
    setFile(f)
    setStatus('')
    setError('')
    setProgress('')
    setProgCount({ done:0, total:0 })
    const cp = loadCheckpoint(f)
    setCheckpoint(cp)
    if (cp) setChecks(cp.checks)   // restore toggle state from checkpoint
  }

  const handleRun = async () => {
    if (!file) { setError('Please select a file'); return }
    if (!anyChecked) { setError('Please enable at least one check'); return }
    setError(''); setStatus('processing')
    signalRef.current = { paused: false }

    try {
      const result = await processGovernanceFile(
        file, checks, apiKey,
        msg => {
          setProgress(msg)
          // Parse "Processing X–Y of Z" to update progress bar
          const m = msg.match(/Processing (\d+)[–-](\d+) of (\d+)/)
          if (m) setProgCount({ done: parseInt(m[2]), total: parseInt(m[3]) })
        },
        signalRef.current,
      )

      if (result.paused) {
        setStatus('paused')
        setProgCount({ done: result.done, total: result.total })
        setProgress('')
        setCheckpoint(loadCheckpoint(file))
        return
      }

      // Download output
      const blob = new Blob([result.output], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'cartup_governance_output.xlsx'; a.click()
      URL.revokeObjectURL(url)
      setStatus('success'); setProgress(''); setCheckpoint(null)

    } catch(e) {
      setStatus('error'); setError(e.message); setProgress('')
    }
  }

  const handlePause = () => {
    signalRef.current.paused = true
    setProgress('Pausing after current batch...')
  }

  const handleClearCheckpoint = () => {
    clearCheckpoint()
    setCheckpoint(null)
    setStatus('')
    setProgCount({ done:0, total:0 })
  }

  const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:24, marginBottom:16 }

  return (
    <div>
      {/* Header */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'20px 32px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <Shield size={20} color='#4f46e5' />
          <div>
            <h1 style={{ fontSize:17, fontWeight:700, color:'#1a202c', margin:0 }}>Governance</h1>
            <p style={{ fontSize:12, color:'#718096', margin:0 }}>Check and fix product data quality — supports large files with resume</p>
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
            Required columns: <code style={{ background:'#f1f5f9', padding:'1px 5px', borderRadius:3 }}>Name</code> and <code style={{ background:'#f1f5f9', padding:'1px 5px', borderRadius:3 }}>SKU ID</code>.
            Optional: Description, Highlights
          </div>
          <FileInputBox onChange={handleFileChange} checkpoint={checkpoint} />
          {checkpoint && (
            <button onClick={handleClearCheckpoint} style={{ marginTop:8, background:'none', border:'none', fontSize:11, color:'#94a3b8', cursor:'pointer', padding:0, textDecoration:'underline' }}>
              Clear checkpoint &amp; start fresh
            </button>
          )}
        </div>

        {/* Check toggles */}
        <div style={card}>
          <div style={{ fontSize:12, fontWeight:600, color:'#718096', textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:14 }}>
            Checks to Run
          </div>
          <div style={{ display:'grid', gap:10 }}>
            {CHECK_DEFS.map(({ key, label, desc, note, color, bg, icon: Icon }) => (
              <div key={key} style={{
                display:'flex', alignItems:'center', gap:14, padding:'12px 14px', borderRadius:10,
                background: checks[key] ? bg : '#f8fafc',
                border:`1.5px solid ${checks[key] ? color + '33' : '#e2e8f0'}`,
                transition:'all 0.15s',
              }}>
                <div style={{ width:34, height:34, borderRadius:8, background: checks[key] ? color+'18' : '#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <Icon size={16} color={checks[key] ? color : '#94a3b8'} />
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600, color: checks[key] ? '#1a202c' : '#94a3b8' }}>{label}</div>
                  <div style={{ fontSize:11, color: checks[key] ? '#64748b' : '#cbd5e1', marginTop:1 }}>{desc}</div>
                  <div style={{ fontSize:10, color: checks[key] ? color : '#cbd5e1', marginTop:2, fontStyle:'italic' }}>{note} · AI</div>
                </div>
                <Toggle enabled={checks[key]} onToggle={() => toggleCheck(key)} color={color} />
              </div>
            ))}
          </div>
          {!apiKey && (
            <div style={{ marginTop:12, padding:'8px 12px', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:8, fontSize:12, color:'#92400e' }}>
              No API key set — AI checks will be skipped. Add key in Profile &amp; Settings.
            </div>
          )}
        </div>

        {/* Progress bar — visible while processing or paused */}
        {(status === 'processing' || status === 'paused') && progCount.total > 0 && (
          <div style={{ ...card, padding:16 }}>
            <ProgressBar done={progCount.done} total={progCount.total} />
            {progress && <div style={{ fontSize:12, color:'#64748b', marginTop:8 }}>{progress}</div>}
          </div>
        )}

        {/* Status messages */}
        {error && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, marginBottom:12 }}>
            <AlertCircle size={15} color='#dc2626'/><span style={{ fontSize:13, color:'#dc2626' }}>{error}</span>
          </div>
        )}
        {status === 'paused' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, marginBottom:12 }}>
            <Pause size={15} color='#d97706'/>
            <span style={{ fontSize:13, color:'#92400e' }}>Paused — progress saved. Upload the same file and click Resume to continue.</span>
          </div>
        )}
        {status === 'success' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, marginBottom:12 }}>
            <CheckCircle size={15} color='#16a34a'/><span style={{ fontSize:13, color:'#15803d', fontWeight:500 }}>Done — output file downloaded!</span>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display:'flex', gap:10 }}>
          {status !== 'processing' && (
            <button onClick={handleRun} disabled={!anyChecked || !file}
              style={{
                display:'flex', alignItems:'center', gap:8, padding:'11px 24px',
                background: !anyChecked || !file ? '#a5b4fc' : '#4f46e5',
                color:'#fff', border:'none', borderRadius:8, fontWeight:600, fontSize:14,
                cursor: !anyChecked || !file ? 'not-allowed' : 'pointer',
              }}>
              {checkpoint && status !== 'success'
                ? <><Play size={15}/> Resume ({checkpoint.done}/{checkpoint.total} done)</>
                : <><Upload size={15}/> Run Governance Checks</>}
            </button>
          )}
          {status === 'processing' && (
            <button onClick={handlePause}
              style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 20px', background:'#fff', color:'#d97706', border:'1.5px solid #fde68a', borderRadius:8, fontWeight:600, fontSize:14, cursor:'pointer' }}>
              <Pause size={15}/> Pause
            </button>
          )}
          {status === 'processing' && (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 20px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8 }}>
              <Loader size={14} color='#3b82f6' style={{ animation:'spin 1s linear infinite' }}/>
              <span style={{ fontSize:13, color:'#1d4ed8' }}>Processing...</span>
            </div>
          )}
        </div>

        <div style={{ marginTop:12, fontSize:11, color:'#94a3b8' }}>
          Progress is auto-saved after every 10 products. If the browser closes, re-upload the same file to resume.
        </div>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
