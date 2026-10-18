import { useEffect, useState } from 'react'
import { getActiveApiKey as getApiKey } from '../utils/gemini'
import { processDarazFiles } from '../utils/processor'
import { loadSavedTemplate, saveTemplate, savedLabel } from '../utils/templateStore'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, AlertTriangle, Loader, Download, Zap, ListChecks } from 'lucide-react'

// current: text shown while nothing has been picked here (e.g. a remembered file).
function FileInput({ label, required, onChange, current, hint }) {
  const [picked, setPicked] = useState('')
  const fileName = picked || current
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#718096', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.4px' }}>
        {label} {required && <span style={{ color:'#dc2626' }}>*</span>}
      </label>
      {hint && <div style={{ fontSize:11, color:'#94a3b8', marginTop:-2, marginBottom:6 }}>{hint}</div>}
      <label className="file-drop" style={{
        display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
        border:`1.5px dashed ${fileName ? '#16a34a' : '#e2e8f0'}`,
        borderRadius:8, cursor:'pointer',
        background: fileName ? '#dcfce7' : '#fafafa',
      }}>
        <input type="file" accept=".xlsx" style={{ display:'none' }}
          onChange={e => {
            const f = e.target.files[0]
            e.target.value = ''   // allow re-selecting the same file name
            if(f){ setPicked(f.name); onChange(f) }
          }}
        />
        {fileName
          ? <><CheckCircle size={16} color='#16a34a' /><span style={{ fontSize:13, color:'#16a34a', fontWeight:500 }}>{fileName}</span></>
          : <><FileSpreadsheet size={16} color='#94a3b8' /><span style={{ fontSize:13, color:'#94a3b8' }}>Choose file...</span></>
        }
      </label>
    </div>
  )
}

export default function DarazUpload() {
  const apiKey = getApiKey()
  const [files, setFiles]     = useState({})
  const [status, setStatus]   = useState('')
  const [progress, setProgress] = useState('')
  const [error, setError]     = useState('')
  const [stats, setStats]     = useState(null)
  const [saved, setSaved]     = useState(null)

  // The CartUp template picked last time (on this page or Shop Duplicate).
  useEffect(() => {
    loadSavedTemplate().then(t => {
      if (!t) return
      setSaved(t)
      setFiles(p => p.template ? p : { ...p, template: t.file })
    })
  }, [])

  const pick = key => f => {
    setFiles(p => ({ ...p, [key]: f })); setStatus(''); setError(''); setStats(null)
    if (key === 'template') saveTemplate(f)
  }

  const handleProcess = async () => {
    if (!files.price || !files.basic || !files.weight || !files.skuimg) {
      setError('Please select all required files'); return
    }
    setError(''); setStatus('processing'); setProgress('Starting...'); setStats(null)
    try {
      const { bytes, stats } = await processDarazFiles(files, apiKey, msg => setProgress(msg))
      setStats(stats)
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'cartup_daraz_output.xlsx'; a.click()
      URL.revokeObjectURL(url)
      setStatus('success'); setProgress('')
    } catch(e) {
      setStatus('error'); setError(e.message); setProgress('')
    }
  }

  const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:14, padding:28, boxShadow:'0 1px 3px rgba(15,23,42,0.06), 0 4px 16px rgba(15,23,42,0.04)' }

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <p style={{ color:'#718096', fontSize:13 }}>Upload 4–5 Daraz export files → CartUp template format with AI assistance.</p>
      </div>

      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:'#eef2ff', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Upload size={18} color='#4f46e5' />
          </div>
          <div>
            <div style={{ fontWeight:600, fontSize:15 }}>Daraz Export Files</div>
            <div style={{ color:'#718096', fontSize:12 }}>Price, Basic, Weight, SKU Image (+ optional Attribute, CartUp template)</div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 20px' }}>
          <FileInput label="Price / Stock file" required onChange={pick('price')} />
          <FileInput label="Basic file"          required onChange={pick('basic')} />
          <FileInput label="Weight file"         required onChange={pick('weight')} />
          <FileInput label="SKU Image file"      required onChange={pick('skuimg')} />
          <FileInput label="Attribute file (optional)" onChange={pick('attr')} />
          <FileInput label="CartUp upload template (recommended)" onChange={pick('template')}
            current={saved && savedLabel(saved)}
            hint="Color, Size, Brand, Warranty… are checked against its dropdown lists — remembered for next time" />
        </div>

        {apiKey && (
          <div style={{ background:'#eef2ff', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#4338ca', marginTop:8 }}>
            <Zap size={13} style={{ verticalAlign:'middle', marginRight:6 }} />
            AI enabled — Name fix, category matching & content generation via Gemini
          </div>
        )}
        {!apiKey && (
          <div style={{ background:'#fef3c7', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#92400e', marginTop:8 }}>
            No Gemini API key — AI features disabled. Add key in Profile.
          </div>
        )}

        {status === 'processing' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:'#eff6ff', borderRadius:8, color:'#2563eb', fontSize:13, marginTop:16 }}>
            <Loader size={14} style={{ animation:'spin 1s linear infinite' }} />{progress}
          </div>
        )}
        {status === 'success' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:'#dcfce7', borderRadius:8, color:'#16a34a', fontSize:13, fontWeight:500, marginTop:16 }}>
            <CheckCircle size={14} /> Done! File downloaded — {stats.rows.toLocaleString()} rows{stats.invalid ? `, ${stats.invalid.toLocaleString()} in the "invalid" sheet` : ''}.
          </div>
        )}
        {status === 'success' && stats.template && (
          <div style={{ padding:'12px 16px', background: stats.unmatched ? '#fef2f2' : '#f8fafc', border:`1px solid ${stats.unmatched ? '#fecaca' : '#e2e8f0'}`, borderRadius:8, fontSize:12.5, color:'#334155', marginTop:10, lineHeight:1.7 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, fontWeight:600, color:'#1a202c' }}>
              <ListChecks size={14} color='#4f46e5' /> Dropdown values checked against the CartUp template: {stats.checked.toLocaleString()}
            </div>
            <div>· {stats.fixed.toLocaleString()} auto-matched to the list's spelling (e.g. EU:40 → 40 (EU), XXL → 2XL, Free Size → One Size)</div>
            {stats.unmatched > 0
              ? <div style={{ color:'#b91c1c', display:'flex', alignItems:'center', gap:6 }}><AlertTriangle size={13} /> {stats.unmatched.toLocaleString()} not on the CartUp lists — they would show #N/A in payload_hidden. See the "value check" sheet and the Report column.</div>
              : <div style={{ color:'#15803d' }}>· Every value is on the CartUp lists — no #N/A expected</div>}
          </div>
        )}
        {status === 'success' && !stats.template && (
          <div style={{ background:'#fef3c7', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#92400e', marginTop:10 }}>
            Values were not checked against CartUp's dropdown lists — add the CartUp upload template above to catch #N/A before uploading.
          </div>
        )}
        {error && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:'#fee2e2', borderRadius:8, color:'#dc2626', fontSize:13, marginTop:16 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <button
          onClick={handleProcess}
          disabled={status === 'processing'}
          className={status === 'processing' ? '' : 'btn-primary'}
          style={{
            display:'flex', alignItems:'center', gap:8, padding:'12px 24px',
            background: status === 'processing' ? '#a5b4fc' : '#4f46e5',
            color:'#fff', border:'none', borderRadius:10,
            fontWeight:600, fontSize:14, marginTop:20,
            cursor: status === 'processing' ? 'not-allowed' : 'pointer',
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
