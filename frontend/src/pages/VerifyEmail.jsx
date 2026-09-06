import { useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import AlertBanner from '../components/AlertBanner'
import FormField, { TextInput } from '../components/FormField'
import PrimaryButton from '../components/PrimaryButton'
import { supabase } from '../lib/supabaseClient'

// Must match the "Email OTP Length" configured in Supabase Dashboard
// (Authentication -> Providers -> Email).
const CODE_LENGTH = 8

export default function VerifyEmail() {
  const location = useLocation()
  const navigate = useNavigate()
  const emailFromState = location.state?.email || ''

  const [email] = useState(emailFromState)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [resendMessage, setResendMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setResendMessage('')
    setLoading(true)

    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'signup',
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    navigate('/dashboard')
  }

  async function handleResend() {
    setError('')
    setResendMessage('')
    setResending(true)

    const { error } = await supabase.auth.resend({ type: 'signup', email })

    setResending(false)

    if (error) {
      setError(error.message)
      return
    }

    setResendMessage('A new verification code has been sent to your email.')
  }

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={email ? `Enter the ${CODE_LENGTH}-digit code sent to ${email}` : `Enter the ${CODE_LENGTH}-digit code we sent you`}
      footer={
        <>
          Wrong email?{' '}
          <Link to="/register" className="text-brand-blue font-medium hover:underline">
            Go back
          </Link>
        </>
      }
    >
      <AlertBanner type="error">{error}</AlertBanner>
      <AlertBanner type="success">{resendMessage}</AlertBanner>

      <form onSubmit={handleSubmit}>
        <FormField label="Verification code" id="code">
          <TextInput
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
            placeholder={'0'.repeat(CODE_LENGTH)}
            inputMode="numeric"
            maxLength={CODE_LENGTH}
            className="text-center tracking-[0.4em] text-lg"
            required
          />
        </FormField>

        <PrimaryButton loading={loading} disabled={code.length !== CODE_LENGTH}>
          Verify email
        </PrimaryButton>
      </form>

      <button
        type="button"
        onClick={handleResend}
        disabled={resending}
        className="w-full mt-4 text-sm text-brand-blue hover:underline disabled:opacity-60"
      >
        {resending ? 'Sending...' : "Didn't get a code? Resend"}
      </button>
    </AuthLayout>
  )
}
