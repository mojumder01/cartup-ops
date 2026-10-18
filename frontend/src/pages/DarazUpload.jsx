import { useEffect, useMemo, useState } from 'react'
import { getActiveApiKey as getApiKey } from '../utils/gemini'
import { processDarazFiles, buildDarazWorkbook } from '../utils/processor'
import { applyDecisions, loadMemory, rememberDecisions, forgetMemory } from '../utils/variantReview'
import { loadSavedTemplate, saveTemplate, savedLabel } from '../utils/templateStore'
import VariantReview from '../components/VariantReview'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, AlertTriangle, Loader, Download, Zap, ListChecks, Layers } from 'lucide-react'

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
  const [saved, setSaved]     = useState(null)
  const [result, setResult]   = useState(null)       // processed run, kept for review + download
  const [decisions, setDecisions] = useState({})
  const [memory, setMemory]   = useState(loadMemory)
  const [reviewing, setReviewing] = useState(false)

  // Live totals for the current decisions.
  const stats = useMemo(() => result && applyDecisions(result, decisions, memory).stats, [result, decisions, memory])

  // The CartUp template picked last time (on this page or Shop Duplicate).
  useEffect(() => {
    loadSavedTemplate().then(t => {
      if (!t) return
      setSaved(t)
      setFiles(p => p.template ? p : { ...p, template: t.file })
    })
  }, [])

  const pick = key => f => {
    setFiles(p => ({ ...p, [key]: f })); setStatus(''); setError(''); setResult(null)
    if (key === 'template') saveTemplate(f)
  }

  const handleProcess = async () => {
    if (!files.price || !files.basic || !files.weight || !files.skuimg) {
      setError('Please select all required files'); return
    }
    setError(''); setStatus('processing'); setProgress('Starting...'); setResult(null); setDecisions({})
    try {
      const res = await processDarazFiles(files, apiKey, msg => setProgress(msg))
      setResult(res); setStatus('success'); setProgress('')
      // Values still undecided (or variants left identical) → review first; otherwise download now.
      const { stats } = applyDecisions(res, {}, memory)
      if (stats.open || stats.dupes) setReviewing(true)
      else download(res, {})
    } catch(e) {
      setStatus('error'); setError(e.message); setProgress('')
    }
  }

  function download(res = result, dec = decisions) {
    const { bytes } = buildDarazWorkbook(res, dec, memory)
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'cartup_daraz_output.xlsx'; a.click()
    URL.revokeObjectURL(url)
    setMemory(rememberDecisions(dec))
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
            <CheckCircle size={14} /> Processed — {result.items.length.toLocaleString()} rows{result.invalidRows.length ? `, ${result.invalidRows.length.toLocaleString()} in the "invalid" sheet` : ''}{result.duplicateSkus.length ? `, ${result.duplicateSkus.length} repeated Seller SKU rows removed` : ''}.
          </div>
        )}
        {status === 'success' && result.template && (
          <div style={{ padding:'12px 16px', background: stats.open ? '#fef2f2' : '#f8fafc', border:`1px solid ${stats.open ? '#fecaca' : '#e2e8f0'}`, borderRadius:8, fontSize:12.5, color:'#334155', marginTop:10, lineHeight:1.7 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, fontWeight:600, color:'#1a202c' }}>
              <ListChecks size={14} color='#4f46e5' /> Dropdown values checked against the CartUp template: {stats.checked.toLocaleString()}
            </div>
            <div>· {stats.auto.toLocaleString()} matched automatically (spelling, EU:40 → 40 (EU), XXL → 2XL, Free Size → One Size, Multicolor-1/-2 to keep variants apart)</div>
            {stats.remembered > 0 && <div>· {stats.remembered.toLocaleString()} from picks remembered from earlier runs</div>}
            {stats.picked > 0 && <div>· {stats.picked.toLocaleString()} picked by you</div>}
            {stats.kept > 0 && <div>· {stats.kept.toLocaleString()} kept as new values for CartUp's lists ("new values" sheet)</div>}
            {stats.open > 0
              ? <div style={{ color:'#b91c1c', display:'flex', alignItems:'center', gap:6 }}><AlertTriangle size={13} /> {stats.open.toLocaleString()} values ({stats.openValues.toLocaleString()} different) in {stats.openParents.toLocaleString()} products still not on the lists — they'd show #N/A in payload_hidden</div>
              : <div style={{ color:'#15803d' }}>· Every value is matched or decided — no #N/A expected</div>}
            {stats.dupes > 0 && <div style={{ color:'#b45309' }}>· {stats.dupes.toLocaleString()} SKUs have the same variant values as a sibling — change them in the review</div>}
            <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
              <button onClick={() => setReviewing(true)} className="btn-primary"
                style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                <Layers size={14} /> Review product by product{stats.open ? ` (${stats.open} open)` : ''}
              </button>
              <button onClick={() => download()}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', background:'#fff', color:'#4f46e5', border:'1.5px solid #c7d2fe', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                <Download size={14} /> Download file
              </button>
            </div>
            <div style={{ fontSize:11.5, color:'#64748b', marginTop:8 }}>
              The file has a <b>changes</b> sheet (every change, one row per Seller SKU) and a <b>new values</b> sheet (values not on CartUp's lists, with the closest list values).
            </div>
          </div>
        )}
        {status === 'success' && !result.template && (
          <div style={{ background:'#fef3c7', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#92400e', marginTop:10 }}>
            Values were not checked against CartUp's dropdown lists — add the CartUp upload template above to catch #N/A before uploading.
            <button onClick={() => download()} style={{ display:'flex', alignItems:'center', gap:6, marginTop:8, padding:'6px 12px', background:'#fff', color:'#92400e', border:'1.5px solid #fde68a', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              <Download size={12} /> Download again
            </button>
          </div>
        )}
        {reviewing && result && (
          <VariantReview result={result} decisions={decisions} setDecisions={setDecisions} memory={memory}
            onForgetMemory={() => setMemory(forgetMemory())}
            onDownload={() => download()}
            onClose={() => setReviewing(false)} />
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
