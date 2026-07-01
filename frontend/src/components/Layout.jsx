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
    <div style={{ display:'flex', minHeight:'100vh' }}>
      {/* Sidebar */}
      <aside style={{ width:220, background:'#1e1b4b', display:'flex', flexDirection:'column', flexShrink:0 }}>
        {/* Logo */}
        <div style={{ padding:'20px 20px 14px', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
          <img
            src="https://cartup.com/new/cartup-logo-voucher.svg"
            alt="CartUp"
            style={{ height:32, display:'block', marginBottom:6 }}
          />
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)' }}>Catalog Team Platform</div>
            <span style={{ fontSize:10, color:'rgba(255,255,255,0.25)', fontFamily:'monospace' }}>v{APP_VERSION}</span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex:1, padding:'12px 0' }}>
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
          {navItem('/qc',         CheckSquare, 'QC',         true)}
          {navItem('/governance', Shield,      'Governance', true)}
        </nav>

        {/* Footer */}
        <div style={{ padding:'12px 20px 16px', borderTop:'1px solid rgba(255,255,255,0.08)' }}>
          {/* Profile link */}
          <NavLink to="/profile"
            style={({ isActive }) => ({
              display:'flex', alignItems:'center', gap:8,
              padding:'8px 0 10px',
              color: isActive ? '#c7d2fe' : 'rgba(255,255,255,0.45)',
              textDecoration:'none', fontSize:12,
              borderBottom:'1px solid rgba(255,255,255,0.07)',
              marginBottom:10,
            })}
          >
            <UserCircle size={14} />
            <span>Profile &amp; Settings</span>
          </NavLink>

          {/* User row */}
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
            <button onClick={handleLogout} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.4)', padding:4, cursor:'pointer' }} title="Logout">
              <LogOut size={15} />
            </button>
          </div>
          <div style={{ marginTop:10, fontSize:10, color:'rgba(255,255,255,0.2)', textAlign:'center' }}>
            built by muntasir
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
