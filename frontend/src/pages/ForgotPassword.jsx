import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import AuthLayout from '../components/AuthLayout'
import AlertBanner from '../components/AlertBanner'
import FormField, { TextInput } from '../components/FormField'
import PrimaryButton from '../components/PrimaryButton'
import { supabase } from '../lib/supabaseClient'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setSent(true)
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="We'll email you a link to reset it"
      leftPanelImage="/image.png"
      footer={
        <>
          Remembered it?{' '}
          <Link to="/login" className="text-brand-blue font-medium hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      <AlertBanner type="error">{error}</AlertBanner>

      {sent ? (
        <AlertBanner type="success">
          If an account exists for {email}, a password reset link is on its way.
        </AlertBanner>
      ) : (
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

          <PrimaryButton loading={loading}>Send reset link</PrimaryButton>
        </form>
      )}
    </AuthLayout>
  )
}
