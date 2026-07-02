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
    width:'100%', padding:'11px 14px',
    border:'1.5px solid #e2e8f0', borderRadius:'10px',
    outline:'none', fontSize:'14px', background:'#fafbfc',
  }

  return (
    <div className="login-bg" style={{
      minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      position:'relative', overflow:'hidden',
    }}>
      {/* floating orbs */}
      <div className="orb orb-1"/>
      <div className="orb orb-2"/>
      <div className="orb orb-3"/>

      <div className="login-card" style={{
        background:'rgba(255,255,255,0.96)', borderRadius:'20px', padding:'42px 38px',
        width:'100%', maxWidth:'410px', position:'relative', zIndex:2,
        boxShadow:'0 24px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1)',
        backdropFilter:'blur(12px)',
      }}>
        <div style={{ textAlign:'center', marginBottom:'30px' }}>
          <img
            src="https://cartup.com/new/cartup-logo-voucher.svg"
            alt="CartUp"
            style={{ height:40, display:'block', margin:'0 auto 10px' }}
          />
          <div style={{ fontSize:'20px', fontWeight:'800', color:'#1e1b4b', letterSpacing:'-0.3px' }}>
            CartUp <span style={{
              background:'linear-gradient(90deg, #4f46e5, #a855f7)',
              WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
            }}>Ops</span>
          </div>
          <div style={{ color:'#718096', fontSize:'13px', marginTop:'2px' }}>Catalog Team Platform</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom:'16px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#718096', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.5px' }}>
              Email
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com" required style={inputStyle}
            />
          </div>

          <div style={{ marginBottom:'24px' }}>
            <label style={{ display:'block', fontSize:'12px', fontWeight:'600', color:'#718096', marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.5px' }}>
              Password
            </label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required style={inputStyle}
            />
          </div>

          {error && (
            <div className="anim-pop" style={{ background:'#fee2e2', color:'#dc2626', padding:'10px 14px', borderRadius:'10px', fontSize:'13px', marginBottom:'16px' }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              width:'100%', padding:'13px',
              background: loading
                ? '#a5b4fc'
                : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              color:'#fff', border:'none', borderRadius:'10px',
              fontWeight:'700', fontSize:'15px', cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow:'0 8px 24px rgba(79,70,229,0.4)',
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div style={{ textAlign:'center', marginTop:'22px', fontSize:'11px', color:'#a0aec0' }}>
          built by muntasir
        </div>
      </div>

      <style>{`
        .login-bg {
          background: linear-gradient(-45deg, #1e1b4b, #312e81, #3b1e6e, #1e1b4b);
          background-size: 300% 300%;
          animation: gradientShift 12s ease infinite;
        }
        @keyframes gradientShift {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .login-card { animation: popIn 0.4s ease both; }
        .orb {
          position: absolute; border-radius: 50%; filter: blur(60px); opacity: 0.35; z-index: 1;
          animation: float 9s ease-in-out infinite;
        }
        .orb-1 { width: 340px; height: 340px; background: #6366f1; top: -80px; left: -60px; }
        .orb-2 { width: 260px; height: 260px; background: #a855f7; bottom: -60px; right: -40px; animation-delay: -3s; }
        .orb-3 { width: 180px; height: 180px; background: #ec4899; top: 55%; left: 12%; animation-delay: -6s; }
        @keyframes float {
          0%, 100% { transform: translateY(0) scale(1); }
          50%      { transform: translateY(-28px) scale(1.06); }
        }
      `}</style>
    </div>
  )
}
