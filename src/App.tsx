import { ArrowDown, Menu, PanelLeftOpen, SquarePen } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from './api.ts'
import { Composer, type ComposerHandle } from './components/Composer.tsx'
import { Login } from './components/Login.tsx'
import { MessageView } from './components/MessageView.tsx'
import { ModelPicker } from './components/ModelPicker.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import type { Attachment, Chat, Message, ModelChoice, ModelOptions, ServerEvent } from './shared.ts'

const ACTIVE = new Set(['queued', 'running', 'stopping'])
const chatIdFromPath = () => /^\/c\/([\w-]+)/.exec(location.pathname)?.[1] ?? null
const isNarrow = () => matchMedia('(max-width: 768px)').matches

const SUGGESTIONS = [
  'Зроби ресерч і порівняй варіанти',
  'Що нового в моїх проєктах у ~/Projects/web?',
  'Нагадай мені завтра о 10:00',
  'Підсумуй цей PDF',
]

function sortChats(list: Chat[]) {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

function upsert(list: Message[], m: Message) {
  const i = list.findIndex((x) => x.id === m.id)
  if (i < 0) return [...list, m].sort((a, b) => a.createdAt - b.createdAt)
  const next = list.slice()
  next[i] = m
  return next
}

export default function App() {
  const [auth, setAuth] = useState<'unknown' | 'out' | 'in'>('unknown')
  const [username, setUsername] = useState('')
  const [chats, setChats] = useState<Chat[]>([])
  const [currentId, setCurrentId] = useState<string | null>(chatIdFromPath)
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [models, setModels] = useState<ModelOptions | null>(null)
  const [newModel, setNewModel] = useState<ModelChoice>(null)
  const [sidebar, setSidebar] = useState(() => !isNarrow())
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<ComposerHandle>(null)
  const stick = useRef(true)

  const current = chats.find((c) => c.id === currentId) ?? null
  const list = currentId ? messages[currentId] : undefined
  const runningMsg = list?.findLast((m) => m.role === 'assistant' && ACTIVE.has(m.status)) ?? null

  // ---------- Завантаження ----------

  const loadChats = useCallback(() => api.chats().then((c) => setChats(sortChats(c))), [])
  const loadChat = useCallback(async (id: string) => {
    try {
      const r = await api.chat(id)
      setMessages((m) => ({ ...m, [id]: r.messages }))
      setChats((c) => sortChats([...c.filter((x) => x.id !== id), r.chat]))
    } catch (e) {
      if ((e as { status?: number }).status === 404) navigate(null, true)
    }
  }, [])

  useEffect(() => {
    api
      .me()
      .then((r) => (setUsername(r.username), setAuth('in')))
      .catch(() => setAuth('out'))
    const out = () => setAuth('out')
    window.addEventListener('chat:unauthorized', out)
    return () => window.removeEventListener('chat:unauthorized', out)
  }, [])

  useEffect(() => {
    if (auth !== 'in') return
    void loadChats()
    api.models().then(setModels).catch(() => {})
  }, [auth, loadChats])

  useEffect(() => {
    if (auth === 'in' && currentId) void loadChat(currentId)
  }, [auth, currentId, loadChat])

  // ---------- Події з сервера ----------

  const currentRef = useRef(currentId)
  currentRef.current = currentId
  useEffect(() => {
    if (auth !== 'in') return
    const es = new EventSource('/api/events')
    let wasDown = false
    es.onopen = () => {
      if (!wasDown) return
      wasDown = false
      void loadChats()
      if (currentRef.current) void loadChat(currentRef.current)
    }
    es.onerror = () => {
      wasDown = true
    }
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data) as ServerEvent
      if (e.type === 'message') {
        setMessages((all) => (all[e.message.chatId] ? { ...all, [e.message.chatId]: upsert(all[e.message.chatId]!, e.message) } : all))
      } else if (e.type === 'chat') {
        setChats((c) => sortChats([...c.filter((x) => x.id !== e.chat.id), e.chat]))
      } else if (e.type === 'chat-deleted') {
        setChats((c) => c.filter((x) => x.id !== e.chatId))
        if (currentRef.current === e.chatId) navigate(null, true)
      }
    }
    return () => es.close()
  }, [auth, loadChats, loadChat])

  // ---------- Навігація ----------

  const navigate = (id: string | null, replace = false) => {
    const url = id ? `/c/${id}` : '/'
    if (location.pathname !== url) history[replace ? 'replaceState' : 'pushState'](null, '', url)
    setCurrentId(id)
    stick.current = true
    if (isNarrow()) setSidebar(false)
  }

  useEffect(() => {
    const onPop = () => setCurrentId(chatIdFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    document.title = current?.title ? `${current.title} · Hermes` : 'Hermes'
  }, [current?.title])

  // ---------- Прокрутка ----------

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [list])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stick.current = near
    setAtBottom(near)
  }

  // ---------- Дії ----------

  const flash = (e: unknown) => {
    setError((e as Error).message)
    setTimeout(() => setError(''), 6000)
  }

  const send = async (text: string, attachments: Attachment[]) => {
    try {
      const r = await api.send({
        chatId: currentId ?? undefined,
        text,
        attachments: attachments.map((a) => a.id),
        ...(currentId ? {} : { model: newModel }),
      })
      setChats((c) => sortChats([...c.filter((x) => x.id !== r.chat.id), r.chat]))
      setMessages((m) => {
        let l = m[r.chat.id] ?? []
        for (const msg of r.messages) l = upsert(l, msg)
        return { ...m, [r.chat.id]: l }
      })
      stick.current = true
      if (!currentId) {
        setNewModel(null)
        navigate(r.chat.id)
      }
      return true
    } catch (e) {
      flash(e)
      return false
    }
  }

  const steer = async (text: string) => {
    if (!runningMsg) return false
    try {
      await api.steer(runningMsg.id, text)
      return true
    } catch (e) {
      flash(e)
      return false
    }
  }

  const stop = () => {
    if (runningMsg) api.stop(runningMsg.id).catch(flash)
  }

  const setModel = (v: ModelChoice) => {
    if (!current) return setNewModel(v)
    setChats((c) => c.map((x) => (x.id === current.id ? { ...x, model: v } : x)))
    api.patchChat(current.id, { model: v }).catch(flash)
  }

  const newChat = () => {
    navigate(null)
    setTimeout(() => composer.current?.focus(), 0)
  }

  const empty = !currentId || (list && list.length === 0)
  const composerEl = (
    <Composer ref={composer} draftKey={currentId ?? 'new'} running={Boolean(runningMsg)} onSend={send} onStop={stop} onSteer={steer} />
  )
  const header = (
      <header className="topbar">
        <div className="topbar-left">
          {!sidebar && (
            <>
              <button type="button" className="icon-btn" aria-label="Показати панель" title="Показати панель" onClick={() => setSidebar(true)}>
                <span className="only-wide">
                  <PanelLeftOpen size={20} />
                </span>
                <span className="only-narrow">
                  <Menu size={20} />
                </span>
              </button>
              <button type="button" className="icon-btn only-wide" aria-label="Новий чат" title="Новий чат" onClick={newChat}>
                <SquarePen size={19} />
              </button>
            </>
          )}
          <ModelPicker value={current ? current.model : newModel} options={models} onChange={setModel} />
        </div>
        <button type="button" className="icon-btn only-narrow" aria-label="Новий чат" onClick={newChat}>
          <SquarePen size={19} />
        </button>
      </header>
  )

  if (auth === 'unknown') return <div className="boot" />
  if (auth === 'out') return <Login onDone={() => api.me().then((r) => (setUsername(r.username), setAuth('in')))} />

  return (
    <div className={`app ${sidebar ? 'sidebar-open' : ''}`}>
      {sidebar && (
        <>
          <div className="scrim" onClick={() => setSidebar(false)} />
          <Sidebar
            chats={chats}
            currentId={currentId}
            username={username}
            onSelect={(id) => navigate(id)}
            onNew={newChat}
            onClose={() => setSidebar(false)}
            onRename={(id, title) => {
              setChats((c) => c.map((x) => (x.id === id ? { ...x, title } : x)))
              api.patchChat(id, { title }).catch(flash)
            }}
            onPin={(id, pinned) => {
              setChats((c) => sortChats(c.map((x) => (x.id === id ? { ...x, pinned } : x))))
              api.patchChat(id, { pinned }).catch(flash)
            }}
            onDelete={(id) => {
              setChats((c) => c.filter((x) => x.id !== id))
              if (id === currentId) navigate(null, true)
              api.deleteChat(id).catch(flash)
            }}
            onLogout={() => api.logout().finally(() => setAuth('out'))}
          />
        </>
      )}
      <main
        className="main"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length) composer.current?.addFiles(e.dataTransfer.files)
        }}
      >
        {header}
        {empty ? (
          <div className="welcome">
            <h1 className="welcome-title">{list ? 'Чим можу допомогти?' : currentId ? '' : 'Чим можу допомогти?'}</h1>
            {composerEl}
            {!currentId && (
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="suggestion" onClick={() => void send(s, [])}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="thread" ref={scroller} onScroll={onScroll}>
              <div className="thread-inner">
                {list?.map((m) => (
                  <MessageView key={m.id} m={m} />
                ))}
              </div>
            </div>
            {!atBottom && (
              <button
                type="button"
                className="to-bottom"
                aria-label="Донизу"
                onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })}
              >
                <ArrowDown size={18} />
              </button>
            )}
            <div className="bottom">{composerEl}</div>
          </>
        )}
        {dragging && <div className="drop-overlay">Перетягни файли сюди, щоб додати їх до повідомлення</div>}
        {error && <div className="toast">{error}</div>}
      </main>
    </div>
  )
}
