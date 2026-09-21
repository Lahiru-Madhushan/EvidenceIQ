import { useEffect, useRef, useState } from 'react'
import { Info, Send, ShieldAlert } from 'lucide-react'

import { DecisionBadge } from './Badges'
import { askPaper, getPaperSummary } from '../../lib/agentsApi'

// Static prompts, not data - they seed the input box, nothing more.
const SUGGESTED_QUESTIONS = [
  'What was the intervention?',
  'What were the main outcomes?',
  'What was the study design?',
  'Why did the agents include this paper?',
]

/**
 * Grounded question answering over one paper.
 *
 * Every answer comes from POST /api/papers/:id/chat, which is handed the paper's
 * abstract, the protocol it was screened against, and what the two agents concluded -
 * and nothing else. A question the paper does not answer comes back with
 * `grounded: false`, and is shown as a limit rather than a finding: in a tool whose
 * output ends up in a systematic review, a confident sentence sourced from a model's
 * memory of the literature is worse than no answer at all.
 *
 * The summary above the thread is computed from stored fields, so it appears instantly
 * and costs no model call.
 */
export default function ChatTab({ paper }) {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState([])
  const [summary, setSummary] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const threadEnd = useRef(null)

  useEffect(() => {
    let cancelled = false
    getPaperSummary(paper.id)
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch(() => {
        // The summary is orientation, not the feature. Losing it must not stop the chat.
        if (!cancelled) setSummary(null)
      })
    return () => {
      cancelled = true
    }
  }, [paper.id])

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: 'end' })
  }, [messages, pending])

  async function send(question) {
    const text = question.trim()
    if (!text || pending) return

    setDraft('')
    setError(null)
    // What came before this question, not including it.
    const history = messages.map(({ role, content }) => ({ role, content }))
    setMessages((previous) => [...previous, { role: 'user', content: text }])
    setPending(true)

    try {
      const reply = await askPaper(paper.id, text, history)
      setMessages((previous) => [
        ...previous,
        {
          role: 'assistant',
          content: reply.answer,
          grounded: reply.grounded,
          quotes: reply.quotes ?? [],
        },
      ])
    } catch (askError) {
      setError(askError.message)
      // Take the question back out, so the thread never shows one with no reply under
      // it, and put it back in the box where it can be sent again.
      setMessages((previous) => previous.slice(0, -1))
      setDraft(text)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 p-4">
        {summary ? <ChatSummary summary={summary} /> : null}

        <div className="flex gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-relaxed text-neutral-600">
          <Info className="h-4 w-4 shrink-0 text-brand-blue" strokeWidth={1.9} />
          <p>
            Answers come only from this paper&rsquo;s abstract and what the agents found.
            Ask about anything else and it will say it does not know.
          </p>
        </div>

        {messages.length === 0 && !pending ? (
          <p className="py-4 text-center text-sm text-neutral-400">
            Ask a question to start a conversation about this paper.
          </p>
        ) : (
          <div className="space-y-3">
            {messages.map((message, index) => (
              <ChatMessage key={index} message={message} />
            ))}
            {pending ? (
              <p className="text-xs text-neutral-400">Reading the paper&hellip;</p>
            ) : null}
            <div ref={threadEnd} />
          </div>
        )}

        {error ? (
          <p className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </p>
        ) : null}

        {messages.length === 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-500">Suggested questions</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => send(question)}
                  disabled={pending}
                  className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-brand-black transition-colors hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-auto border-t border-neutral-100 p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            send(draft)
          }}
          className="relative"
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={pending}
            placeholder="Ask a question about this paper..."
            className="w-full rounded-xl border border-neutral-200 py-2.5 pl-3.5 pr-11 text-sm placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            aria-label="Send message"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-brand-blue p-2 text-white transition-colors hover:bg-brand-blue-dark disabled:opacity-40"
          >
            <Send className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </form>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
          Answers are limited to the abstract, so most fine detail genuinely is not in
          scope. Verify anything that matters against the full text.
        </p>
      </div>
    </div>
  )
}

/** The orientation above the thread: what this paper is, at a glance. */
function ChatSummary({ summary }) {
  const meta = [summary.journal, summary.year, summary.publication_types?.[0]]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          About this paper
        </p>
        {summary.verified_decision ? (
          <DecisionBadge value={summary.verified_decision} />
        ) : null}
      </div>

      {summary.title ? (
        <p className="mt-1.5 text-sm font-semibold leading-snug text-brand-black">
          {summary.title}
        </p>
      ) : null}
      {meta ? <p className="mt-1 text-xs text-neutral-500">{meta}</p> : null}

      {summary.gist ? (
        <p className="mt-2 text-xs leading-relaxed text-neutral-600">{summary.gist}</p>
      ) : (
        <p className="mt-2 text-xs italic text-neutral-400">
          No abstract was stored for this paper, so there is very little here to answer
          from.
        </p>
      )}
    </div>
  )
}

/** One turn. An ungrounded answer is styled as a limit, not as a result. */
function ChatMessage({ message }) {
  if (message.role === 'user') {
    return (
      <p className="ml-6 rounded-xl rounded-br-sm bg-brand-blue px-3 py-2 text-sm text-white">
        {message.content}
      </p>
    )
  }

  return (
    <div
      className={`mr-6 rounded-xl rounded-bl-sm border px-3 py-2 ${
        message.grounded ? 'border-neutral-200 bg-white' : 'border-amber-200 bg-amber-50/70'
      }`}
    >
      {!message.grounded ? (
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
          <ShieldAlert className="h-3.5 w-3.5" strokeWidth={2} />
          Not in this paper
        </p>
      ) : null}

      <p className="text-sm leading-relaxed text-brand-black">{message.content}</p>

      {message.quotes?.length ? (
        <ul className="mt-2 space-y-1.5 border-t border-neutral-100 pt-2">
          {message.quotes.map((quote, index) => (
            <li
              key={index}
              className="border-l-2 border-brand-blue/40 pl-2 text-xs italic leading-relaxed text-neutral-500"
            >
              &ldquo;{quote}&rdquo;
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
