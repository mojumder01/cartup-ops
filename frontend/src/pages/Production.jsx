import { NavLink, Outlet } from 'react-router-dom'

export default function Production() {
  return (
    <div style={{ padding:'32px 36px', maxWidth:860 }}>
      {/* Header */}
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:20, fontWeight:700, color:'#1a202c' }}>Production — Upload</h1>
        <p style={{ color:'#718096', marginTop:4, fontSize:13 }}>Process product files into CartUp template format.</p>
      </div>

      {/* Sub-tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:24, background:'#f1f5f9', borderRadius:10, padding:4, width:'fit-content' }}>
        {[
          { to: '/production/daraz',  label: 'Daraz Upload' },
          { to: '/production/manual', label: 'Manual Upload' },
        ].map(({ to, label }) => (
          <NavLink key={to} to={to}
            style={({ isActive }) => ({
              padding:'7px 20px', borderRadius:7, fontSize:13, fontWeight:600,
              textDecoration:'none',
              background: isActive ? '#fff' : 'transparent',
              color: isActive ? '#4f46e5' : '#718096',
              boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              transition:'all 0.15s',
            })}
          >
            {label}
          </NavLink>
        ))}
      </div>

      {/* Child route renders here */}
      <Outlet />
    </div>
  )
}
