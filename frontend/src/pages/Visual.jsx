import { useState } from 'react'
import { processVisualFiles } from '../utils/visualProcessor'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader, Download, Image } from 'lucide-react'

function FileInput({ label, hint, onChange }) {
  const [fileName, setFileName] = useState('')
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#718096', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.4px' }}>
        {label}
      </label>
      {hint && <div style={{ fontSize:11, color:'#94a3b8', marginBottom:6 }}>{hint}</div>}
      <label className="file-drop" style={{
        display:'flex', alignItems:'center', gap:10, padding:'12px 14px',
        border:`1.5px dashed ${fileName ? '#16a34a' : '#cbd5e1'}`,
        borderRadius:10, cursor:'pointer',
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
    </div>
  )
}

export default function Visual() {
  const [files, setFiles]       = useState({})
  const [status, setStatus]     = useState('')
  const [progress, setProgress] = useState('')
  const [error, setError]       = useState('')

  const handleProcess = async () => {
    if (!files.skuimg || !files.basic) {
      setError('Please select both files'); return
    }
    setError(''); setStatus('processing'); setProgress('Starting...')
    try {
      const outputArray = await processVisualFiles(files.skuimg, files.basic, msg => setProgress(msg))
      const blob = new Blob([outputArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'cartup_visual_output.xlsx'; a.click()
      URL.revokeObjectURL(url)
      setStatus('success'); setProgress('')
    } catch(e) {
      setStatus('error'); setError(e.message); setProgress('')
    }
  }

  const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:14, padding:28 }

  return (
    <div>
      {/* Header */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'20px 32px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <Image size={20} color='#4f46e5' />
          <div>
            <h1 style={{ fontSize:17, fontWeight:700, color:'#1a202c', margin:0 }}>Visual Upload</h1>
            <p style={{ fontSize:12, color:'#718096', margin:0 }}>Map SKU images and generate variant image output</p>
          </div>
        </div>
      </div>

      <div style={{ padding:'28px 32px', maxWidth:560 }}>
        <div className="card-modern" style={card}>
          <FileInput
            label="SKU Image File *"
            hint="Columns: Product ID, SellerSKU, Variations Combo, Images1–8"
            onChange={f => setFiles(p => ({ ...p, skuimg: f }))}
          />
          <FileInput
            label="Basic File *"
            hint="Columns: Product ID, *Product Name(English), *Product Images1–8"
            onChange={f => setFiles(p => ({ ...p, basic: f }))}
          />

          {error && (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, marginTop:12 }}>
              <AlertCircle size={15} color='#dc2626' />
              <span style={{ fontSize:13, color:'#dc2626' }}>{error}</span>
            </div>
          )}

          {progress && (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, marginTop:12 }}>
              <Loader size={14} color='#3b82f6' style={{ animation:'spin 1s linear infinite' }} />
              <span style={{ fontSize:13, color:'#1d4ed8' }}>{progress}</span>
            </div>
          )}

          {status === 'success' && (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, marginTop:12 }}>
              <CheckCircle size={15} color='#16a34a' />
              <span style={{ fontSize:13, color:'#15803d', fontWeight:500 }}>Done — file downloaded!</span>
            </div>
          )}

          <div style={{ marginTop:20, display:'flex', gap:10 }}>
            <button
              onClick={handleProcess}
              disabled={status === 'processing'}
              className={status === 'processing' ? '' : 'btn-primary'}
              style={{
                display:'flex', alignItems:'center', gap:8,
                padding:'11px 24px',
                background: status === 'processing' ? '#a5b4fc' : '#4f46e5',
                color:'#fff', border:'none', borderRadius:10,
                fontWeight:600, fontSize:14, cursor: status === 'processing' ? 'not-allowed' : 'pointer',
              }}
            >
              {status === 'processing'
                ? <><Loader size={15} style={{ animation:'spin 1s linear infinite' }} /> Processing...</>
                : <><Upload size={15} /> Generate Output</>}
            </button>
          </div>
        </div>

        {/* Output format info */}
        <div className="card-modern" style={{ ...card, marginTop:16 }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#718096', textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:12 }}>Output Columns</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {['Parent SKU','Product','Seller SKU','Image 1','Image 2','Image 3','Image 4','Image 5','Image 6','Image 7','Image 8','Variant Image','Variant Combo'].map(c => (
              <span key={c} style={{ fontSize:11, padding:'3px 8px', background:'#f1f5f9', borderRadius:4, color:'#374151', fontFamily:'monospace' }}>{c}</span>
            ))}
          </div>
          <div style={{ fontSize:11, color:'#94a3b8', marginTop:10 }}>
            Variant Combo is filled as <code style={{ background:'#f1f5f9', padding:'1px 4px', borderRadius:3 }}>Color:Red</code> when color is present.
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
