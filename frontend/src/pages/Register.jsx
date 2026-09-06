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
      title="Create your account"
      subtitle="Start screening your systematic review literature"
      leftPanelImage="/image.png"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-brand-blue font-medium hover:underline">
            Sign in
          </Link>
        </>
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

      <GoogleButton onClick={handleGoogleSignup} loading={googleLoading} />

      <div className="flex items-center gap-3 my-6">
        <div className="h-px flex-1 bg-neutral-200" />
        <span className="text-xs text-neutral-400">OR</span>
        <div className="h-px flex-1 bg-neutral-200" />
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <FormField label="Full name" id="name" error={fieldErrors.name}>
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

        <FormField label="Email address" id="email" error={fieldErrors.email}>
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
        />

        <PasswordField
          label="Confirm password"
          id="confirmPassword"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter your password"
          autoComplete="new-password"
          error={fieldErrors.confirmPassword}
        />

        <PrimaryButton loading={loading}>Create account</PrimaryButton>
      </form>
    </AuthLayout>
  )
}
