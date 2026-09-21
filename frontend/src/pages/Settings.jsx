import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Camera,
  Check,
  CreditCard,
  Crown,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Minus,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react'

import Sidebar from '../components/dashboard/Sidebar'
import TopBar from '../components/dashboard/TopBar'
import { useAuth } from '../context/AuthContext'
import { ROUTE_FOR_NAV_KEY } from '../lib/navigation'
import { BILLING, FEATURES, PLANS, planForUser } from '../lib/plans'
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_AVATAR_BYTES,
  avatarUrl,
  changePassword,
  displayName,
  removeAvatar,
  updateDisplayName,
  uploadAvatar,
} from '../lib/profileApi'

// The rail down the left and the sections on the right are the same list, so they
// cannot fall out of step.
const SECTIONS = [
  { id: 'profile', label: 'Profile', hint: 'Your personal information', icon: UserRound },
  { id: 'password', label: 'Password', hint: 'Keep your account secure', icon: KeyRound },
  { id: 'subscription', label: 'Subscription', hint: 'Your plan and features', icon: CreditCard },
]

/**
 * Account settings: who you are, how you sign in, and what you are paying for.
 *
 * Every section saves on its own. A single Save across all three would mean a rejected
 * password change silently discarding an edited name - and these are different kinds of
 * change, made at different times, carrying different risks.
 */
