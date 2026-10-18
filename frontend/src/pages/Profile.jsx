import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getProvider, saveProvider } from '../utils/aiProvider'
import { loadKeys, PROVIDER_LABEL } from '../utils/aiPool'
import AiKeys from '../components/AiKeys'
import { getReplacements, saveReplacements } from '../utils/wordReplacements'
import { User, Replace, Plus, Trash2, Sparkles } from 'lucide-react'

export default function Profile() {
  const { user } = useAuth()
  const [provider, setProvider]       = useState(getProvider())
  const [keys, setKeys]               = useState(loadKeys)
  const [replacements, setReplacements] = useState(getReplacements())
  const [replSaved, setReplSaved]       = useState(true)

  const updateRepl = (i, field, val) => {
    const next = replacements.map((r, idx) => idx === i ? { ...r, [field]: val } : r)
    setReplacements(next)
    setReplSaved(false)
  }
  const addRepl = () => { setReplacements([...replacements, { find: '', replace: '' }]); setReplSaved(false) }
  const removeRepl = i => { setReplacements(replacements.filter((_, idx) => idx !== i)); setReplSaved(false) }
  const saveRepl = () => { saveReplacements(replacements.filter(r => r.find)); setReplSaved(true) }

  const handleProvider = p => { setProvider(p); saveProvider(p) }

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

      {/* AI Provider */}
      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:'#f5f3ff', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Sparkles size={18} color='#7c3aed' />
          </div>
          <div>
            <div style={{ fontWeight:600, fontSize:15, color:'#1a202c' }}>AI Provider</div>
            <div style={{ fontSize:12, color:'#718096' }}>Choose which AI powers Production, QC and Governance</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {[
            ['gemini', 'Gemini', 'Google — 500 free req/day'],
            ['grok',   'Grok',   'xAI — key starts with xai-'],
            ['groq',   'Groq',   'groqcloud — key starts with gsk_'],
          ].map(([id, label, sub]) => (
            <button key={id} onClick={() => handleProvider(id)}
              style={{
                flex:'1 1 150px', textAlign:'left', padding:'12px 14px', borderRadius:10, cursor:'pointer',
                background: provider === id ? '#eef2ff' : '#fff',
                border:`1.5px solid ${provider === id ? '#6366f1' : '#e2e8f0'}`,
              }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{
                  width:16, height:16, borderRadius:'50%', flexShrink:0,
                  border:`2px solid ${provider === id ? '#4f46e5' : '#cbd5e1'}`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                  {provider === id && <div style={{ width:8, height:8, borderRadius:'50%', background:'#4f46e5' }} />}
                </div>
                <span style={{ fontWeight:600, fontSize:13, color:'#1a202c' }}>{label}</span>
              </div>
              <div style={{ fontSize:11, color:'#94a3b8', marginTop:3, marginLeft:24 }}>{sub}</div>
            </button>
          ))}
        </div>
        <div style={{ marginTop:12, padding:'8px 12px', background:'#eef2ff', border:'1px solid #c7d2fe', borderRadius:8, fontSize:11.5, color:'#4338ca' }}>
          <strong>Grok</strong> (xAI, by Elon Musk's company) and <strong>Groq</strong> (groqcloud, a fast-inference company) are two different providers with similar names — easy to mix up. Grok keys start with <code>xai-</code>, Groq keys start with <code>gsk_</code>.
        </div>
        {!keys[provider].length && (
          <div style={{ marginTop:8, padding:'8px 12px', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:8, fontSize:12, color:'#92400e' }}>
            {PROVIDER_LABEL[provider]} is selected but has no API key yet — add one below.
          </div>
        )}
      </div>

      {/* API keys & models (several per provider, used in turn) */}
      <AiKeys provider={provider} onChange={setKeys} />

      {/* Word Replacements */}
      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:'#ede9fe', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Replace size={18} color='#7c3aed' />
          </div>
          <div>
            <div style={{ fontWeight:600, fontSize:15, color:'#1a202c' }}>Word Replacements</div>
            <div style={{ fontSize:12, color:'#718096' }}>Auto-replace words in Name, Highlights &amp; Description (case-insensitive)</div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:8, marginBottom:10 }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.4px' }}>Find</div>
          <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.4px' }}>Replace with</div>
          <div />
        </div>

        {replacements.map((r, i) => (
          <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:8, marginBottom:8, alignItems:'center' }}>
            <input
              value={r.find}
              onChange={e => updateRepl(i, 'find', e.target.value)}
              placeholder="e.g. daraz"
              style={{ padding:'8px 12px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:13, outline:'none', boxSizing:'border-box' }}
              onFocus={e => e.target.style.borderColor = '#7c3aed'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
            <input
              value={r.replace}
              onChange={e => updateRepl(i, 'replace', e.target.value)}
              placeholder="e.g. cartup"
              style={{ padding:'8px 12px', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:13, outline:'none', boxSizing:'border-box' }}
              onFocus={e => e.target.style.borderColor = '#7c3aed'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
            <button onClick={() => removeRepl(i)} style={{ background:'none', border:'none', cursor:'pointer', color:'#dc2626', padding:6, display:'flex' }}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}

        <div style={{ display:'flex', gap:8, marginTop:12 }}>
          <button onClick={addRepl} style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', background:'none', border:'1.5px solid #e2e8f0', borderRadius:7, fontSize:13, cursor:'pointer', color:'#374151' }}>
            <Plus size={14} /> Add Row
          </button>
          <button onClick={saveRepl} style={{ padding:'8px 18px', background: replSaved ? '#4f46e5' : '#7c3aed', color:'#fff', border:'none', borderRadius:7, fontWeight:600, fontSize:13, cursor:'pointer' }}>
            {replSaved ? 'Saved' : 'Save Changes'}
          </button>
        </div>
        <div style={{ fontSize:11, color:'#94a3b8', marginTop:8 }}>Saved in this browser. Applied during every upload processing run.</div>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
