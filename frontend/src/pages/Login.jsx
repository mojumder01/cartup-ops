import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { login } from '../utils/api'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const { signIn } = useAuth()
  const navigate   = useNavigate()

  const handleSubmit = async e => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const data = await login(email, password)
      signIn(data.user, data.access_token)
      navigate('/')
    } catch {
      setError('Email or password incorrect')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
    }}>
      <div style={{
        background:'#fff', borderRadius:16, padding:'40px 36px',
        width:'100%', maxWidth:400, boxShadow:'0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Logo */}
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ fontSize:28, fontWeight:800, color:'#1e1b4b' }}>
            CartUp <span style={{ color:'#6366f1' }}>Ops</span>
          </div>
          <div style={{ color:'var(--text-muted)', fontSize:13, marginTop:4 }}>Team Operations Platform</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom:16 }}>
            <label style={{ display:'block', fontSize:12, fontWeight:600, color:'var(--text-muted)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com" required
              style={{
                width:'100%', padding:'10px 14px', border:'1.5px solid var(--border)',
                borderRadius:var(--radius), outline:'none', transition:'border 0.15s',
                fontSize:14,
              }}
              onFocus={e => e.target.style.borderColor='#6366f1'}
              onBlur={e => e.target.style.borderColor='var(--border)'}
            />
          </div>

          <div style={{ marginBottom:24 }}>
            <label style={{ display:'block', fontSize:12, fontWeight:600, color:'var(--text-muted)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required
              style={{
                width:'100%', padding:'10px 14px', border:'1.5px solid var(--border)',
                borderRadius:var(--radius), outline:'none', transition:'border 0.15s',
                fontSize:14,
              }}
              onFocus={e => e.target.style.borderColor='#6366f1'}
              onBlur={e => e.target.style.borderColor='var(--border)'}
            />
          </div>

          {error && (
            <div style={{ background:'var(--danger-light)', color:'var(--danger)', padding:'10px 14px', borderRadius:var(--radius), fontSize:13, marginBottom:16 }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              width:'100%', padding:'12px', background: loading ? '#a5b4fc' : '#4f46e5',
              color:'#fff', border:'none', borderRadius:var(--radius),
              fontWeight:600, fontSize:15, transition:'background 0.15s',
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
