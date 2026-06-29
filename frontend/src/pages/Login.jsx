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

  const inputStyle = {
    width:'100%', padding:'10px 14px',
    border:'1.5px solid #e2e8f0', borderRadius:'8px',
    outline:'none', fontSize:'14px', transition:'border 0.15s',
  }

  return (
    <div style={{
      minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
    }}>
      <div style={{
        background:'#fff', borderRadius:'16px', padding:'40px 36px',
        width:'100%', maxWidth:'400px', boxShadow:'0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{ textAlign:'center', marginBottom:'32px' }}>
          <div style={{ fontSize:'28px', fontWeight:'800', color:'#1e1b4b' }}>
            CartUp <span style={{ color:'#6366f1' }}>Ops</span>
          </div>
          <div style={{ color:'#718096', fontSize:'13px', marginTop:'4px' }}>Team Operations Platform</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom:'16px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#718096', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.5px' }}>
              Email
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com" required style={inputStyle}
              onFocus={e => e.target.style.borderColor='#6366f1'}
              onBlur={e => e.target.style.borderColor='#e2e8f0'}
            />
          </div>

          <div style={{ marginBottom:'24px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#718096', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.5px' }}>
              Password
            </label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required style={inputStyle}
              onFocus={e => e.target.style.borderColor='#6366f1'}
              onBlur={e => e.target.style.borderColor='#e2e8f0'}
            />
          </div>

          {error && (
            <div style={{ background:'#fee2e2', color:'#dc2626', padding:'10px 14px', borderRadius:'8px', fontSize:'13px', marginBottom:'16px' }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              width:'100%', padding:'12px',
              background: loading ? '#a5b4fc' : '#4f46e5',
              color:'#fff', border:'none', borderRadius:'8px',
              fontWeight:'600', fontSize:'15px', cursor: loading ? 'not-allowed' : 'pointer',
              transition:'background 0.15s',
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
