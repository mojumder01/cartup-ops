import { useAuth } from '../hooks/useAuth'
import { Upload, CheckSquare, Image, Shield, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const TEAMS = [
  {
    label: 'Production',
    icon: Upload,
    color: '#4f46e5',
    bg: '#eef2ff',
    desc: 'Daraz & manual file upload → CartUp template',
    path: '/production',
    active: true,
  },
  {
    label: 'QC',
    icon: CheckSquare,
    color: '#16a34a',
    bg: '#dcfce7',
    desc: 'Review AI output, approve or reject rows',
    path: '/qc',
    active: false,
  },
  {
    label: 'Visual',
    icon: Image,
    color: '#d97706',
    bg: '#fef3c7',
    desc: 'Asset upload, alt-text & visual tagging',
    path: '/visual',
    active: false,
  },
  {
    label: 'Governance',
    icon: Shield,
    color: '#7c3aed',
    bg: '#f5f3ff',
    desc: 'Monitor team activity, reports & audit logs',
    path: '/governance',
    active: false,
  },
]

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  return (
    <div style={{ padding:'32px 36px', maxWidth:900 }}>
      {/* Header */}
      <div style={{ marginBottom:32 }}>
        <h1 style={{ fontSize:22, fontWeight:700, color:'var(--text)' }}>
          Welcome back, {user?.name || user?.email?.split('@')[0]} 👋
        </h1>
        <p style={{ color:'var(--text-muted)', marginTop:4 }}>CartUp Ops — Team Operations Platform</p>
      </div>

      {/* Team cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:16 }}>
        {TEAMS.map(({ label, icon: Icon, color, bg, desc, path, active }) => (
          <div
            key={label}
            onClick={() => active && navigate(path)}
            style={{
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:12, padding:'24px', cursor: active ? 'pointer' : 'default',
              transition:'box-shadow 0.15s, transform 0.15s',
              opacity: active ? 1 : 0.6,
            }}
            onMouseEnter={e => { if(active){ e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,0.08)'; e.currentTarget.style.transform='translateY(-2px)' }}}
            onMouseLeave={e => { e.currentTarget.style.boxShadow='none'; e.currentTarget.style.transform='none' }}
          >
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
              <div style={{
                width:44, height:44, borderRadius:10,
                background:bg, display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                <Icon size={22} color={color} />
              </div>
              {!active && (
                <span style={{ fontSize:11, background:'#f1f5f9', color:'#94a3b8', padding:'3px 8px', borderRadius:20, fontWeight:500 }}>
                  Coming soon
                </span>
              )}
              {active && <ArrowRight size={16} color='#94a3b8' />}
            </div>
            <div style={{ marginTop:16 }}>
              <div style={{ fontWeight:600, fontSize:15, color:'var(--text)' }}>{label}</div>
              <div style={{ color:'var(--text-muted)', fontSize:13, marginTop:4, lineHeight:1.5 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
