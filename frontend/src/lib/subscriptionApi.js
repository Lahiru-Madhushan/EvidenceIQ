/**
 * The signed-in researcher's subscription.
 *
 * Through the backend rather than Supabase directly: the subscriptions table has RLS on
 * with no policies, so the browser cannot write its own plan. Only the API can, scoped
 * to the caller's token.
 */

import { useCallback, useEffect, useState } from 'react'

import { planById } from './plans'
import { supabase } from './supabaseClient'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:8000'

async function request(method, body) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Please log in again — your session expired.')

  let response
  try {
    response = await fetch(`${API_BASE_URL}/api/subscription`, {
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
  return request('GET')
}

/** Move to `planId`, billed `billing` ("monthly" or "annual"). Returns the saved row. */
export function changeSubscription(planId, billing) {
  return request('PUT', { plan_id: planId, billing })
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

  return { subscription, plan: planById(subscription?.plan_id), loading, error, change }
}
