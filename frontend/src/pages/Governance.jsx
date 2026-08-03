import { NavLink, Outlet } from 'react-router-dom'
import { Shield } from 'lucide-react'

export default function Governance() {
  return (
    <div style={{ padding:'20px 32px 32px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
        <Shield size={20} color='#4f46e5'/>
        <div>
          <h1 style={{ fontSize:17, fontWeight:700, color:'#1a202c', margin:0 }}>Governance</h1>
          <p style={{ fontSize:12, color:'#718096', margin:0 }}>Content revamp checks &amp; ad-hoc data visualization</p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:22, background:'#f1f5f9', borderRadius:10, padding:4, width:'fit-content' }}>
        {[
          { to: '/governance/checks',  label: 'Auto Checks' },
          { to: '/governance/dataviz', label: 'Data Viz' },
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