export default function Settings() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  // Explicit selection rather than a scroll spy. All three sections are stacked and the
  // whole page is barely taller than one screen, so at the bottom every section is on
  // display at once and "which one are you reading" has no honest answer - a spy there
  // reports whichever section the arithmetic happens to land on, which is how clicking
  // Password lit up Subscription. The rail records where you asked to go instead.
  const [active, setActive] = useState(SECTIONS[0].id)

  function jumpTo(id) {
    setActive(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <TopBar user={user} onSignOut={signOut} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          active="settings"
          onNavigate={(key) => {
            const route = ROUTE_FOR_NAV_KEY[key]
            if (route) navigate(route)
          }}
        />

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6">
            <PageHeader />

            <div className="mt-5 grid items-start gap-5 lg:grid-cols-[264px_minmax(0,1fr)]">
              <div className="hidden space-y-4 lg:sticky lg:top-0 lg:block">
                <SectionRail active={active} onJump={jumpTo} />
                <PrivacyCard />
              </div>

              <div className="min-w-0 space-y-5">
                <ProfileSection user={user} />
                <PasswordSection user={user} />
                <SubscriptionSection user={user} />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- header ----- */

function PageHeader() {
  return (
    <header className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-r from-white via-blue-50/50 to-blue-50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-brand-blue ring-1 ring-blue-100">
            <SettingsIcon className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-brand-black">Settings</h1>
            <p className="mt-0.5 text-sm text-neutral-500">
              Manage your profile, security and plan — all in one place.
            </p>
          </div>
        </div>

        <p className="hidden shrink-0 text-right text-sm font-semibold italic leading-snug text-brand-blue sm:block">
          “Better Evidence.
          <br />
          Brighter Decisions.”
        </p>
      </div>
    </header>
  )
}

/* ---------------------------------------------------------------------- rail ----- */

/**
 * Jumps to a section, and marks the one you jumped to.
 *
 * A tabbed version would hide two thirds of the page behind a click. Settings is short
 * enough to scroll, and scrolling means you can see that a Password section exists
 * without going looking for it - so the rail navigates rather than filters.
 */
function SectionRail({ active, onJump }) {
  return (
    <nav aria-label="Settings sections" className="space-y-2">
      {SECTIONS.map(({ id, label, hint, icon: Icon }) => {
        const isActive = active === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onJump(id)}
            aria-current={isActive ? 'true' : undefined}
            className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
              isActive
                ? 'border-brand-blue/30 bg-blue-50'
                : 'border-neutral-100 bg-white hover:bg-slate-50'
            }`}
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                isActive ? 'bg-white text-brand-blue' : 'bg-slate-100 text-neutral-500'
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <span className="min-w-0">
              <span
                className={`block text-sm font-bold ${
                  isActive ? 'text-brand-blue' : 'text-brand-black'
                }`}
              >
                {label}
              </span>
              <span className="mt-0.5 block truncate text-xs text-neutral-500">{hint}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}

function PrivacyCard() {
  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-brand-blue">
        <ShieldCheck className="h-[22px] w-[22px]" strokeWidth={1.9} />
      </span>
      <p className="mt-2.5 text-sm font-bold text-brand-black">Your data, your control</p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-600">
        Every review, paper and decision is scoped to your account by the database
        itself, not just by the screen in front of you.
      </p>
      <ul className="mt-3 space-y-1.5 text-left">
        {[
          'Row-level security on every table',
          'Your reviews are never shared',
          'Delete anything, at any time',
        ].map((line) => (
          <li key={line} className="flex items-start gap-1.5 text-xs text-neutral-600">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" strokeWidth={2.6} />
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* -------------------------------------------------------------------- shared ----- */

function Section({ id, icon: Icon, tone, title, description, aside, children }) {
  return (
    <section
      id={id}
      // Cleared past the top of the scroll area, so jumping here does not land with the
      // heading tucked against the edge.
      className="scroll-mt-6 rounded-2xl border border-neutral-100 bg-white p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}
          >
            <Icon className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-brand-black">{title}</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">{description}</p>
          </div>
        </div>
        {aside}
      </div>

      <div className="mt-5">{children}</div>
    </section>
  )
}

/** Feedback that does not move anything: the layout must not jump on a save. */
function Feedback({ error, done, doneText = 'Saved.' }) {
  if (error) return <p className="text-xs font-medium text-red-600">{error}</p>
  if (done) {
    return (
      <p className="flex items-center gap-1 text-xs font-medium text-emerald-600">
        <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
        {doneText}
      </p>
    )
  }
  return null
}

const PRIMARY =
  'flex items-center justify-center gap-2 rounded-xl bg-brand-blue px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-blue-dark disabled:opacity-50'

/** A labelled input with an icon in the gutter, so the three forms look like one form. */
function Field({ id, label, icon: Icon, hint, ...input }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-brand-black">
        {label}
      </label>
      <div className="relative">
        <Icon
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          strokeWidth={1.9}
        />
        <input
          id={id}
          {...input}
          className="w-full rounded-xl border border-neutral-200 py-3 pl-10 pr-3 text-sm text-brand-black placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30 disabled:bg-slate-50 disabled:text-neutral-500"
        />
      </div>
      {hint ? <p className="mt-1.5 text-[11px] text-neutral-400">{hint}</p> : null}
    </div>
  )
}

/* ------------------------------------------------------------------- profile ----- */

// ProtectedRoute renders nothing until the session has loaded and redirects when there
// is no user, so `user` is always populated here and initial state is enough - no
// effect is needed to catch a later-arriving session.
function ProfileSection({ user }) {
  const [name, setName] = useState(displayName(user))
  const [avatar, setAvatar] = useState(avatarUrl(user))
  const [saving, setSaving] = useState(false)
  const [busyAvatar, setBusyAvatar] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const fileInput = useRef(null)

  const initial = (name || user?.email || '?').charAt(0).toUpperCase()
  const changed = name.trim() !== displayName(user).trim()
  const joined = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null

  async function saveName(event) {
    event.preventDefault()
    setError(null)
    setDone(false)
    setSaving(true)
    try {
      await updateDisplayName(name)
      setDone(true)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  async function pickAvatar(event) {
    const file = event.target.files?.[0]
    // Cleared at once so choosing the same file twice still fires a change event.
    event.target.value = ''
    if (!file) return

    setError(null)
    setDone(false)
    setBusyAvatar(true)
    try {
      const updated = await uploadAvatar(user, file)
      setAvatar(avatarUrl(updated))
      setDone(true)
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setBusyAvatar(false)
    }
  }

  async function clearAvatar() {
    setError(null)
    setDone(false)
    setBusyAvatar(true)
    try {
      await removeAvatar(user)
      setAvatar(null)
      setDone(true)
    } catch (removeError) {
      setError(removeError.message)
    } finally {
      setBusyAvatar(false)
    }
  }

  return (
    <Section
      id="profile"
      icon={UserRound}
      tone="bg-blue-50 text-brand-blue"
      title="Profile"
      description="Your name and picture, as they appear across EvidenceIQ."
      aside={
        joined ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-neutral-600">
            <UserRound className="h-3.5 w-3.5" strokeWidth={1.9} />
            Member since {joined}
          </span>
        ) : null
      }
    >
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busyAvatar}
          aria-label={avatar ? 'Change your picture' : 'Upload a picture'}
          className="group relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
        >
          {avatar ? (
            <img
              src={avatar}
              alt=""
              className="h-20 w-20 rounded-full object-cover ring-1 ring-neutral-200"
            />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-blue text-2xl font-semibold text-white">
              {initial}
            </span>
          )}
          {/* The picture is the obvious thing to click; the badge says so out loud. */}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-brand-blue text-white ring-2 ring-white transition-colors group-hover:bg-brand-blue-dark">
            {busyAvatar ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
            ) : (
              <Camera className="h-3.5 w-3.5" strokeWidth={2.2} />
            )}
          </span>
        </button>

        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busyAvatar}
              className="flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm font-medium text-brand-black transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" strokeWidth={1.9} />
              {avatar ? 'Change picture' : 'Upload picture'}
            </button>

            {avatar ? (
              <button
                type="button"
                onClick={clearAvatar}
                disabled={busyAvatar}
                className="flex items-center gap-1.5 rounded-xl border border-red-100 bg-white px-3.5 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                Remove
              </button>
            ) : null}
          </div>

          <p className="mt-2 text-[11px] text-neutral-400">
            PNG, JPEG, WebP or GIF, up to {MAX_AVATAR_BYTES / (1024 * 1024)} MB.
          </p>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          onChange={pickAvatar}
          className="hidden"
        />
      </div>

      <form onSubmit={saveName} className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="full-name"
            label="Display name"
            icon={UserRound}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
          />
          <Field
            id="email"
            label="Email"
            icon={Mail}
            value={user?.email ?? ''}
            disabled
            hint="Your email is what you sign in with, and it cannot be changed here."
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || !changed} className={PRIMARY}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <Save className="h-4 w-4" strokeWidth={1.9} />
            )}
            Save profile
          </button>
          <Feedback error={error} done={done} />
        </div>
      </form>
    </Section>
  )
}

/* ------------------------------------------------------------------ password ----- */

function PasswordSection({ user }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const ready = current.length > 0 && next.length > 0 && confirm.length > 0

  async function submit(event) {
    event.preventDefault()
    setError(null)
    setDone(false)

    // Checked here rather than server-side: a typo in the confirmation is the caller's
    // mistake to catch, and sending it would change the password to the wrong thing.
    if (next !== confirm) {
      setError('Those two passwords do not match.')
      return
    }

    setSaving(true)
    try {
      await changePassword(user.email, current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setDone(true)
    } catch (changeError) {
      setError(changeError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      id="password"
      icon={KeyRound}
      tone="bg-violet-50 text-violet-600"
      title="Password"
      description="You will be asked for your current password before it changes."
      aside={
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
          <Lock className="h-3.5 w-3.5" strokeWidth={2} />
          Keep your account safe
        </span>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <Field
            id="current-password"
            label="Current password"
            icon={Lock}
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            placeholder="Enter current password"
          />
          <Field
            id="new-password"
            label="New password"
            icon={Lock}
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            placeholder="Enter new password"
            hint="At least 8 characters."
          />
          <Field
            id="confirm-password"
            label="Confirm new password"
            icon={Lock}
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            placeholder="Confirm new password"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || !ready} className={PRIMARY}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <ShieldCheck className="h-4 w-4" strokeWidth={1.9} />
            )}
            Change password
          </button>
          <Feedback error={error} done={done} doneText="Password changed." />
        </div>
      </form>
    </Section>
  )
}

/* -------------------------------------------------------------- subscription ----- */

function SubscriptionSection({ user }) {
  const plan = planForUser(user)

  return (
    <Section
      id="subscription"
      icon={Crown}
      tone="bg-amber-50 text-amber-600"
      title="Subscription"
      description="What your plan includes, and what the others add."
      aside={
        <Link
          to="/#pricing"
          className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-brand-blue hover:underline"
        >
          Compare plans
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} />
        </Link>
      }
    >
      <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/80 to-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-xl font-bold text-brand-black">{plan.name}</span>
              <span className="rounded-full bg-brand-blue px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                Current plan
              </span>
            </p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-600">{plan.tagline}</p>
          </div>

          <p className="text-right">
            <span className="text-2xl font-bold text-brand-black">
              {plan.price.monthly === 0 ? 'Free' : `$${plan.price.monthly}`}
            </span>
            {plan.price.monthly > 0 ? (
              <span className="block text-[11px] text-neutral-500">{BILLING.monthly.suffix}</span>
            ) : null}
          </p>
        </div>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {FEATURES.map(({ key, label }) => {
          const value = plan.features[key]
          const included = value !== false
          return (
            <li key={key} className="flex items-start gap-2 text-sm">
              {included ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" strokeWidth={2.4} />
              ) : (
                <Minus className="mt-0.5 h-4 w-4 shrink-0 text-neutral-300" strokeWidth={2.4} />
              )}
              <span className={included ? 'text-neutral-700' : 'text-neutral-400'}>
                {label}
                {value !== true && value !== false ? (
                  <span className="ml-1 font-semibold text-brand-black">{value}</span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>

      {/* Stated plainly rather than hidden behind a button that would do nothing. A
          checkout that silently fails is worse than an honest sentence, and this page
          is the one place a user would go looking to pay. */}
      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5">
        <p className="text-xs font-semibold text-amber-900">Paid plans are not open yet</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-800">
          There is no billing set up, so every account is on {PLANS[0].name} and nothing is
          charged. The limits above are not enforced yet either — you can run more than the
          free plan lists.
        </p>
      </div>
    </Section>
  )
}
