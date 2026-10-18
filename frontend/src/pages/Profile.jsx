import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import AiKeys from '../components/AiKeys'
import { getReplacements, saveReplacements } from '../utils/wordReplacements'
import { User, Replace, Plus, Trash2 } from 'lucide-react'

export default function Profile() {
  const { user } = useAuth()
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

  const card = { background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:28, marginBottom:20 }

  return (
    <div style={{ padding:'32px 36px', maxWidth:760 }}>
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:20, fontWeight:700, color:'#1a202c' }}>Profile</h1>
        <p style={{ color:'#718096', marginTop:4, fontSize:13 }}>Account info, Gemini API keys and settings.</p>
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

      {/* Gemini keys & models (several keys, used in turn) */}
      <AiKeys />

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
