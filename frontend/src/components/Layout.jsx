import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { LayoutDashboard, Upload, CheckSquare, Image, Shield, LogOut, ChevronRight, UserCircle } from 'lucide-react'
import { APP_VERSION } from '../version'

export default function Layout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const onProd   = location.pathname.startsWith('/production')

  const handleLogout = () => { signOut(); navigate('/login') }

  const navItem = (to, Icon, label, soon, end = false) => (
    <NavLink key={to} to={to} end={end}
      style={({ isActive }) => ({
        display:'flex', alignItems:'center', gap:10,
        padding:'10px 20px',
        color: isActive ? '#fff' : 'rgba(255,255,255,0.55)',
        background: isActive ? 'rgba(99,102,241,0.25)' : 'transparent',
        borderLeft: isActive ? '3px solid #818cf8' : '3px solid transparent',
        transition:'all 0.15s', fontSize:13, fontWeight: isActive ? 600 : 400,
        textDecoration:'none',
        pointerEvents: soon ? 'none' : 'auto',
      })}
    >
      <Icon size={16} />
      <span style={{ flex:1 }}>{label}</span>
      {soon && <span style={{ fontSize:10, background:'rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.4)', padding:'1px 6px', borderRadius:4 }}>Soon</span>}
    </NavLink>
  )

  const subItem = (to, label) => (
    <NavLink key={to} to={to}
      style={({ isActive }) => ({
        display:'flex', alignItems:'center', gap:8,
        padding:'8px 20px 8px 40px',
        color: isActive ? '#c7d2fe' : 'rgba(255,255,255,0.38)',
        background: isActive ? 'rgba(99,102,241,0.15)' : 'transparent',
        borderLeft: isActive ? '3px solid #6366f1' : '3px solid transparent',
        fontSize:12, fontWeight: isActive ? 600 : 400,
        textDecoration:'none', transition:'all 0.15s',
      })}
    >
      <ChevronRight size={11} />
      {label}
    </NavLink>
  )

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      {/* Sidebar — fixed height, always fully visible */}
      <aside style={{ width:220, height:'100vh', background:'#1e1b4b', display:'flex', flexDirection:'column', flexShrink:0, overflowY:'auto' }}>
        {/* Logo */}
        <div style={{ padding:'20px 20px 14px', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
          <img
            src="https://cartup.com/new/cartup-logo-voucher.svg"
            alt="CartUp"
            style={{ height:32, display:'block', marginBottom:6 }}
          />
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>Catalog Team Platform</div>
        </div>

        {/* Nav */}
        <nav className="sb-nav" style={{ flex:1, padding:'12px 0' }}>
          {navItem('/', LayoutDashboard, 'Dashboard', false, true)}

          {/* Production parent */}
          {navItem('/production', Upload, 'Production')}
          {/* Sub-menu — visible when on production */}
          {onProd && (
            <>
              {subItem('/production/daraz',  'Daraz Upload')}
              {subItem('/production/manual', 'Manual Upload')}
            </>
          )}

          {navItem('/visual',     Image,       'Visual',     false)}
          {navItem('/qc',         CheckSquare, 'QC',         false)}
          {navItem('/governance', Shield,      'Governance', false)}
        </nav>

        {/* Sidebar footer */}
        <div style={{ padding:'12px 20px 14px', borderTop:'1px solid rgba(255,255,255,0.08)', textAlign:'center' }}>
          <div className="sb-credit">built by muntasir</div>
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.25)', fontFamily:'monospace', marginTop:3 }}>v{APP_VERSION}</div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex:1, height:'100vh', overflow:'auto', display:'flex', flexDirection:'column' }}>
        {/* Top bar */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'flex-end',
          padding:'10px 24px', borderBottom:'1px solid #e2e8f0',
          background:'#fff', gap:12, flexShrink:0,
        }}>
          <NavLink to="/profile"
            style={({ isActive }) => ({
              display:'flex', alignItems:'center', gap:7,
              textDecoration:'none', fontSize:12,
              color: isActive ? '#4f46e5' : '#64748b',
              fontWeight: isActive ? 600 : 400,
            })}
          >
            <div style={{
              width:30, height:30, borderRadius:'50%', background: '#eef2ff',
              display:'flex', alignItems:'center', justifyContent:'center',
              color:'#4f46e5', fontWeight:700, fontSize:13, flexShrink:0,
            }}>
              {(user?.name || user?.email || 'U')[0].toUpperCase()}
            </div>
            <div style={{ lineHeight:1.3 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#1a202c', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {user?.name || user?.email}
              </div>
              <div style={{ fontSize:11, color:'#94a3b8' }}>Profile &amp; Settings</div>
            </div>
          </NavLink>
          <button onClick={handleLogout} title="Logout"
            style={{ background:'none', border:'1px solid #e2e8f0', borderRadius:7, color:'#94a3b8', padding:'6px 8px', cursor:'pointer', display:'flex', alignItems:'center' }}>
            <LogOut size={14} />
          </button>
        </div>
        <div style={{ flex:1, overflow:'auto' }}>
          <Outlet />
        </div>
      </main>

      <style>{`
        .sb-credit {
          font-size: 13px;
          font-weight: 600;
          color: #fff;
          cursor: default;
          transition: color 0.2s, text-shadow 0.2s;
        }
        .sb-credit:hover {
          color: #a5b4fc;
          text-shadow: 0 0 12px rgba(129, 140, 248, 0.8);
        }
        .sb-nav a:hover {
          color: #fff !important;
          background: rgba(99, 102, 241, 0.35) !important;
        }
      `}</style>
    </div>
  )
}
