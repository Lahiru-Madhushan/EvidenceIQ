import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(undefined)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setLoading(false)
      // Signing back in ends the sign-out, and is the only thing that does. Clearing
      // the flag on a timer or straight after signOut() resolves reintroduces the race
      // it exists to remove.
      if (session) setSigningOut(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  /**
   * Sign out, and land on the landing page rather than the sign-in page.
   *
   * This does not navigate. ProtectedRoute is going to redirect the moment the session
   * clears, and no navigation issued from here can reliably beat it: react-router runs
   * navigation inside a transition, so an urgent state update - even one meant to hold
   * the redirect back - commits first and the redirect fires anyway. Trying to win that
   * race is what produced the trail /quick-chat -> / -> /login.
   *
   * So the redirect is steered instead of outrun. `signingOut` tells ProtectedRoute
   * that this is a deliberate sign-out and not an unauthenticated deep link, and it
   * sends the user home instead of to /login. Whoever is already redirecting decides
   * where to, which means there is only ever one navigation and nothing to race.
   */
  const signOut = useCallback(async () => {
    setSigningOut(true)
    return supabase.auth.signOut()
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    signingOut,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
