import { supabase } from './supabaseClient'

const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'

export async function searchPapers(searchData) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) {
    throw new Error('Unable to verify your login session.')
  }

  if (!session?.access_token) {
    throw new Error('Please log in before searching for papers.')
  }

  const response = await fetch(
    `${API_BASE_URL}/api/retrieval/search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(searchData),
    },
  )

  let data

  try {
    data = await response.json()
  } catch {
    throw new Error('The backend returned an invalid response.')
  }

  if (!response.ok) {
    const message =
      typeof data.detail === 'string'
        ? data.detail
        : 'Unable to retrieve papers.'

    throw new Error(message)
  }

  return data
}