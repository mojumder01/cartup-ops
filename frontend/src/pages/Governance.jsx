import { useState } from 'react'
import { getApiKey } from '../utils/gemini'
import { processGovernanceFile } from '../utils/governanceProcessor'
import {
  Shield, FileSpreadsheet, CheckCircle, AlertCircle, Loader,
  Upload, Type, Weight, AlignLeft, AlignJustify, Tag, ToggleLeft, ToggleRight,
} from 'lucide-react'

const CHECK_DEFS = [
  {
    key: 'name',
    label: 'Name',
    desc: 'Remove duplicate words, translate to English, fix typos',
    note: 'Source: Name only',
    color: '#4f46e5',
    bg: '#eef2ff',
    icon: Type,
  },
  {
    key: 'weight',
    label: 'Weight',
    desc: 'Estimate shipping weight (kg) with AI confidence score',
    note: 'Source: Name only',
    color: '#0369a1',
    bg: '#e0f2fe',
    icon: Weight,
  },
  {
    key: 'highlights',
    label: 'Highlights',
    desc: 'Fix/recreate as <ul><li> HTML — preserves all specs',
    note: 'Source: Name + Description',
    color: '#15803d',
    bg: '#dcfce7',
    icon: AlignLeft,
  },
  {
    key: 'description',
    label: 'Description',
    desc: 'Fix/recreate as <p> HTML — preserves all specs',
    note: 'Source: Name + Highlights',
    color: '#b45309',
    bg: '#fef3c7',
    icon: AlignJustify,
  },
  {
    key: 'category',
    label: 'Category',
    desc: 'Match to CartUp category using AI',
    note: 'Source: Name',
    color: '#7c3aed',
    bg: '#ede9fe',
    icon: Tag,
  },
]

function FileInput({ onChange }) {
  const [fileName, setFileName] = useState('')
  return (
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
        ? <><CheckCircle size={16} color='#16a34a' /><span style={{ fontSize:13, color:'#16a34a', fontWeight:500 }}>{fileName}</span></>
        : <><FileSpreadsheet size={16} color='#94a3b8' /><span style={{ fontSize:13, color:'#94a3b8' }}>Choose .xlsx file...</span></>
      }
    </label>
  )
}

function Toggle({ enabled, onToggle, color }) {
  return (
    <button onClick={onToggle} style={{ background:'none', border:'none', cursor:'pointer', padding:0, display:'flex', color: enabled ? color : '#cbd5e1' }}>
      {enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
    </button>
  )
}

export default function Governance() {
  const apiKey = getApiKey()
  const [file, setFile]         = useState(null)
  const [checks, setChecks]     = useState({ name: true, weight: true, highlights: true, description: true, category: true })
  const [status, setStatus]     = useState('')
  const [progress, setProgress] = useState('')
  const [error, setError]       = useState('')

  const toggleCheck = key => setChecks(c => ({ ...c, [key]: !c[key] }))
  const anyChecked  = Object.values(checks).some(Boolean)

  const handleProcess = async () => {
    if (!file) { setError('Please select a file'); return }
    if (!anyChecked) { setError('Please enable at least one check'); return }
    setError(''); setStatus('processing'); setProgress('Starting...')
    try {
      const outputArray = await processGovernanceFile(file, checks, apiKey, msg => setProgress(msg))
      const blob = new Blob([outputArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'cartup_governance_output.xlsx'; a.click()
      URL.revokeObjectURL(url)
      setStatus('success'); setProgress('')
    } catch(e) {
      setStatus('error'); setError(e.message); setProgress('')
    }
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
            <p style={{ fontSize:12, color:'#718096', margin:0 }}>Check and fix product data quality</p>
          </div>
        </div>
      </div>

      <div style={{ padding:'28px 32px', maxWidth:640 }}>

        {/* File upload */}
        <div style={card}>
          <div style={{ fontSize:12, fontWeight:600, color:'#718096', textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:8 }}>
            Input File <span style={{ color:'#dc2626' }}>*</span>
          </div>
          <div style={{ fontSize:11, color:'#94a3b8', marginBottom:10 }}>
            Required columns: <code style={{ background:'#f1f5f9', padding:'1px 5px', borderRadius:3 }}>Name</code> and <code style={{ background:'#f1f5f9', padding:'1px 5px', borderRadius:3 }}>SKU ID</code>.
            Optional: Description, Highlights
          </div>
          <FileInput onChange={setFile} />
        </div>

        {/* Check toggles */}
        <div style={card}>
          <div style={{ fontSize:12, fontWeight:600, color:'#718096', textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:14 }}>
            Checks to Run
          </div>
          <div style={{ display:'grid', gap:10 }}>
            {CHECK_DEFS.map(({ key, label, desc, note, color, bg, icon: Icon }) => (
              <div key={key} style={{
                display:'flex', alignItems:'center', gap:14,
                padding:'12px 14px', borderRadius:10,
                background: checks[key] ? bg : '#f8fafc',
                border: `1.5px solid ${checks[key] ? color + '33' : '#e2e8f0'}`,
                transition:'all 0.15s',
              }}>
                <div style={{
                  width:34, height:34, borderRadius:8,
                  background: checks[key] ? color + '18' : '#f1f5f9',
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                }}>
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

        {/* Status messages */}
        {error && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, marginBottom:12 }}>
            <AlertCircle size={15} color='#dc2626' />
            <span style={{ fontSize:13, color:'#dc2626' }}>{error}</span>
          </div>
        )}
        {progress && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, marginBottom:12 }}>
            <Loader size={14} color='#3b82f6' style={{ animation:'spin 1s linear infinite' }} />
            <span style={{ fontSize:13, color:'#1d4ed8' }}>{progress}</span>
          </div>
        )}
        {status === 'success' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, marginBottom:12 }}>
            <CheckCircle size={15} color='#16a34a' />
            <span style={{ fontSize:13, color:'#15803d', fontWeight:500 }}>Done — file downloaded!</span>
          </div>
        )}

        <button
          onClick={handleProcess}
          disabled={status === 'processing' || !anyChecked}
          style={{
            display:'flex', alignItems:'center', gap:8,
            padding:'11px 24px',
            background: status === 'processing' || !anyChecked ? '#a5b4fc' : '#4f46e5',
            color:'#fff', border:'none', borderRadius:8,
            fontWeight:600, fontSize:14,
            cursor: status === 'processing' || !anyChecked ? 'not-allowed' : 'pointer',
          }}
        >
          {status === 'processing'
            ? <><Loader size={15} style={{ animation:'spin 1s linear infinite' }} /> Processing...</>
            : <><Upload size={15} /> Run Governance Checks</>}
        </button>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
