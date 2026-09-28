import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Check,
  Eye,
  ExternalLink,
  FileText,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageSquareText,
  MoreVertical,
  Plus,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

import Sidebar from '../components/dashboard/Sidebar'
import TopBar from '../components/dashboard/TopBar'
import { useAuth } from '../context/AuthContext'
import { ROUTE_FOR_NAV_KEY } from '../lib/navigation'
import {
  askChat,
  attachChatDocument,
  createChat,
  deleteChat,
  fetchChatDocument,
  getChat,
  listChats,
} from '../lib/quickChatApi'

const ACCEPT = '.pdf,.txt,.md,.csv'

// What a document can be asked, shown before there is a document to ask. Each one is a
// real question the grounded prompt answers well, not a slogan.
const EXAMPLES = [
  {
    icon: MessageSquareText,
    text: 'Summarize the main findings of this paper.',
    tone: 'bg-blue-50 text-brand-blue',
  },
  {
    icon: ListChecks,
    text: 'What are the inclusion and exclusion criteria?',
    tone: 'bg-violet-50 text-violet-600',
  },
  {
    icon: BarChart3,
    text: 'Extract the key results and effect sizes.',
    tone: 'bg-emerald-50 text-emerald-600',
  },
  {
    icon: Lightbulb,
    text: 'What are the limitations of this study?',
    tone: 'bg-amber-50 text-amber-600',
  },
]

/**
 * Quick Chat: ask questions about a document you uploaded, answered from that document.
 *
 * Threads down the left, the open one on the right. Everything is persisted - the
 * extracted document text, every question, every answer, and whether each answer was
 * actually found in the document - so reopening a chat shows exactly what it showed
 * when the answers were given rather than a re-derived approximation of it.
 */
