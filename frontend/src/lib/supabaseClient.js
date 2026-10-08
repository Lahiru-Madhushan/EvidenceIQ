import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

// Waits before each retry of a "JWT issued at future" rejection: about 7s in all.
const IAT_RETRY_DELAYS_MS = [1000, 2000, 4000]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function isIssuedInFuture(response) {
  if (response.status !== 401) return false
  try {
    const body = await response.clone().json()
    return /issued at future/i.test(body?.message ?? '')
  } catch {
    return false
  }
}

/**
 * fetch, but patient with a token that is newer than the database's clock.
 *
 * Opening the app often refreshes the session, and the fresh token's `iat` is stamped
 * by Supabase Auth. The database API checks that claim against its own clock, and when
 * that clock trails Auth's by a moment it rejects the token as "issued at future" - the
 * dashboard then showed "Could not load your paper counts" although nothing was wrong.
 * The same token is accepted once the database's clock catches up, so the request is
 * simply sent again after a short wait. Nothing ran on a rejected request, so this is
 * safe for writes too, and any other error is returned untouched on the first try.
 */
async function fetchWithClockSkewRetry(input, init) {
  let response = await fetch(input, init)
  for (const delay of IAT_RETRY_DELAYS_MS) {
    if (!(await isIssuedInFuture(response))) break
    await sleep(delay)
    response = await fetch(input, init)
  }
  return response
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithClockSkewRetry },
})
