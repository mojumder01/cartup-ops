import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getApiKey, saveApiKey, testConnection } from '../utils/gemini'
import { User, Key, CheckCircle, XCircle, Loader, Zap } from 'lucide-react'

export default function Profile() {
  const { user } = useAuth()
  const [apiKeyInput, setApiKeyInput] = useState(getApiKey())
  const [saved, setSaved]             = useState(!!getApiKey())
  const [testStatus, setTestStatus]   = useState('')

  const handleSave = () => {
    saveApiKey(apiKeyInput.trim())
    setSaved(true)
    setTestStatus('')
  }

  const handleTest = async () => {
    if (!apiKeyInput.trim()) return
    setTestStatus('testing')
    const ok = await testConnection(apiKeyInput.trim())
    setTestStatus(ok ? 'ok' : 'fail')
  }

  const handleClear = () => {
    saveApiKey('')
    setApiKeyInput('')
    setSaved(false)
    setTestStatus('')
  }

  const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:28, marginBottom:20 }

  return (
    <div style={{ padding:'32px 36px', maxWidth:600 }}>
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:20, fontWeight:700, color:'#1a202c' }}>Profile</h1>
        <p style={{ color:'#718096', marginTop:4, fontSize:13 }}>Account info and API settings.</p>
      </div>

      {/* User info */}
      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20 }}>
          <div style={{ width:52, height:52, borderRadius:'50%', background:'#eef2ff', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <User size={24} color='#4f46e5' />
          </div>
          <div>
            <div style={{ fontWeight:700, fontSize:16, color:'#1a202c' }}>{user?.name || user?.email}</div>
            <div style={{ color:'#718096', fontSize:13 }}>{user?.email}</div>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          {[
            ['Team', user?.team || 'Member'],
            ['Role', user?.role || 'User'],
          ].map(([label, value]) => (
            <div key={label} style={{ background:'#f8fafc', borderRadius:8, padding:'12px 14px' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:4 }}>{label}</div>
              <div style={{ fontSize:14, fontWeight:500, color:'#1a202c' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Gemini API Key */}
      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
          <div style={{ width:36, height:36, borderRadius:8, background: saved ? '#dcfce7' : '#fef3c7', display:'flex', alignItems:'center', justifyContent:'center' }}>
            {saved ? <Zap size={18} color='#16a34a' /> : <Key size={18} color='#d97706' />}
          </div>
          <div>
            <div style={{ fontWeight:600, fontSize:15, color:'#1a202c' }}>Gemini API Key</div>
            <div style={{ fontSize:12, color:'#718096' }}>
              {saved ? 'Key saved — AI features enabled' : 'No key set — AI features disabled'}
            </div>
          </div>
        </div>

        <div style={{ marginBottom:12 }}>
          <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#718096', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.4px' }}>
            API Key
          </label>
          <input
            type="password"
            value={apiKeyInput}
            onChange={e => { setApiKeyInput(e.target.value); setSaved(false); setTestStatus('') }}
            placeholder="AIza..."
            style={{
              width:'100%', padding:'10px 14px',
              border:'1.5px solid #e2e8f0', borderRadius:8, fontSize:14, outline:'none',
              boxSizing:'border-box',
            }}
            onFocus={e => e.target.style.borderColor = '#6366f1'}
            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
          />
          <div style={{ fontSize:11, color:'#94a3b8', marginTop:5 }}>
            Get a free key from{' '}
            <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" style={{ color:'#6366f1' }}>
              aistudio.google.com
            </a>{' '}
            — stored in this browser only, never sent to our server.
          </div>
        </div>

        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <button
            onClick={handleSave}
            disabled={!apiKeyInput.trim()}
            style={{
              padding:'9px 18px', background: apiKeyInput.trim() ? '#4f46e5' : '#a5b4fc',
              color:'#fff', border:'none', borderRadius:7, fontWeight:600, fontSize:13,
              cursor: apiKeyInput.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Save Key
          </button>

          <button
            onClick={handleTest}
            disabled={!apiKeyInput.trim() || testStatus === 'testing'}
            style={{
              padding:'9px 18px', background:'none',
              border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:13,
              cursor: apiKeyInput.trim() ? 'pointer' : 'not-allowed', color:'#718096',
              display:'flex', alignItems:'center', gap:6,
            }}
          >
            {testStatus === 'testing' && <Loader size={13} style={{ animation:'spin 1s linear infinite' }} />}
            {testStatus === 'ok'      && <CheckCircle size={13} color='#16a34a' />}
            {testStatus === 'fail'    && <XCircle size={13} color='#dc2626' />}
            {testStatus === 'testing' ? 'Testing...'
              : testStatus === 'ok'   ? 'Connected'
              : testStatus === 'fail' ? 'Failed — check key'
              : 'Test Connection'}
          </button>

          {saved && (
            <button
              onClick={handleClear}
              style={{
                padding:'9px 14px', background:'none',
                border:'1.5px solid #fee2e2', borderRadius:7, fontSize:13,
                cursor:'pointer', color:'#dc2626',
              }}
            >
              Clear Key
            </button>
          )}
        </div>

        {/* Feature list */}
        <div style={{ marginTop:20, borderTop:'1px solid #f1f5f9', paddingTop:16 }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#718096', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.4px' }}>
            AI Features Enabled With Key
          </div>
          <div style={{ display:'grid', gap:6 }}>
            {[
              'Name spelling fix & duplicate word removal',
              'Category matching by product name',
              'Highlights: format clean, non-Latin removal, deduplication',
              'Description: format clean, boilerplate replacement',
              'Fallback content generation from Name only (no invented data)',
            ].map(f => (
              <div key={f} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'#374151' }}>
                <CheckCircle size={13} color='#16a34a' />{f}
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
