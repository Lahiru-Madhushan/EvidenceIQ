import { Construction, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Home() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const name = user?.user_metadata?.full_name || user?.email

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      <header className="flex items-center justify-between px-6 sm:px-10 py-4 border-b border-neutral-100">
        <img src="/logo.png" alt="EvidenceIQ" className="h-9 w-auto" />
        <button
          onClick={handleSignOut}
          className="text-sm font-medium text-brand-black hover:text-brand-blue transition-colors"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="relative inline-flex items-center justify-center w-24 h-24 mb-6">
            <Loader2 className="absolute inset-0 w-24 h-24 text-brand-blue/25 animate-spin" strokeWidth={1.5} />
            <Construction className="w-10 h-10 text-brand-blue" strokeWidth={1.8} />
          </div>

          <h1 className="text-2xl font-semibold text-brand-black mb-2">
            Dashboard under construction
          </h1>
          <p className="text-neutral-500">
            Welcome, {name}. Your systematic review workspace is being built —
            check back soon.
          </p>
        </div>
      </main>
    </div>
  )
}
