import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import AlertBanner from '../components/AlertBanner'
import PasswordField from '../components/PasswordField'
import PrimaryButton from '../components/PrimaryButton'
import { supabase } from '../lib/supabaseClient'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true)
      }
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  function validate() {
    const errors = {}
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
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    navigate('/login', { state: { message: 'Password updated. Please sign in.' } })
  }

  if (!ready) {
    return (
      <AuthLayout title="Reset password" subtitle="Verifying your reset link..." leftPanelImage="/image.png">
        <div className="flex justify-center py-4">
          <div className="animate-spin h-8 w-8 rounded-full border-4 border-brand-blue/30 border-t-brand-blue" />
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Set a new password" subtitle="Choose a strong password for your account" leftPanelImage="/image.png">
      <AlertBanner type="error">{error}</AlertBanner>

      <form onSubmit={handleSubmit} noValidate>
        <PasswordField
          label="New password"
          id="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          error={fieldErrors.password}
        />

        <PasswordField
          label="Confirm new password"
          id="confirmPassword"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter your password"
          autoComplete="new-password"
          error={fieldErrors.confirmPassword}
        />

        <PrimaryButton loading={loading}>Update password</PrimaryButton>
      </form>
    </AuthLayout>
  )
}
