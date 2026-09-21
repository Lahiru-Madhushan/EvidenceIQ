import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute() {
  const { user, loading, signingOut } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg">
        <div className="animate-spin h-8 w-8 rounded-full border-4 border-brand-blue/30 border-t-brand-blue" />
      </div>
    )
  }

  // Where an unauthenticated visitor belongs depends on how they got here. Someone who
  // deep-linked into a protected page wants /login - they are trying to get in. Someone
  // who just pressed Sign out does not: putting them on a sign-in form is asking them
  // to undo what they asked for. This redirect is the only one that fires on sign-out,
  // so choosing its destination is enough - see signOut in AuthContext.
  if (!user) {
    return <Navigate to={signingOut ? '/' : '/login'} replace />
  }

  return <Outlet />
}
