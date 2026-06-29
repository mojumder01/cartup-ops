import { useState } from 'react'
import { getApiKey, saveApiKey, testConnection } from '../utils/gemini'
import { processDarazFiles } from '../utils/processor'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader, Download, Settings, Zap } from 'lucide-react'

function FileInput({ label, required, onChange }) {
  const [fileName, setFileName] = useState('')
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#718096', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.4px' }}>
        {label} {required && <span style={{ color:'#dc2626' }}>*</span>}
      </label>
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
          : <><FileSpreadsheet size={16} color='#94a3b8' /><span style={{ fontSize:13, color:'#94a3b8' }}>Choose file...</span></>
        }
      </label>
    </div>
  )
}

export default function Production() {
  const [apiKey, setApiKey]         = useState(getApiKey())
  const [apiKeyInput, setApiKeyInput] = useState(getApiKey())
  const [testStatus, setTestStatus] = useState('')
  const [showSettings, setShowSettings] = useState(!getApiKey())

  const [files, setFiles]           = useState({})
  const [status, setStatus]         = useState('')
  const [progress, setProgress]     = useState('')
  const [error, setError]           = useState('')

  const handleSaveKey = () => {
    saveApiKey(apiKeyInput)
    setApiKey(apiKeyInput)
    setShowSettings(false)
    setTestStatus('')
  }

  const handleTestKey = async () => {
    setTestStatus('testing')
    const ok = await testConnection(apiKeyInput)
    setTestStatus(ok ? 'ok' : 'fail')
  }

  const handleProcess = async () => {
    if (!files.price || !files.basic || !files.weight || !files.skuimg) {
      setError('Please select all required files'); return
    }
    setError(''); setStatus('processing'); setProgress('Starting...')
    try {
      const outputArray = await processDarazFiles(files, apiKey, msg => setProgress(msg))
      const blob = new Blob([outputArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'cartup_output.xlsx'; a.click()
      URL.revokeObjectURL(url)
      setStatus('success'); setProgress('')
    } catch(e) {
      setStatus('error'); setError(e.message); setProgress('')
    }
  }

  const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:28, marginBottom:20 }

  return (
    <div style={{ padding:'32px 36px', maxWidth:820 }}>
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:20, fontWeight:700, color:'#1a202c' }}>Production — Upload</h1>
        <p style={{ color:'#718096', marginTop:4 }}>Process Daraz export files into CartUp template format with AI assistance.</p>
      </div>

      {/* API Key Settings */}
      <div style={{ ...card, border: apiKey ? '1px solid #e2e8f0' : '1.5px solid #f59e0b' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: showSettings ? 16 : 0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:8, background: apiKey ? '#dcfce7' : '#fef3c7', display:'flex', alignItems:'center', justifyContent:'center' }}>
              {apiKey ? <Zap size={18} color='#16a34a' /> : <Settings size={18} color='#d97706' />}
            </div>
            <div>
              <div style={{ fontWeight:600, fontSize:14 }}>Gemini API Key</div>
              <div style={{ color:'#718096', fontSize:12 }}>{apiKey ? '✓ Key saved — AI features enabled' : 'Add key to enable AI features'}</div>
            </div>
          </div>
          <button onClick={() => setShowSettings(!showSettings)}
            style={{ background:'none', border:'1px solid #e2e8f0', borderRadius:6, padding:'5px 12px', fontSize:12, cursor:'pointer', color:'#718096' }}>
            {showSettings ? 'Hide' : 'Edit'}
          </button>
        </div>

        {showSettings && (
          <div>
            <div style={{ marginBottom:10 }}>
              <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#718096', marginBottom:6, textTransform:'uppercase' }}>
                Gemini API Key
              </label>
              <input
                type="password" value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                placeholder="AIza..."
                style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:14, outline:'none' }}
              />
              <div style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>
                Get free key from <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" style={{ color:'#6366f1' }}>aistudio.google.com</a> — saved in this browser only
              </div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={handleSaveKey}
                style={{ padding:'8px 16px', background:'#4f46e5', color:'#fff', border:'none', borderRadius:6, fontWeight:600, fontSize:13, cursor:'pointer' }}>
                Save Key
              </button>
              <button onClick={handleTestKey} disabled={testStatus === 'testing'}
                style={{ padding:'8px 16px', background:'none', border:'1px solid #e2e8f0', borderRadius:6, fontSize:13, cursor:'pointer', color:'#718096' }}>
                {testStatus === 'testing' ? 'Testing...' : testStatus === 'ok' ? '✓ Connected' : testStatus === 'fail' ? '✗ Failed' : 'Test Connection'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Daraz Upload */}
      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:'#eef2ff', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Upload size={18} color='#4f46e5' />
          </div>
          <div>
            <div style={{ fontWeight:600, fontSize:15 }}>Daraz Upload</div>
            <div style={{ color:'#718096', fontSize:12 }}>Upload 4–5 Daraz export files → CartUp template</div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 20px' }}>
          <FileInput label="Price / Stock file" required onChange={f => setFiles(p => ({...p, price:f}))} />
          <FileInput label="Basic file" required onChange={f => setFiles(p => ({...p, basic:f}))} />
          <FileInput label="Weight file" required onChange={f => setFiles(p => ({...p, weight:f}))} />
          <FileInput label="SKU Image file" required onChange={f => setFiles(p => ({...p, skuimg:f}))} />
          <FileInput label="Attribute file (optional)" onChange={f => setFiles(p => ({...p, attr:f}))} />
        </div>

        {/* AI info */}
        {apiKey && (
          <div style={{ background:'#eef2ff', borderRadius:8, padding:'10px 14px', fontSize:12, color:'#4338ca', marginTop:8 }}>
            <Zap size={13} style={{ verticalAlign:'middle', marginRight:6 }} />
            AI enabled — Name fix, category matching & content generation via Gemini
          </div>
        )}

        {/* Status */}
        {status === 'processing' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:'#eff6ff', borderRadius:8, color:'#2563eb', fontSize:13, marginTop:16 }}>
            <Loader size={14} style={{ animation:'spin 1s linear infinite' }} />
            {progress}
          </div>
        )}
        {status === 'success' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:'#dcfce7', borderRadius:8, color:'#16a34a', fontSize:13, fontWeight:500, marginTop:16 }}>
            <CheckCircle size={14} /> Done! File downloaded.
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
          style={{
            display:'flex', alignItems:'center', gap:8, padding:'11px 22px',
            background: status === 'processing' ? '#a5b4fc' : '#4f46e5',
            color:'#fff', border:'none', borderRadius:8,
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
