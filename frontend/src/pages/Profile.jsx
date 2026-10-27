import { useAuth } from '../hooks/useAuth'
import AiKeys from '../components/AiKeys'
import { Link } from 'react-router-dom'
import { User, Replace } from 'lucide-react'

export default function Profile() {
  const { user } = useAuth()

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

      {/* Word replacements moved to Data & Rules — shared with the team */}
      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:'#ede9fe', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Replace size={18} color='#7c3aed' />
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:600, fontSize:15, color:'#1a202c' }}>Word Replacements</div>
            <div style={{ fontSize:12, color:'#718096' }}>Now shared with the whole team — edited in Data &amp; Rules → Rules &amp; defaults (with the other house rules)</div>
          </div>
          <Link to="/settings" style={{ padding:'8px 14px', background:'#4f46e5', color:'#fff', borderRadius:7, fontWeight:600, fontSize:13, textDecoration:'none' }}>Open Data &amp; Rules</Link>
        </div>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )
}
