import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Production from './pages/Production'
import DarazUpload from './pages/DarazUpload'
import ManualUpload from './pages/ManualUpload'
import Profile from './pages/Profile'
import Visual from './pages/Visual'
import QC from './pages/QC'
import Governance from './pages/Governance'
import GovernanceChecks from './pages/GovernanceChecks'
import GovernanceDataViz from './pages/GovernanceDataViz'
import Layout from './components/Layout'

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text-muted)' }}>Loading...</div>
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="production" element={<Production />}>
          <Route index element={<Navigate to="daraz" replace />} />
          <Route path="daraz"  element={<DarazUpload />} />
          <Route path="manual" element={<ManualUpload />} />
        </Route>
        <Route path="visual"      element={<Visual />} />
        <Route path="qc"          element={<QC />} />
        <Route path="governance"  element={<Governance />}>
          <Route index element={<Navigate to="checks" replace />} />
          <Route path="checks"  element={<GovernanceChecks />} />
          <Route path="dataviz" element={<GovernanceDataViz />} />
        </Route>
        <Route path="profile" element={<Profile />} />
      </Route>
    </Routes>
  )
}
