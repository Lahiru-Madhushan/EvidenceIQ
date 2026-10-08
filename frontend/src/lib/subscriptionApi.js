/**
 * The signed-in researcher's subscription, and paying for it.
 *
 * Through the backend rather than Supabase directly: the subscriptions and payments
 * tables have RLS on with no policies, so the browser cannot write its own plan or a
 * payment. Only the API can, scoped to the caller's token - and a paid plan only once
 * Stripe has confirmed the payment to the backend directly.
 */

import { useCallback, useEffect, useState } from 'react'

import { planById } from './plans'
import { supabase } from './supabaseClient'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:8000'

async function request(path, method, body) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Please log in again — your session expired.')

  let response
  try {
    response = await fetch(`${API_BASE_URL}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error(`Cannot reach the EvidenceIQ backend at ${API_BASE_URL}.`)
  }

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(typeof data?.detail === 'string' ? data.detail : 'The request failed.')
  }
  return data
}

export function getSubscription() {
  return request('/subscription', 'GET')
}

/**
 * Move to Free. Paid plans cannot be chosen this way - the backend answers 402 - they
 * are bought with startCheckout.
 */
export function changeSubscription(planId, billing) {
  return request('/subscription', 'PUT', { plan_id: planId, billing })
}

/** Open a Stripe checkout for a paid plan. Resolves to `{ payment_id, checkout_url }`. */
export function startCheckout(planId, billing) {
  return request('/payments/checkout', 'POST', { plan_id: planId, billing })
}

/**
 * After Stripe redirects back: ask the backend to check the session with Stripe.
 * Resolves to `{ payment, subscription }`; the plan has changed only if
 * `payment.status === 'paid'`.
 */
export function confirmCheckout(sessionId) {
  return request('/payments/confirm', 'POST', { session_id: sessionId })
}

/** The researcher came back from Stripe without paying. */
export function cancelCheckout(paymentId) {
  return request(`/payments/${encodeURIComponent(paymentId)}/cancel`, 'POST')
}

/** Every payment this account has started, newest first. */
export function listPayments() {
  return request('/payments', 'GET')
}

/**
 * The current subscription and the plan it names.
 *
 * `plan` is Free until the request answers - which is also what an account that never
 * chose a plan is on - so a page can render immediately without a flash of nothing.
 */
export function useSubscription() {
  const [subscription, setSubscription] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getSubscription()
      .then((data) => {
        if (!cancelled) setSubscription(data)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const change = useCallback(async (planId, billing) => {
    const saved = await changeSubscription(planId, billing)
    setSubscription(saved)
    setError(null)
    return saved
  }, [])

  // For a subscription the caller already holds, such as the one a confirmed checkout
  // returns, so the page updates without another round trip.
  const replace = useCallback((saved) => {
    setSubscription(saved)
    setError(null)
  }, [])

  return { subscription, plan: planById(subscription?.plan_id), loading, error, change, replace }
}
