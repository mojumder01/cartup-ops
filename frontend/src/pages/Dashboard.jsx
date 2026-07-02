import { useAuth } from '../hooks/useAuth'
import { Upload, CheckSquare, Image, Shield, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const TEAMS = [
  {
    label: 'Production',
    icon: Upload,
    grad: 'linear-gradient(135deg, #4f46e5, #6366f1)',
    glow: 'rgba(79,70,229,0.35)',
    desc: 'Daraz & manual file upload → CartUp template',
    path: '/production',
    active: true,
  },
  {
    label: 'QC',
    icon: CheckSquare,
    grad: 'linear-gradient(135deg, #16a34a, #22c55e)',
    glow: 'rgba(22,163,74,0.35)',
    desc: 'Sequential checks — Name, Category, Image, Highlights, Description, Weight',
    path: '/qc',
    active: true,
  },
  {
    label: 'Visual',
    icon: Image,
    grad: 'linear-gradient(135deg, #d97706, #f59e0b)',
    glow: 'rgba(217,119,6,0.35)',
    desc: 'SKU image + basic file → image output with variant mapping',
    path: '/visual',
    active: true,
  },
  {
    label: 'Governance',
    icon: Shield,
    grad: 'linear-gradient(135deg, #7c3aed, #a855f7)',
    glow: 'rgba(124,58,237,0.35)',
    desc: 'AI pipeline — Name, Weight, Category, Highlights, Description',
    path: '/governance',
    active: true,
  },
]

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  return (
    <div style={{ padding:'36px 40px', maxWidth:960 }}>
      {/* Hero */}
      <div style={{ marginBottom:34 }}>
        <h1 style={{ fontSize:26, fontWeight:800, letterSpacing:'-0.5px' }}>
          Welcome back,{' '}
          <span style={{
            background:'linear-gradient(90deg, #4f46e5, #a855f7)',
            WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
          }}>
            {user?.name || user?.email?.split('@')[0]}
          </span>
          {' '}👋
        </h1>
        <p style={{ color:'var(--text-muted)', marginTop:4, fontSize:14 }}>
          CartUp Ops — Catalog Team Platform
        </p>
      </div>

      {/* Team cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:18 }}>
        {TEAMS.map(({ label, icon: Icon, grad, glow, desc, path, active }, i) => (
          <div
            key={label}
            className="team-card"
            onClick={() => active && navigate(path)}
            style={{
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:16, padding:'26px', cursor: active ? 'pointer' : 'default',
              position:'relative', overflow:'hidden',
              opacity: active ? 1 : 0.6,
              animationDelay:`${i * 0.06}s`,
              '--card-glow': glow,
            }}
          >
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
              <div className="team-icon" style={{
                width:48, height:48, borderRadius:13,
                background:grad, display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:`0 6px 18px ${glow}`,
              }}>
                <Icon size={23} color='#fff' />
              </div>
              {!active && (
                <span style={{ fontSize:11, background:'#f1f5f9', color:'#94a3b8', padding:'3px 8px', borderRadius:20, fontWeight:500 }}>
                  Coming soon
                </span>
              )}
              {active && <ArrowRight className="team-arrow" size={17} color='#94a3b8' />}
            </div>
            <div style={{ marginTop:18 }}>
              <div style={{ fontWeight:700, fontSize:16, color:'var(--text)' }}>{label}</div>
              <div style={{ color:'var(--text-muted)', fontSize:13, marginTop:5, lineHeight:1.55 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .team-card {
          animation: fadeUp 0.4s ease both;
          transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
        }
        .team-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 40px var(--card-glow, rgba(15,23,42,0.12));
          border-color: transparent;
        }
        .team-card .team-arrow { transition: transform 0.18s ease, color 0.18s ease; }
        .team-card:hover .team-arrow { transform: translateX(4px); color: #4f46e5; }
        .team-card .team-icon { transition: transform 0.18s ease; }
        .team-card:hover .team-icon { transform: scale(1.08) rotate(-3deg); }
      `}</style>
    </div>
  )
}
