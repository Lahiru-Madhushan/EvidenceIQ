/**
 * The signed-in user's own account: their name, their picture, their password.
 *
 * All of this goes through Supabase Auth and Storage directly. There is no backend
 * involved and there should not be: the backend connects as `postgres` and would have
 * to be trusted to act as the right user, where these calls carry the user's own token
 * and can only ever touch their own account.
 */

import { supabase } from './supabaseClient'

export const AVATAR_BUCKET = 'avatars'

// Matches the bucket's own limits, checked here as well so a too-large file is refused
// instantly with a sentence rather than after a slow upload and a 413.
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** The display name, or the email if none was ever set. */
export function displayName(user) {
  return user?.user_metadata?.full_name?.trim() || user?.email || ''
}

/** The URL of the user's picture, or null if they have not uploaded one. */
export function avatarUrl(user) {
  return user?.user_metadata?.avatar_url || null
}

/** Save the display name. Stored in user metadata, where the rest of the app reads it. */
export async function updateDisplayName(fullName) {
  const { data, error } = await supabase.auth.updateUser({
    data: { full_name: fullName.trim() },
  })
  if (error) throw new Error(error.message)
  return data.user
}

/**
 * Change the password, after proving the current one.
 *
 * The re-authentication is the point. `updateUser({ password })` on its own changes the
 * password of whoever holds the session and never asks for the old one, so an unlocked
 * laptop or a stolen token would be enough to take the account permanently. Signing in
 * with the current password first costs one request and closes that.
 *
 * Supabase's own password rules are enforced server-side; the length check here only
 * saves a round trip on the obvious case.
 */
export async function changePassword(email, currentPassword, newPassword) {
  if (newPassword.length < 8) {
    throw new Error('Your new password must be at least 8 characters.')
  }
  if (newPassword === currentPassword) {
    throw new Error('That is the password you are already using.')
  }

  const { error: authError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  })
  if (authError) {
    throw new Error('That is not your current password.')
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
}

/**
 * Upload a profile picture and point the account at it.
 *
 * The object is stored under `<user id>/avatar.<ext>`, which is what the bucket's write
 * policies check: the first path segment must equal the caller's uid, so nobody can
 * overwrite anyone else's picture.
 *
 * `upsert` replaces the previous file rather than accumulating one per change - and
 * because the URL is then unchanged, a cache-busting query is appended when it is
 * recorded, or every browser that has seen the old picture would keep showing it.
 */
export async function uploadAvatar(user, file) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, WebP or GIF image.')
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error(`That image is larger than ${MAX_AVATAR_BYTES / (1024 * 1024)} MB.`)
  }

  const extension = file.type.split('/')[1].replace('jpeg', 'jpg')
  const path = `${user.id}/avatar.${extension}`

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type })
  if (uploadError) throw new Error(`Could not upload that image: ${uploadError.message}`)

  const {
    data: { publicUrl },
  } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)

  const url = `${publicUrl}?v=${Date.now()}`
  const { data, error } = await supabase.auth.updateUser({ data: { avatar_url: url } })
  if (error) throw new Error(error.message)
  return data.user
}

/**
 * Remove the picture.
 *
 * The stored object goes too, not just the reference to it. Clearing only the metadata
 * would leave the image sitting in a public bucket after the user asked for it to be
 * gone, which is not what "remove" means.
 */
export async function removeAvatar(user) {
  const current = avatarUrl(user)
  if (current) {
    // The extension is whatever was uploaded, so remove every shape it could have.
    const paths = ['png', 'jpg', 'webp', 'gif'].map((ext) => `${user.id}/avatar.${ext}`)
    await supabase.storage.from(AVATAR_BUCKET).remove(paths)
  }

  const { data, error } = await supabase.auth.updateUser({ data: { avatar_url: null } })
  if (error) throw new Error(error.message)
  return data.user
}
