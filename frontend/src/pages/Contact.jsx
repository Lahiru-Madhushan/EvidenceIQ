import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, BookOpen, CircleHelp, Send } from 'lucide-react'

import PageShell from '../components/landing/PageShell'
import { SUPPORT_EMAIL } from '../lib/site'

const TOPICS = ['General question', 'Technical support', 'Billing and plans', 'Partnerships', 'Feedback']

const field =
  'w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-3 text-sm text-brand-black placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30'

/**
 * There is no message endpoint on the backend, so the form composes the email and hands
 * it to the visitor's own mail app. That keeps the address they will be answered at in
 * their hands, and nothing is stored on our side that they did not choose to send.
 */
function mailtoFor({ name, email, topic, message }) {
  const subject = `[${topic}] Message from ${name}`
  const body = `${message}\n\n— ${name} (${email})`
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', topic: TOPICS[0], message: '' })
  const [sent, setSent] = useState(false)

  const update = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))

  function onSubmit(event) {
    event.preventDefault()
    window.location.href = mailtoFor(form)
    setSent(true)
  }

  return (
    <PageShell
      eyebrow="Contact"
      title="Get in touch"
      intro="Questions about EvidenceIQ, a problem with a review, or an idea for what we should build next — we read every message."
    >
      <div className="grid lg:grid-cols-[1fr_340px] gap-10">
        <div className="rounded-2xl border border-neutral-100 p-6 sm:p-8">
          {sent ? (
            <div role="status" className="text-center py-10">
              <span className="mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-blue-50 text-brand-blue mb-4">
                <Send className="w-5 h-5" strokeWidth={1.8} />
              </span>
              <h2 className="text-lg font-bold text-brand-black">Your email is ready to send</h2>
              <p className="mt-2 text-sm text-neutral-500 max-w-sm mx-auto">
                We opened it in your email app — just press send. If nothing opened, write to us at{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand-blue hover:underline">
                  {SUPPORT_EMAIL}
                </a>
                .
              </p>
              <button
                type="button"
                onClick={() => setSent(false)}
                className="mt-6 text-sm font-medium text-brand-blue hover:underline"
              >
                Back to the form
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-5">
                <label className="block">
                  <span className="block text-sm font-medium text-brand-black mb-1.5">Name</span>
                  <input required value={form.name} onChange={update('name')} autoComplete="name" className={field} />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-brand-black mb-1.5">Email</span>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={update('email')}
                    autoComplete="email"
                    className={field}
                  />
                </label>
              </div>

              <label className="block">
                <span className="block text-sm font-medium text-brand-black mb-1.5">Topic</span>
                <select value={form.topic} onChange={update('topic')} className={field}>
                  {TOPICS.map((topic) => (
                    <option key={topic}>{topic}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-sm font-medium text-brand-black mb-1.5">Message</span>
                <textarea
                  required
                  rows={6}
                  value={form.message}
                  onChange={update('message')}
                  placeholder="How can we help?"
                  className={`${field} resize-y`}
                />
              </label>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                <p className="text-xs text-neutral-400">Sending opens your email app with this message filled in.</p>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-blue px-6 py-3 text-sm font-semibold text-white hover:bg-brand-blue-dark transition-colors"
                >
                  <Send className="w-4 h-4" />
                  Send message
                </button>
              </div>
            </form>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl bg-blue-50 p-6">
            <Mail className="w-5 h-5 text-brand-blue mb-3" strokeWidth={1.8} />
            <p className="font-semibold text-brand-black">Email</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sm text-brand-blue hover:underline break-all">
              {SUPPORT_EMAIL}
            </a>
            <p className="mt-2 text-xs text-neutral-500">Researcher plans hear back within one business day.</p>
          </div>

          <Link to="/docs" className="flex gap-3 rounded-2xl border border-neutral-100 p-5 hover:border-brand-blue/40 transition-colors">
            <BookOpen className="w-5 h-5 text-brand-blue shrink-0" strokeWidth={1.8} />
            <span>
              <span className="block text-sm font-semibold text-brand-black">Documentation</span>
              <span className="block text-xs text-neutral-500 mt-0.5">Guides for every step of a review.</span>
            </span>
          </Link>

          <Link to="/faq" className="flex gap-3 rounded-2xl border border-neutral-100 p-5 hover:border-brand-blue/40 transition-colors">
            <CircleHelp className="w-5 h-5 text-brand-blue shrink-0" strokeWidth={1.8} />
            <span>
              <span className="block text-sm font-semibold text-brand-black">FAQ</span>
              <span className="block text-xs text-neutral-500 mt-0.5">The answer may already be there.</span>
            </span>
          </Link>
        </aside>
      </div>
    </PageShell>
  )
}
