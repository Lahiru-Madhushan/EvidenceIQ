import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
import AuthLayout from '../components/AuthLayout'
import AlertBanner from '../components/AlertBanner'
import { TextInput } from '../components/FormField'
import FormField from '../components/FormField'
import PasswordField from '../components/PasswordField'
import PrimaryButton from '../components/PrimaryButton'
import GoogleButton from '../components/GoogleButton'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [info] = useState(location.state?.message || '')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)

    if (error) {
      if (error.message.toLowerCase().includes('email not confirmed')) {
        navigate('/verify-email', { state: { email } })
        return
      }
      setError(error.message)
      return
    }

    navigate('/dashboard')
  }

  async function handleGoogleLogin() {
    setError('')
    setGoogleLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setError(error.message)
      setGoogleLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue to EvidenceIQ"
      footer={
        <span className="flex items-center gap-3">
          <span className="hidden sm:inline">New to EvidenceIQ?</span>
          <Link to="/register" className="rounded-full bg-blue-50 px-4 py-2 text-sm font-semibold text-brand-blue transition-colors hover:bg-blue-100">
            Create an account
          </Link>
        </span>
      }
    >
      <AlertBanner type="error">{error}</AlertBanner>
      <AlertBanner type="success">{info}</AlertBanner>

      {/* The password form comes first: it is what a returning user is here for, and
          burying it under the social button makes them read past their own path. */}
      <form onSubmit={handleSubmit}>
        <FormField label="Email address" id="email">
          <TextInput
            id="email"
            type="email"
            icon={Mail}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </FormField>

        <PasswordField
          label="Password"
          id="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
        />

        <div className="flex justify-end mb-5 -mt-3">
          <Link to="/forgot-password" className="text-sm text-brand-blue hover:underline">
            Forgot password?
          </Link>
        </div>

        <PrimaryButton loading={loading}>Sign in</PrimaryButton>
      </form>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-neutral-200" />
        <span className="text-xs text-neutral-400">OR</span>
        <div className="h-px flex-1 bg-neutral-200" />
      </div>

      <GoogleButton onClick={handleGoogleLogin} loading={googleLoading} />
    </AuthLayout>
  )
}
