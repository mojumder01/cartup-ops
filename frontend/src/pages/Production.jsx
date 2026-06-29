import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { uploadDarazFiles, uploadManualFile } from '../utils/api'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader, Download } from 'lucide-react'

function FileInput({ label, required, onChange, accept = '.xlsx' }) {
  const [fileName, setFileName] = useState('')
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:'block', fontSize:12, fontWeight:600, color:'var(--text-muted)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.4px' }}>
        {label} {required && <span style={{ color:'var(--danger)' }}>*</span>}
      </label>
      <label style={{
        display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
        border:'1.5px dashed var(--border)', borderRadius:8, cursor:'pointer',
        background: fileName ? 'var(--success-light)' : '#fafafa',
        transition:'border 0.15s',
      }}>
        <input type="file" accept={accept} style={{ display:'none' }}
          onChange={e => { const f = e.target.files[0]; if(f){ setFileName(f.name); onChange(f) } }}
        />
        {fileName
          ? <><CheckCircle size={16} color='var(--success)' /><span style={{ fontSize:13, color:'var(--success)', fontWeight:500 }}>{fileName}</span></>
          : <><FileSpreadsheet size={16} color='#94a3b8' /><span style={{ fontSize:13, color:'#94a3b8' }}>Choose file...</span></>
        }
      </label>
    </div>
  )
}

function StatusBadge({ status, message }) {
  const styles = {
    processing: { bg:'#eff6ff', color:'#2563eb', icon: <Loader size={14} style={{ animation:'spin 1s linear infinite' }} /> },
    success:    { bg:'var(--success-light)', color:'var(--success)', icon: <CheckCircle size={14} /> },
    error:      { bg:'var(--danger-light)', color:'var(--danger)', icon: <AlertCircle size={14} /> },
  }
  const s = styles[status]
  if (!s) return null
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:s.bg, borderRadius:8, color:s.color, fontSize:13, fontWeight:500, marginTop:16 }}>
      {s.icon} {message}
    </div>
  )
}

export default function Production() {
  const { token } = useAuth()

  // Daraz upload state
  const [darazFiles, setDarazFiles] = useState({ price:null, basic:null, weight:null, skuimg:null, attr:null })
  const [darazStatus, setDarazStatus] = useState(null)
  const [darazMsg, setDarazMsg] = useState('')

  // Manual upload state
  const [manualFile, setManualFile] = useState(null)
  const [manualStatus, setManualStatus] = useState(null)
  const [manualMsg, setManualMsg] = useState('')

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  const handleDarazUpload = async () => {
    if (!darazFiles.price || !darazFiles.basic || !darazFiles.weight || !darazFiles.skuimg) {
      setDarazStatus('error'); setDarazMsg('Please select all required files')
      return
    }
    setDarazStatus('processing'); setDarazMsg('Processing files... this may take a minute')
    try {
      const blob = await uploadDarazFiles(darazFiles, token)
      setDarazStatus('success'); setDarazMsg('Done! Downloading output file...')
      downloadBlob(blob, 'cartup_output.xlsx')
    } catch(e) {
      setDarazStatus('error'); setDarazMsg(e.message)
    }
  }

  const handleManualUpload = async () => {
    if (!manualFile) { setManualStatus('error'); setManualMsg('Please select a file'); return }
    setManualStatus('processing'); setManualMsg('Processing...')
    try {
      const blob = await uploadManualFile(manualFile, token)
      setManualStatus('success'); setManualMsg('Done! Downloading output file...')
      downloadBlob(blob, 'cartup_manual_output.xlsx')
    } catch(e) {
      setManualStatus('error'); setManualMsg(e.message)
    }
  }

  const card = {
    background:'var(--surface)', border:'1px solid var(--border)',
    borderRadius:12, padding:28, marginBottom:20,
  }

  const btn = (disabled) => ({
    display:'flex', alignItems:'center', gap:8, padding:'11px 22px',
    background: disabled ? '#a5b4fc' : '#4f46e5',
    color:'#fff', border:'none', borderRadius:8,
    fontWeight:600, fontSize:14, marginTop:20, cursor: disabled ? 'not-allowed' : 'pointer',
  })

  return (
    <div style={{ padding:'32px 36px', maxWidth:780 }}>
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:20, fontWeight:700 }}>Production — Upload</h1>
        <p style={{ color:'var(--text-muted)', marginTop:4 }}>Process Daraz export files or manual Excel uploads into CartUp template format.</p>
      </div>

      {/* Daraz Upload */}
      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:'#eef2ff', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Upload size={18} color='#4f46e5' />
          </div>
          <div>
            <div style={{ fontWeight:600, fontSize:15 }}>Daraz Upload</div>
            <div style={{ color:'var(--text-muted)', fontSize:12 }}>Upload 4–5 Daraz export files</div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 20px' }}>
          <FileInput label="Price / Stock file" required onChange={f => setDarazFiles(p => ({...p, price:f}))} />
          <FileInput label="Basic file" required onChange={f => setDarazFiles(p => ({...p, basic:f}))} />
          <FileInput label="Weight file" required onChange={f => setDarazFiles(p => ({...p, weight:f}))} />
          <FileInput label="SKU Image file" required onChange={f => setDarazFiles(p => ({...p, skuimg:f}))} />
          <FileInput label="Attribute file (optional)" onChange={f => setDarazFiles(p => ({...p, attr:f}))} />
        </div>

        <StatusBadge status={darazStatus} message={darazMsg} />

        <button onClick={handleDarazUpload} disabled={darazStatus === 'processing'} style={btn(darazStatus === 'processing')}>
          {darazStatus === 'processing'
            ? <><Loader size={15} style={{ animation:'spin 1s linear infinite' }} /> Processing...</>
            : <><Download size={15} /> Process & Download</>
          }
        </button>
      </div>

      {/* Manual Upload */}
      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:'#fef3c7', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <FileSpreadsheet size={18} color='#d97706' />
          </div>
          <div>
            <div style={{ fontWeight:600, fontSize:15 }}>Manual Upload</div>
            <div style={{ color:'var(--text-muted)', fontSize:12 }}>Upload Excel with missing data for AI processing</div>
          </div>
        </div>

        <FileInput label="Input Excel file" required onChange={f => setManualFile(f)} />
        <StatusBadge status={manualStatus} message={manualMsg} />

        <button onClick={handleManualUpload} disabled={manualStatus === 'processing'} style={btn(manualStatus === 'processing')}>
          {manualStatus === 'processing'
            ? <><Loader size={15} style={{ animation:'spin 1s linear infinite' }} /> Processing...</>
            : <><Download size={15} /> Process & Download</>
          }
        </button>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
