import { useState } from 'react'
import { getApiKey } from '../utils/gemini'
import { processManualFile, generateTemplate } from '../utils/manualProcessor'
import { FileSpreadsheet, CheckCircle, AlertCircle, Loader, Download, Zap, Info } from 'lucide-react'

export default function ManualUpload() {
  const apiKey = getApiKey()
  const [file, setFile]         = useState(null)
  const [fileName, setFileName] = useState('')
  const [status, setStatus]     = useState('')
  const [progress, setProgress] = useState('')
  const [error, setError]       = useState('')

  const handleFile = e => {
    const f = e.target.files[0]
    if (f) { setFile(f); setFileName(f.name); setStatus(''); setError('') }
  }

  const handleTemplate = () => {
    const arr = generateTemplate()
    const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'cartup_manual_template.xlsx'; a.click()
    URL.revokeObjectURL(url)
  }

  const handleProcess = async () => {
    if (!file) { setError('Please select a file'); return }
    setError(''); setStatus('processing'); setProgress('Starting...')
    try {
      const outputArray = await processManualFile(file, apiKey, msg => setProgress(msg))
      const blob = new Blob([outputArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'cartup_manual_output.xlsx'; a.click()
      URL.revokeObjectURL(url)
      setStatus('success'); setProgress('')
    } catch(e) {
      setStatus('error'); setError(e.message); setProgress('')
    }
  }

  const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:28 }

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <p style={{ color:'#718096', fontSize:13 }}>Upload a manual product Excel file → AI processes name, category, highlights & description → CartUp template.</p>
      </div>

      {/* Input format info */}
      <div style={{ ...card, marginBottom:16, background:'#f8fafc' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Info size={15} color='#4f46e5' />
            <span style={{ fontWeight:600, fontSize:13, color:'#1a202c' }}>Input Columns — Variants auto-expand</span>
          </div>
          <button
            onClick={handleTemplate}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}
          >
            <Download size={13} /> Download Template
          </button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'6px 16px' }}>
          {[
            ['Name', 'Required'],
            ['Parent SKU', 'Required'],
            ['Price', 'Optional'],
            ['Color (comma-sep)', 'Optional'],
            ['Size (comma-sep)', 'Optional'],
            ['Highlights', 'Optional'],
            ['Description', 'Optional'],
            ['Brand', 'Optional'],
            ['Image 1–8', 'Optional'],
            ['Stock / Quantity', 'Optional'],
            ['Special Price', 'Optional'],
            ['Weight / Length / Width / Height', 'Optional'],
          ].map(([col, req]) => (
            <div key={col} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
              <span style={{
                padding:'1px 6px', borderRadius:4, fontSize:11, fontWeight:600,
                background: req === 'Required' ? '#fee2e2' : '#f1f5f9',
                color: req === 'Required' ? '#dc2626' : '#64748b',
              }}>{req}</span>
              <span style={{ color:'#374151' }}>{col}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop:10, padding:'8px 12px', background:'#eef2ff', borderRadius:6, fontSize:12, color:'#4338ca' }}>
          <b>Variant expansion:</b> Color=<i>Black,Blue</i> × Size=<i>40,42</i> → 4 rows with SKU like <code>SWE77556_Black_40</code>
        </div>
      </div>

      <div style={card}>
        {/* File picker */}
        <div style={{ marginBottom:20 }}>
          <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#718096', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.4px' }}>
            Manual Product File <span style={{ color:'#dc2626' }}>*</span>
          </label>
          <label style={{
            display:'flex', alignItems:'center', gap:10, padding:'14px 18px',
            border:`2px dashed ${fileName ? '#16a34a' : '#e2e8f0'}`,
            borderRadius:10, cursor:'pointer',
            background: fileName ? '#dcfce7' : '#fafafa',
            transition:'all 0.15s',
          }}>
            <input type="file" accept=".xlsx" style={{ display:'none' }} onChange={handleFile} />
            {fileName
              ? <><CheckCircle size={18} color='#16a34a' /><span style={{ fontSize:14, color:'#16a34a', fontWeight:500 }}>{fileName}</span></>
              : <><FileSpreadsheet size={18} color='#94a3b8' /><span style={{ fontSize:14, color:'#94a3b8' }}>Choose Excel file (.xlsx)</span></>
            }
          </label>
        </div>

        {/* AI status */}
        {apiKey
          ? (
            <div style={{ background:'#eef2ff', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#4338ca', marginBottom:16 }}>
              <Zap size={13} style={{ verticalAlign:'middle', marginRight:6 }} />
              AI enabled — Name cleaning, category matching, highlights & description via Gemini
            </div>
          ) : (
            <div style={{ background:'#fef3c7', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#92400e', marginBottom:16 }}>
              No Gemini API key — AI features disabled. Add key in Profile to enable full processing.
            </div>
          )
        }

        {/* AI steps preview */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:8, marginBottom:20 }}>
          {[
            ['1. Name Fix', 'Typo correction, duplicate word removal, spacing fix'],
            ['2. Category Match', 'AI matches product to best CartUp category'],
            ['3. Highlights Clean', 'Format, remove non-Latin, artifacts, duplicates'],
            ['4. Description Clean', 'Format, remove boilerplate, keep only given info'],
          ].map(([step, desc]) => (
            <div key={step} style={{ background:'#f8fafc', borderRadius:8, padding:'10px 12px', border:'1px solid #e2e8f0' }}>
              <div style={{ fontWeight:600, fontSize:12, color:'#1a202c', marginBottom:2 }}>{step}</div>
              <div style={{ fontSize:11, color:'#718096', lineHeight:1.4 }}>{desc}</div>
            </div>
          ))}
        </div>

        {/* Status messages */}
        {status === 'processing' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:'#eff6ff', borderRadius:8, color:'#2563eb', fontSize:13, marginBottom:16 }}>
            <Loader size={14} style={{ animation:'spin 1s linear infinite' }} />
            <span style={{ flex:1 }}>{progress}</span>
          </div>
        )}
        {status === 'success' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:'#dcfce7', borderRadius:8, color:'#16a34a', fontSize:13, fontWeight:500, marginBottom:16 }}>
            <CheckCircle size={14} /> Done! cartup_manual_output.xlsx downloaded.
          </div>
        )}
        {error && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:'#fee2e2', borderRadius:8, color:'#dc2626', fontSize:13, marginBottom:16 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <button
          onClick={handleProcess}
          disabled={status === 'processing' || !file}
          style={{
            display:'flex', alignItems:'center', gap:8, padding:'11px 24px',
            background: (status === 'processing' || !file) ? '#a5b4fc' : '#4f46e5',
            color:'#fff', border:'none', borderRadius:8,
            fontWeight:600, fontSize:14,
            cursor: (status === 'processing' || !file) ? 'not-allowed' : 'pointer',
          }}
        >
          {status === 'processing'
            ? <><Loader size={15} style={{ animation:'spin 1s linear infinite' }} /> Processing...</>
            : <><Download size={15} /> Process & Download</>
          }
        </button>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
