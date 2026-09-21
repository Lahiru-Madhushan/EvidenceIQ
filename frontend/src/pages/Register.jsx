import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { User, Mail } from 'lucide-react'
import AuthLayout from '../components/AuthLayout'
import AlertBanner from '../components/AlertBanner'
import FormField, { TextInput } from '../components/FormField'
import PasswordField from '../components/PasswordField'
import PrimaryButton from '../components/PrimaryButton'
import GoogleButton from '../components/GoogleButton'
import { supabase } from '../lib/supabaseClient'

export default function Register() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  function validate() {
    const errors = {}
    if (!name.trim()) errors.name = 'Full name is required'
    if (!email.trim()) errors.email = 'Email is required'
    if (password.length < 8) errors.password = 'Password must be at least 8 characters'
    if (confirmPassword !== password) errors.confirmPassword = 'Passwords do not match'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!validate()) return

    setLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
      },
    })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setError('An account with this email already exists. Try signing in instead.')
      return
    }

    navigate('/verify-email', { state: { email } })
  }

  async function handleGoogleSignup() {
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
      wide
      title="Create your account"
      subtitle="Start screening your systematic review literature"
      footer={
        <span className="flex items-center gap-3">
          <span className="hidden sm:inline">Already have an account?</span>
          <Link to="/login" className="rounded-full bg-blue-50 px-4 py-2 text-sm font-semibold text-brand-blue transition-colors hover:bg-blue-100">
            Sign in
          </Link>
        </span>
      }
      legalFooter={
        <>
          By creating an account, you agree to our{' '}
          <a href="#" className="text-brand-blue hover:underline">Terms of Service</a> and{' '}
          <a href="#" className="text-brand-blue hover:underline">Privacy Policy</a>.
        </>
      }
    >
      <AlertBanner type="error">{error}</AlertBanner>

      {/* Paired into two columns, and each field drops its own bottom margin so the
          grid gap owns the spacing. Stacked, these four rows made the card taller than
          a 768px laptop's viewport, and this page is meant not to scroll. */}
      <form onSubmit={handleSubmit} noValidate>
        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          <FormField label="Full name" id="name" error={fieldErrors.name} className="mb-0">
            <TextInput
              id="name"
              icon={User}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dr. Amara Silva"
              autoComplete="name"
              error={fieldErrors.name}
            />
          </FormField>

          <FormField label="Email address" id="email" error={fieldErrors.email} className="mb-0">
            <TextInput
              id="email"
              type="email"
              icon={Mail}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              error={fieldErrors.email}
            />
          </FormField>

          <PasswordField
            label="Password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            error={fieldErrors.password}
            className="mb-0"
          />

          <PasswordField
            label="Confirm password"
            id="confirmPassword"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            autoComplete="new-password"
            error={fieldErrors.confirmPassword}
            className="mb-0"
          />
        </div>

        <div className="mt-5">
          <PrimaryButton loading={loading}>Create account</PrimaryButton>
        </div>
      </form>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-neutral-200" />
        <span className="text-xs text-neutral-400">OR</span>
        <div className="h-px flex-1 bg-neutral-200" />
      </div>

      <GoogleButton onClick={handleGoogleSignup} loading={googleLoading} />
    </AuthLayout>
  )
}
