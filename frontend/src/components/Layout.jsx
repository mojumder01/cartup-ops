import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { LayoutDashboard, Upload, CheckSquare, Image, Shield, LogOut, ChevronRight } from 'lucide-react'

const NAV = [
  { to: '/',           icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/production', icon: Upload,          label: 'Production' },
  { to: '/qc',         icon: CheckSquare,     label: 'QC',         soon: true },
  { to: '/visual',     icon: Image,           label: 'Visual',     soon: true },
  { to: '/governance', icon: Shield,          label: 'Governance', soon: true },
]

export default function Layout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => { signOut(); navigate('/login') }

  return (
    <div style={{ display:'flex', minHeight:'100vh' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220, background: '#1e1b4b', display:'flex',
        flexDirection:'column', flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ padding:'24px 20px 16px', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize:18, fontWeight:700, color:'#fff', letterSpacing:'-0.3px' }}>
            CartUp <span style={{ color:'#818cf8' }}>Ops</span>
          </div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:2 }}>Team Platform</div>
        </div>

        {/* Nav */}
        <nav style={{ flex:1, padding:'12px 0' }}>
          {NAV.map(({ to, icon: Icon, label, soon }) => (
            <NavLink key={to} to={to} end={to === '/'}
              style={({ isActive }) => ({
                display:'flex', alignItems:'center', gap:10,
                padding:'10px 20px', color: isActive ? '#fff' : 'rgba(255,255,255,0.55)',
                background: isActive ? 'rgba(99,102,241,0.25)' : 'transparent',
                borderLeft: isActive ? '3px solid #818cf8' : '3px solid transparent',
                transition:'all 0.15s', fontSize:13, fontWeight: isActive ? 600 : 400,
                pointerEvents: soon ? 'none' : 'auto',
              })}
            >
              <Icon size={16} />
              <span style={{ flex:1 }}>{label}</span>
              {soon && <span style={{ fontSize:10, background:'rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.4)', padding:'1px 6px', borderRadius:4 }}>Soon</span>}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding:'16px 20px', borderTop:'1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{
              width:32, height:32, borderRadius:'50%', background:'rgba(99,102,241,0.4)',
              display:'flex', alignItems:'center', justifyContent:'center',
              color:'#c7d2fe', fontWeight:700, fontSize:13, flexShrink:0,
            }}>
              {(user?.name || user?.email || 'U')[0].toUpperCase()}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color:'#fff', fontSize:12, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {user?.name || user?.email}
              </div>
              <div style={{ color:'rgba(255,255,255,0.4)', fontSize:11 }}>{user?.team || 'Member'}</div>
            </div>
            <button onClick={handleLogout} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.4)', padding:4 }} title="Logout">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex:1, overflow:'auto' }}>
        <Outlet />
      </main>
    </div>
  )
}
