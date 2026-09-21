/**
 * Quick Chat: upload a document, ask questions about it, keep the thread.
 *
 * These go through the backend rather than Supabase directly, because only the backend
 * can read a PDF and only it holds the model credentials. The chat tables carry RLS
 * policies too, but the ownership check that actually runs is the one in the router.
 */

import { supabase } from './supabaseClient'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:8000'

async function token() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()

  if (error) throw new Error('Unable to verify your login session.')
  if (!session?.access_token) throw new Error('Please log in again — your session expired.')
  return session.access_token
}

async function request(path, { method = 'GET', body, json = true } = {}) {
  const headers = { Authorization: `Bearer ${await token()}` }
  // FormData must set its own Content-Type, boundary included, so it is left alone.
  if (json && body !== undefined) headers['Content-Type'] = 'application/json'

  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : json ? JSON.stringify(body) : body,
    })
  } catch {
    throw new Error(`Cannot reach the EvidenceIQ backend at ${API_BASE_URL}.`)
  }

  let data = null
  try {
    data = await response.json()
  } catch {
    if (response.ok) return null
    throw new Error('The backend returned a response that was not JSON.')
  }

  if (!response.ok) {
    throw new Error(typeof data?.detail === 'string' ? data.detail : 'The request failed.')
  }
  return data
}

/** Every chat this researcher owns, newest activity first. */
export function listChats() {
  return request('/api/quick-chat/sessions')
}

/** One chat and its whole thread. */
export function getChat(sessionId) {
  return request(`/api/quick-chat/sessions/${sessionId}`)
}

/** Upload a document and start a chat about it. The text is extracted server-side. */
export function createChat(file) {
  const form = new FormData()
  form.append('file', file)
  return request('/api/quick-chat/sessions', { method: 'POST', body: form, json: false })
}

/**
 * Ask one question. Returns both saved messages, so the caller appends what the server
 * actually stored rather than guessing at it.
 */
export function askChat(sessionId, question) {
  return request(`/api/quick-chat/sessions/${sessionId}/ask`, {
    method: 'POST',
    body: { question },
  })
}

export function deleteChat(sessionId) {
  return request(`/api/quick-chat/sessions/${sessionId}`, { method: 'DELETE' })
}