export default function QuickChat() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const [chats, setChats] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [active, setActive] = useState(null)
  const [draft, setDraft] = useState('')
  const [listQuery, setListQuery] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingChat, setLoadingChat] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState(null)
  // The chat whose document is open, so switching chats closes the viewer by itself.
  const [viewerFor, setViewerFor] = useState(null)
  const viewerOpen = viewerFor !== null && viewerFor === activeId
  const fileInput = useRef(null)
  const threadEnd = useRef(null)

  // A question picked from the examples before a document existed. Choosing one opens
  // the file dialog and the question is asked the moment the upload finishes, so an
  // example is a way to start rather than a label you read and then retype.
  const pendingQuestion = useRef(null)

  const refreshList = useCallback(async () => {
    try {
      const rows = await listChats()
      setChats(rows)
      return rows
    } catch (listError) {
      setError(listError.message)
      return []
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    refreshList()
  }, [refreshList])

  useEffect(() => {
    if (!activeId) {
      setActive(null)
      return undefined
    }
    let cancelled = false
    setLoadingChat(true)
    // Cleared here too: a failure in one chat used to stay on screen while you read
    // another, pinned above a thread it had nothing to do with.
    setError(null)
    getChat(activeId)
      .then((data) => {
        if (!cancelled) setActive(data)
      })
      .catch((openError) => {
        if (!cancelled) setError(openError.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingChat(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeId])

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [active?.messages?.length, asking])

  const filteredChats = useMemo(() => {
    const needle = listQuery.trim().toLowerCase()
    if (!needle) return chats
    return chats.filter(
      (chat) =>
        chat.title?.toLowerCase().includes(needle) ||
        chat.document_name?.toLowerCase().includes(needle)
    )
  }, [chats, listQuery])

  /** Shared by the file dialog and the drop zone, so both behave identically. */
  const acceptFile = useCallback(
    async (file) => {
      if (!file) return

      setError(null)
      setUploading(true)
      try {
        const created = await createChat(file)

        // Asked before the thread is opened, so the chat appears already answered
        // rather than opening empty and then visibly filling itself in.
        const question = pendingQuestion.current
        pendingQuestion.current = null
        if (question) {
          try {
            await askChat(created.id, question)
          } catch (askError) {
            setError(askError.message)
          }
        }

        await refreshList()
        setActiveId(created.id)
      } catch (uploadError) {
        setError(uploadError.message)
      } finally {
        setUploading(false)
      }
    },
    [refreshList]
  )

  function handleFileInput(event) {
    const file = event.target.files?.[0]
    // Cleared immediately so picking the same file twice still fires a change event.
    event.target.value = ''
    acceptFile(file)
  }

  function startWithExample(question) {
    pendingQuestion.current = question
    fileInput.current?.click()
  }

  async function handleAsk(event) {
    event.preventDefault()
    const question = draft.trim()
    if (!question || asking || !active) return

    setDraft('')
    setError(null)
    setAsking(true)
    try {
      const reply = await askChat(active.id, question)
      setActive((previous) => ({
        ...previous,
        messages: [...(previous?.messages ?? []), reply.question, reply.answer],
      }))
      // The list is ordered by last activity, so this chat has just moved to the top.
      refreshList()
    } catch (askError) {
      setError(askError.message)
      setDraft(question)
    } finally {
      setAsking(false)
    }
  }

  async function handleDelete(id) {
    setError(null)
    try {
      await deleteChat(id)
      if (id === activeId) setActiveId(null)
      await refreshList()
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  return (
    // h-screen, not min-h-screen: the thread below scrolls only if every ancestor has a
    // bounded height. Under a minimum height the chain grows with the messages instead,
    // and the whole page scrolls while the composer walks off the bottom of the window.
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <TopBar user={user} onSignOut={signOut} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          active="chat"
          onNavigate={(key) => {
            const route = ROUTE_FOR_NAV_KEY[key]
            if (route) navigate(route)
          }}
        />

        <main className="flex min-h-0 min-w-0 flex-1">
          <ChatList
            chats={filteredChats}
            total={chats.length}
            query={listQuery}
            onQueryChange={setListQuery}
            activeId={activeId}
            loading={loadingList}
            uploading={uploading}
            onSelect={setActiveId}
            onDelete={handleDelete}
            onUploadClick={() => fileInput.current?.click()}
          />

          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            onChange={handleFileInput}
            className="hidden"
          />

          <section className="flex min-w-0 flex-1 flex-col bg-white">
            {error ? (
              <p className="m-4 shrink-0 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            {!activeId ? (
              <Welcome
                uploading={uploading}
                onFile={acceptFile}
                onUploadClick={() => fileInput.current?.click()}
                onExample={startWithExample}
              />
            ) : loadingChat ? (
              <p className="m-auto flex items-center gap-2 text-sm text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                Opening this chat&hellip;
              </p>
            ) : active ? (
              <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col">
                  <DocumentBar
                    chat={active}
                    viewerOpen={viewerOpen}
                    onToggleViewer={() => setViewerFor(viewerOpen ? null : activeId)}
                  />

                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    <div className="mx-auto max-w-[760px] space-y-4">
                      {active.messages.length === 0 ? (
                        <StarterChips onPick={setDraft} />
                      ) : (
                        active.messages.map((message) => (
                          <Message key={message.id} message={message} />
                        ))
                      )}
                      {asking ? (
                        <p className="flex items-center gap-2 text-sm text-neutral-400">
                          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                          Thinking&hellip;
                        </p>
                      ) : null}
                      <div ref={threadEnd} />
                    </div>
                  </div>

                  <form onSubmit={handleAsk} className="shrink-0 border-t border-neutral-100 p-4">
                    <div className="relative mx-auto max-w-[760px]">
                      <input
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        disabled={asking}
                        placeholder="Ask a question about this document..."
                        className="w-full rounded-xl border border-neutral-200 py-3 pl-4 pr-12 text-sm placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30 disabled:opacity-60"
                      />
                      <button
                        type="submit"
                        disabled={asking || !draft.trim()}
                        aria-label="Send question"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-brand-blue p-2 text-white transition-colors hover:bg-brand-blue-dark disabled:opacity-40"
                      >
                        <Send className="h-4 w-4" strokeWidth={1.9} />
                      </button>
                    </div>
                    <p className="mx-auto mt-2 max-w-[760px] text-[11px] text-neutral-400">
                      I only answer from this document. Anything it does not cover is marked
                      as such, never filled in from general knowledge.
                    </p>
                  </form>
                </div>

                {viewerOpen ? (
                  <DocumentViewer
                    // Remounts once an original is attached, so it refetches the PDF.
                    key={`${active.id}:${active.has_original}`}
                    chat={active}
                    onClose={() => setViewerFor(null)}
                    onAttached={(summary) => {
                      setActive((previous) => ({ ...previous, ...summary }))
                      refreshList()
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </section>
        </main>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- chat list ---- */

/** "2d ago" - a thread list is scanned, and an exact date would have to be read. */
function ago(value) {
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, (Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = seconds / 60
  if (minutes < 60) return `${Math.floor(minutes)}m ago`
  const hours = minutes / 60
  if (hours < 24) return `${Math.floor(hours)}h ago`
  const days = hours / 24
  if (days < 7) return `${Math.floor(days)}d ago`
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function ChatList({
  chats,
  total,
  query,
  onQueryChange,
  activeId,
  loading,
  uploading,
  onSelect,
  onDelete,
  onUploadClick,
}) {
  return (
    <aside className="hidden w-[286px] shrink-0 flex-col border-r border-neutral-100 bg-white md:flex">
      <div className="shrink-0 space-y-2.5 p-3">
        <button
          type="button"
          onClick={onUploadClick}
          disabled={uploading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-blue px-3 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-blue-dark disabled:opacity-60"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <Plus className="h-4 w-4" strokeWidth={2.4} />
          )}
          {uploading ? 'Reading document…' : 'New chat'}
        </button>

        {/* Only once there is enough to search. A filter over two rows is furniture. */}
        {total > 3 ? (
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
              strokeWidth={1.8}
            />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search conversations..."
              aria-label="Search conversations"
              className="w-full rounded-xl border border-neutral-200 py-2.5 pl-9 pr-3 text-sm placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
            />
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <p className="px-2 py-3 text-xs text-neutral-400">Loading…</p>
        ) : chats.length === 0 ? (
          <p className="px-2 py-3 text-xs leading-relaxed text-neutral-400">
            {query.trim()
              ? `No conversation matches “${query.trim()}”.`
              : 'No chats yet. Upload a paper to start one.'}
          </p>
        ) : (
          <>
            <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              Recent
            </p>
            <ul className="space-y-0.5">
              {chats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === activeId}
                  onSelect={() => onSelect(chat.id)}
                  onDelete={() => onDelete(chat.id)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {!loading && total === 0 ? <ListPromo /> : null}
    </aside>
  )
}

function ChatRow({ chat, isActive, onSelect, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapper = useRef(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    function onPointerDown(event) {
      if (!wrapper.current?.contains(event.target)) setMenuOpen(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const facts = [
    `${chat.message_count} message${chat.message_count === 1 ? '' : 's'}`,
    chat.document_pages ? `${chat.document_pages} pages` : null,
  ].filter(Boolean)

  return (
    <li ref={wrapper} className="group relative">
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full gap-2.5 rounded-xl p-2.5 pr-9 text-left transition-colors ${
          isActive ? 'bg-blue-50 ring-1 ring-brand-blue/20' : 'hover:bg-slate-50'
        }`}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            isActive ? 'bg-white text-brand-blue' : 'bg-slate-100 text-neutral-500'
          }`}
        >
          <FileText className="h-4 w-4" strokeWidth={1.8} />
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm font-semibold ${
              isActive ? 'text-brand-blue' : 'text-brand-black'
            }`}
          >
            {chat.title}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-neutral-400">
            {facts.join(' · ')}
          </span>
          <span className="mt-0.5 block text-[11px] text-neutral-400">
            {ago(chat.updated_at)}
          </span>
        </span>
      </button>

      {/* Behind a menu rather than a bare bin: deleting takes the document text and
          every answer with it, and this row is a hover target on every pass. */}
      <button
        type="button"
        onClick={() => setMenuOpen((previous) => !previous)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`More actions for ${chat.title}`}
        className="absolute right-1.5 top-2.5 rounded-lg p-1.5 text-neutral-300 opacity-0 transition hover:bg-white hover:text-neutral-600 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <MoreVertical className="h-4 w-4" strokeWidth={2} />
      </button>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-1.5 top-10 z-20 w-40 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              onSelect()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-black transition-colors hover:bg-neutral-50"
          >
            <MessageSquareText className="h-4 w-4" strokeWidth={1.9} />
            Open chat
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              onDelete()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.9} />
            Delete chat
          </button>
        </div>
      ) : null}
    </li>
  )
}

/** Shown only while there are no chats at all, where it fills space instead of taking it. */
function ListPromo() {
  return (
    <div className="m-3 shrink-0 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand-blue">
        <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.9} />
      </span>
      <p className="mt-2.5 text-sm font-bold leading-snug text-brand-black">
        Chat with research papers, datasets and more.
      </p>
      <ul className="mt-2.5 space-y-1.5">
        {['Get instant answers', 'Summarize key findings', 'Extract tables and results'].map(
          (line) => (
            <li key={line} className="flex items-start gap-1.5 text-xs text-neutral-600">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" strokeWidth={2.4} />
              {line}
            </li>
          )
        )}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ welcome ----- */

const CAPABILITIES = [
  {
    icon: MessageSquareText,
    tone: 'bg-blue-50 text-brand-blue',
    title: 'Ask anything',
    text: 'Methods, results, tables, or a specific detail buried on page nine.',
  },
  {
    icon: FileText,
    tone: 'bg-violet-50 text-violet-600',
    title: 'Summarize',
    text: 'A long paper reduced to what it actually claims.',
  },
  {
    icon: Lightbulb,
    tone: 'bg-amber-50 text-amber-600',
    title: 'Extract insights',
    text: 'Key evidence and the numbers behind it, quoted verbatim.',
  },
]

function Welcome({ uploading, onFile, onUploadClick, onExample }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* min-h-full + centring, so the panel sits in the middle of a tall window
          instead of hugging the top above a screen of empty white, and still scrolls
          normally once the content is taller than the space. */}
      <div className="flex min-h-full items-center">
        <div className="mx-auto w-full max-w-[1080px] px-6 py-8">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-blue">
                Research smarter
                <span aria-hidden="true" className="h-px w-8 bg-brand-blue/40" />
              </p>

              <h1 className="mt-3 text-4xl font-bold leading-tight text-brand-black">
                Chat with
                <br />
                your <span className="text-brand-blue">document</span>
              </h1>

              <p className="mt-3 max-w-md text-sm leading-relaxed text-neutral-600">
                Upload a research paper, dataset or text file and ask questions about it.
                Every answer is quoted from your document — anything it does not cover is
                said to be missing rather than filled in from general knowledge.
              </p>

              <ul className="mt-6 space-y-4">
                {CAPABILITIES.map(({ icon: Icon, tone, title, text }) => (
                  <li key={title} className="flex gap-3">
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}
                    >
                      <Icon className="h-5 w-5" strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-brand-black">{title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">
                        {text}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <DropZone uploading={uploading} onFile={onFile} onUploadClick={onUploadClick} />
          </div>

          <section className="mt-10">
            <h2 className="text-base font-bold text-brand-black">Try an example question</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Pick one and choose a file — it is asked as soon as the document has been read.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {EXAMPLES.map(({ icon: Icon, text, tone }) => (
                <button
                  key={text}
                  type="button"
                  disabled={uploading}
                  onClick={() => onExample(text)}
                  className="group flex min-w-0 items-start gap-2.5 rounded-xl border border-neutral-200 bg-white p-3.5 text-left transition-colors hover:border-brand-blue/40 hover:bg-blue-50/40 disabled:opacity-60"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone}`}
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1 text-xs font-medium leading-relaxed text-neutral-700">
                    “{text}”
                  </span>
                  <ArrowRight
                    className="mt-1 h-3.5 w-3.5 shrink-0 text-neutral-300 transition-colors group-hover:text-brand-blue"
                    strokeWidth={2.2}
                  />
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/**
 * The upload target, which accepts a dropped file as well as a chosen one.
 *
 * `dragDepth` counts enter and leave rather than toggling a boolean: dragging over a
 * child element fires leave on the parent, so a boolean flickers the highlight off
 * every time the pointer crosses the icon inside the zone.
 */
function DropZone({ uploading, onFile, onUploadClick }) {
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  function onDragEnter(event) {
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  function onDragLeave(event) {
    event.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragging(false)
    }
  }

  function onDrop(event) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    onFile(event.dataTransfer?.files?.[0])
  }

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`rounded-3xl border-2 border-dashed p-8 text-center transition-colors ${
        dragging ? 'border-brand-blue bg-blue-50' : 'border-blue-200 bg-blue-50/40'
      }`}
    >
      <UploadArt />

      <h2 className="mt-4 text-lg font-bold text-brand-black">
        {dragging ? 'Drop it here' : 'Upload a document'}
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        Drag and drop your file here, or click to browse.
      </p>

      <button
        type="button"
        onClick={onUploadClick}
        disabled={uploading}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-blue px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-blue-dark disabled:opacity-60"
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : (
          <Upload className="h-4 w-4" strokeWidth={2} />
        )}
        {uploading ? 'Reading document…' : 'Choose a file'}
      </button>

      <p className="mt-3 text-xs text-neutral-400">PDF, TXT, MD or CSV, up to 20 MB.</p>
    </div>
  )
}

function UploadArt() {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 96" className="mx-auto h-24 w-[120px]">
      <g transform="rotate(-8 44 50)">
        <rect x="22" y="18" width="46" height="60" rx="6" fill="#fff" stroke="#bfdbfe" />
        {[30, 40, 50].map((y) => (
          <rect key={y} x="31" y={y} width="28" height="4" rx="2" fill="#dbeafe" />
        ))}
      </g>
      <g transform="rotate(5 70 46)">
        <rect x="48" y="12" width="46" height="60" rx="6" fill="#fff" stroke="#bfdbfe" />
        {[24, 34, 44].map((y) => (
          <rect key={y} x="57" y={y} width="28" height="4" rx="2" fill="#dbeafe" />
        ))}
        <rect x="57" y="54" width="16" height="4" rx="2" fill="#93c5fd" />
      </g>
      <circle cx="84" cy="66" r="18" fill="#2563eb" />
      <g stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <line x1="84" y1="74" x2="84" y2="58" />
        <polyline points="77,65 84,58 91,65" />
      </g>
    </svg>
  )
}

/** The same examples once a document is open, where they fill the composer instead. */
function StarterChips({ onPick }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm font-semibold text-brand-black">
        Hi! <span aria-hidden="true">👋</span> I&rsquo;ve read your document.
      </p>
      <p className="mt-1 text-sm text-neutral-500">What would you like to know? Try one of these:</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map(({ text }) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            className="rounded-full border border-neutral-200 bg-white px-3.5 py-2 text-xs font-medium text-neutral-600 transition-colors hover:border-brand-blue/40 hover:bg-blue-50/50 hover:text-brand-blue"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- the thread ---- */

/** What this chat is about, pinned above the thread. */
function DocumentBar({ chat, viewerOpen, onToggleViewer }) {
  const facts = [
    chat.document_pages ? `${chat.document_pages} pages` : null,
    chat.document_chars ? `${chat.document_chars.toLocaleString()} characters` : null,
  ].filter(Boolean)

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-neutral-100 px-5 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-brand-blue">
        <FileText className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-brand-black">{chat.title}</p>
        <p className="truncate text-xs text-neutral-400">
          {chat.document_name}
          {facts.length ? ` · ${facts.join(' · ')}` : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={onToggleViewer}
        aria-pressed={viewerOpen}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
          viewerOpen
            ? 'border-brand-blue/30 bg-blue-50 text-brand-blue'
            : 'border-neutral-200 text-neutral-600 hover:border-brand-blue/40 hover:text-brand-blue'
        }`}
      >
        <Eye className="h-3.5 w-3.5" strokeWidth={2} />
        {viewerOpen ? 'Hide document' : 'View document'}
      </button>
    </div>
  )
}

/**
 * The uploaded document, beside the thread on wide screens and over it on narrow ones.
 *
 * The file is fetched with the bearer token and shown from an object URL - an <iframe>
 * pointed at the API could not send the token. A PDF uses the browser's own viewer;
 * text (and chats from before originals were kept) is shown as plain text.
 */
function DocumentViewer({ chat, onClose, onAttached }) {
  const [state, setState] = useState({ status: 'loading' })
  const [attaching, setAttaching] = useState(false)
  const [attachError, setAttachError] = useState(null)
  const attachInput = useRef(null)

  // Only a PDF upload can have an original to attach; a .txt chat's text is the file.
  const canAttach = !chat.has_original && Boolean(chat.document_pages)

  async function handleAttach(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setAttaching(true)
    setAttachError(null)
    try {
      const summary = await attachChatDocument(chat.id, file)
      onAttached(summary)
    } catch (error) {
      setAttachError(error.message)
      setAttaching(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    let objectUrl = null

    fetchChatDocument(chat.id)
      .then(async (blob) => {
        if (cancelled) return
        if (blob.type.startsWith('application/pdf')) {
          objectUrl = URL.createObjectURL(blob)
          setState({ status: 'pdf', url: objectUrl })
        } else {
          const text = await blob.text()
          if (!cancelled) setState({ status: 'text', text })
        }
      })
      .catch((loadError) => {
        if (!cancelled) setState({ status: 'error', message: loadError.message })
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [chat.id])

  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-white lg:static lg:z-auto lg:w-[46%] lg:shrink-0 lg:border-l lg:border-neutral-100">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-100 px-4 py-3">
        <FileText className="h-4 w-4 shrink-0 text-brand-blue" strokeWidth={1.9} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-black">
          {chat.document_name || 'Document'}
        </p>
        {state.status === 'pdf' ? (
          <a
            href={state.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-slate-50 hover:text-brand-blue"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
            Open in new tab
          </a>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close document"
          className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-slate-50 hover:text-neutral-700"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {state.status === 'text' && canAttach ? (
        <div className="shrink-0 border-b border-amber-100 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-900">
            This chat was created before PDFs were saved, so only the text read from it is
            available. Attach the same PDF to view it in its original layout.
          </p>
          <input
            ref={attachInput}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleAttach}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => attachInput.current?.click()}
            disabled={attaching}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-blue-dark disabled:opacity-60"
          >
            {attaching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Upload className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {attaching ? 'Attaching…' : 'Attach original PDF'}
          </button>
          {attachError ? (
            <p className="mt-2 text-xs font-medium text-red-700">{attachError}</p>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 bg-slate-50">
        {state.status === 'loading' ? (
          <p className="flex h-full items-center justify-center gap-2 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            Loading document&hellip;
          </p>
        ) : state.status === 'error' ? (
          <p className="m-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
            {state.message}
          </p>
        ) : state.status === 'pdf' ? (
          <iframe title={chat.document_name || 'Document'} src={state.url} className="h-full w-full" />
        ) : (
          <pre className="h-full overflow-auto whitespace-pre-wrap break-words bg-white p-5 font-sans text-sm leading-relaxed text-neutral-700">
            {state.text}
          </pre>
        )}
      </div>
    </aside>
  )
}

/** One turn. An ungrounded answer is shown as a limit, never as a finding. */
function Message({ message }) {
  if (message.role === 'user') {
    return (
      <p className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-brand-blue px-4 py-2.5 text-sm text-white">
        {message.content}
      </p>
    )
  }

  const grounded = message.grounded !== false

  return (
    <div
      className={`mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border px-4 py-3 ${
        grounded ? 'border-neutral-200 bg-white' : 'border-amber-200 bg-amber-50/70'
      }`}
    >
      {!grounded ? (
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
          <ShieldAlert className="h-3.5 w-3.5" strokeWidth={2} />
          Not in this document
        </p>
      ) : null}

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-brand-black">
        {message.content}
      </p>

      {message.quotes?.length ? (
        <ul className="mt-2.5 space-y-1.5 border-t border-neutral-100 pt-2.5">
          {message.quotes.map((quote, index) => (
            <li
              key={index}
              className="border-l-2 border-brand-blue/40 pl-2.5 text-xs italic leading-relaxed text-neutral-500"
            >
              &ldquo;{quote}&rdquo;
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
