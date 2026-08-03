import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { LayoutDashboard, Upload, CheckSquare, Image, Shield, LogOut, ChevronRight } from 'lucide-react'
import { APP_VERSION } from '../version'

export default function Layout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const onProd   = location.pathname.startsWith('/production')
  const onGov    = location.pathname.startsWith('/governance')

  const handleLogout = () => { signOut(); navigate('/login') }

  const navItem = (to, Icon, label, soon, end = false) => (
    <NavLink key={to} to={to} end={end} className="sb-item"
      style={({ isActive }) => ({
        display:'flex', alignItems:'center', gap:11,
        margin:'2px 10px', padding:'10px 13px',
        borderRadius:10,
        color: isActive ? '#fff' : 'rgba(255,255,255,0.6)',
        background: isActive
          ? 'linear-gradient(135deg, rgba(99,102,241,0.85), rgba(124,58,237,0.75))'
          : 'transparent',
        boxShadow: isActive ? '0 4px 14px rgba(99,102,241,0.35)' : 'none',
        fontSize:13, fontWeight: isActive ? 600 : 500,
        textDecoration:'none',
        pointerEvents: soon ? 'none' : 'auto',
        transition:'all 0.18s ease',
      })}
    >
      <Icon size={16} />
      <span style={{ flex:1 }}>{label}</span>
      {soon && <span style={{ fontSize:10, background:'rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.4)', padding:'1px 6px', borderRadius:4 }}>Soon</span>}
    </NavLink>
  )

  const subItem = (to, label) => (
    <NavLink key={to} to={to} className="sb-sub"
      style={({ isActive }) => ({
        display:'flex', alignItems:'center', gap:8,
        margin:'1px 10px 1px 26px', padding:'7px 12px',
        borderRadius:8,
        color: isActive ? '#c7d2fe' : 'rgba(255,255,255,0.42)',
        background: isActive ? 'rgba(99,102,241,0.22)' : 'transparent',
        fontSize:12, fontWeight: isActive ? 600 : 400,
        textDecoration:'none', transition:'all 0.18s ease',
      })}
    >
      <ChevronRight size={11} />
      {label}
    </NavLink>
  )

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      {/* Sidebar — fixed height, always fully visible */}
      <aside style={{
        width:224, height:'100vh', flexShrink:0,
        background:'linear-gradient(180deg, #1e1b4b 0%, #251f5c 55%, #2b1e63 100%)',
        display:'flex', flexDirection:'column', overflowY:'auto',
        boxShadow:'4px 0 24px rgba(30,27,75,0.25)',
      }}>
        {/* Logo */}
        <div style={{ padding:'22px 20px 16px', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
          <img
            src="https://cartup.com/new/cartup-logo-voucher.svg"
            alt="CartUp"
            style={{ height:32, display:'block', marginBottom:7 }}
          />
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.45)', letterSpacing:'0.3px' }}>Catalog Team Platform</div>
        </div>

        {/* Nav */}
        <nav className="sb-nav" style={{ flex:1, padding:'14px 0' }}>
          {navItem('/', LayoutDashboard, 'Dashboard', false, true)}
          {navItem('/production', Upload, 'Production')}
          {onProd && (
            <>
              {subItem('/production/daraz',  'Daraz Upload')}
              {subItem('/production/manual', 'Manual Upload')}
            </>
          )}
          {navItem('/visual',     Image,       'Visual',     false)}
          {navItem('/qc',         CheckSquare, 'QC',         false)}
          {navItem('/governance', Shield,      'Governance', false)}
          {onGov && (
            <>
              {subItem('/governance/checks',  'Auto Checks')}
              {subItem('/governance/dataviz', 'Data Viz')}
            </>
          )}
        </nav>

        {/* Sidebar footer */}
        <div style={{ padding:'14px 20px 16px', borderTop:'1px solid rgba(255,255,255,0.08)', textAlign:'center' }}>
          <div className="sb-credit">built by muntasir</div>
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.25)', fontFamily:'monospace', marginTop:3 }}>v{APP_VERSION}</div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex:1, height:'100vh', overflow:'auto', display:'flex', flexDirection:'column' }}>
        {/* Top bar */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'flex-end',
          padding:'10px 24px', borderBottom:'1px solid rgba(226,232,240,0.8)',
          background:'rgba(255,255,255,0.85)', backdropFilter:'blur(10px)',
          gap:12, flexShrink:0, position:'sticky', top:0, zIndex:20,
        }}>
          <NavLink to="/profile" className="tb-profile"
            style={({ isActive }) => ({
              display:'flex', alignItems:'center', gap:8,
              padding:'4px 10px 4px 4px', borderRadius:99,
              textDecoration:'none', fontSize:12,
              background: isActive ? '#eef2ff' : 'transparent',
              transition:'background 0.15s ease',
            })}
          >
            <div style={{
              width:32, height:32, borderRadius:'50%',
              background:'linear-gradient(135deg, #4f46e5, #7c3aed)',
              display:'flex', alignItems:'center', justifyContent:'center',
              color:'#fff', fontWeight:700, fontSize:13, flexShrink:0,
              boxShadow:'0 2px 8px rgba(79,70,229,0.35)',
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
          <button onClick={handleLogout} title="Logout" className="tb-logout"
            style={{ background:'none', border:'1px solid #e2e8f0', borderRadius:9, color:'#94a3b8', padding:'7px 9px', cursor:'pointer', display:'flex', alignItems:'center' }}>
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
        .sb-nav .sb-item:hover {
          color: #fff !important;
          background: rgba(99, 102, 241, 0.3) !important;
          transform: translateX(3px);
        }
        .sb-nav .sb-sub:hover {
          color: #e0e7ff !important;
          background: rgba(99, 102, 241, 0.18) !important;
          transform: translateX(3px);
        }
        .tb-profile:hover { background: #eef2ff !important; }
        .tb-logout:hover { color: #dc2626 !important; border-color: #fecaca !important; background: #fef2f2 !important; }
      `}</style>
    </div>
  )
}
