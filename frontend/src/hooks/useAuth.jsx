import { createContext, useContext, useState, useEffect } from 'react'
import { getMe } from '../utils/api'

const AuthContext = createContext(null)

const USER_KEY = 'user'
const readUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { return null } }
const sleep = ms => new Promise(r => setTimeout(r, ms))

export function AuthProvider({ children }) {
  const [user, setUser]   = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem('token'))
  const [loading, setLoading] = useState(true)
  const [waking, setWaking]   = useState(false)   // the server is waking up (Render sleeps when idle)

  useEffect(() => {
    if (!token) { setLoading(false); return }
    let live = true
    ;(async () => {
      // The server may be asleep: try for about a minute before falling back.
      for (let attempt = 0; attempt < 6 && live; attempt++) {
        try {
          const u = await getMe(token)
          if (!live) return
          setUser(u)
          try { localStorage.setItem(USER_KEY, JSON.stringify(u)) } catch { /* storage unavailable */ }
          setWaking(false); setLoading(false)
          return
        } catch (e) {
          if (!live) return
          if (e.message === 'UNAUTHORIZED') {
            setToken(null); localStorage.removeItem('token'); localStorage.removeItem(USER_KEY)
            setWaking(false); setLoading(false)
            return
          }
          setWaking(true)
          // The pages work in the browser: with a saved profile, open them now and keep checking quietly.
          const saved = readUser()
          if (saved && attempt === 0) { setUser(saved); setLoading(false) }
          await sleep(10000)
        }
      }
      if (!live) return
      const saved = readUser()
      if (saved) setUser(saved)
      else { setToken(null); localStorage.removeItem('token') }
      setWaking(false); setLoading(false)
    })()
    return () => { live = false }
  }, [token])

  const signIn = (userData, accessToken) => {
    localStorage.setItem('token', accessToken)
    try { localStorage.setItem(USER_KEY, JSON.stringify(userData)) } catch { /* storage unavailable */ }
    setToken(accessToken)
    setUser(userData)
  }

  const signOut = () => {
    localStorage.removeItem('token')
    localStorage.removeItem(USER_KEY)
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, waking, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
