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
      leftPanelImage="/image.png"
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link to="/register" className="text-brand-blue font-medium hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <AlertBanner type="error">{error}</AlertBanner>
      <AlertBanner type="success">{info}</AlertBanner>

      <GoogleButton onClick={handleGoogleLogin} loading={googleLoading} />

      <div className="flex items-center gap-3 my-6">
        <div className="h-px flex-1 bg-neutral-200" />
        <span className="text-xs text-neutral-400">OR</span>
        <div className="h-px flex-1 bg-neutral-200" />
      </div>

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

        <div className="flex justify-end mb-6 -mt-2">
          <Link to="/forgot-password" className="text-sm text-brand-blue hover:underline">
            Forgot password?
          </Link>
        </div>

        <PrimaryButton loading={loading}>Sign in</PrimaryButton>
      </form>
    </AuthLayout>
  )
}
