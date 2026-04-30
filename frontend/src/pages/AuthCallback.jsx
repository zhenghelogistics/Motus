import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    // Exchange the code in the URL for a session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        setError(error.message)
      } else if (session) {
        navigate('/', { replace: true })
      }
    })

    // Also listen in case the exchange fires async
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        navigate('/', { replace: true })
      }
    })

    return () => subscription.unsubscribe()
  }, [navigate])

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #042C53 0%, #185FA5 100%)',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '40px 36px', width: '100%', maxWidth: 360,
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)', textAlign: 'center',
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 56, height: 56, borderRadius: 14, background: '#042C53',
          fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: '-1px', marginBottom: 16,
        }}>ZHL</div>

        {error ? (
          <>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#991B1B', marginBottom: 8 }}>
              Verification failed
            </div>
            <div style={{ fontSize: 13, color: '#6B7E93', marginBottom: 20 }}>{error}</div>
            <a href="/" style={{ fontSize: 13, color: '#042C53', fontWeight: 700 }}>Back to sign in</a>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <span className="spinner" style={{ width: 28, height: 28, borderColor: 'rgba(4,44,83,0.2)', borderTopColor: '#042C53' }}></span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#042C53', marginBottom: 6 }}>
              Verifying your email...
            </div>
            <div style={{ fontSize: 13, color: '#6B7E93' }}>You'll be signed in automatically.</div>
          </>
        )}
      </div>
    </div>
  )
}
