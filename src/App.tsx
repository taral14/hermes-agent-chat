import { ArrowDown, Menu, PanelLeftOpen, Share, SquarePen } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type CommandInfo, api } from './api.ts'
import { Composer, type ComposerHandle, setDraft } from './components/Composer.tsx'
import { type KbRoute, KbView } from './components/Kb.tsx'
import { kb, notePath, obsidianUriToPath } from './kb.ts'
import { JobsView, type JobsRoute } from './components/Jobs.tsx'
import { Login } from './components/Login.tsx'
import { Notifications } from './components/Notifications.tsx'
import { Security } from './components/Security.tsx'
import { Settings } from './components/Settings.tsx'
import { ShareSheet } from './components/ShareSheet.tsx'
import { reportPresence } from './push.ts'
import { ActionsContext, type MessageActions, MessageView } from './components/MessageView.tsx'
import { GoalBar } from './components/GoalBar.tsx'
import { ModelPicker } from './components/ModelPicker.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import type { Attachment, Chat, ChatList, ChatMode, ChatPrefs, Message, ModelChoice, ModelOptions, ServerEvent } from './shared.ts'

const ACTIVE = new Set(['queued', 'running', 'stopping'])
const chatIdFromPath = () => /^\/c\/([\w-]+)/.exec(location.pathname)?.[1] ?? null
function jobsFromPath(): JobsRoute | null {
  const m = /^\/jobs(?:\/([\w-]+))?\/?$/.exec(location.pathname)
  if (!m) return null
  if (!m[1]) return { kind: 'list' }
  return m[1] === 'new' ? { kind: 'new' } : { kind: 'job', id: m[1] }
}
function kbFromPath(): KbRoute | null {
  const p = location.pathname
  if (p === '/kb' || p === '/kb/') return { kind: 'home' }
  if (p === '/kb/graph') return { kind: 'graph', focus: new URLSearchParams(location.search).get('focus') ?? undefined }
  if (p.startsWith('/kb/n/')) return { kind: 'note', path: p.slice(6).split('/').map(decodeURIComponent).join('/') }
  return null
}
const kbPath = (r: KbRoute) =>
  r.kind === 'home' ? '/kb' : r.kind === 'graph' ? `/kb/graph${r.focus ? `?focus=${encodeURIComponent(r.focus)}` : ''}` : notePath(r.path)
const jobsPath = (r: JobsRoute) => (r.kind === 'list' ? '/jobs' : r.kind === 'new' ? '/jobs/new' : `/jobs/${r.id}`)
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
  const [lists, setLists] = useState<ChatList[]>([])
  /** Список, у якому буде створено наступний новий чат. */
  const [newListId, setNewListId] = useState<string | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(chatIdFromPath)
  const [jobsRoute, setJobsRoute] = useState<JobsRoute | null>(jobsFromPath)
  const [kbRoute, setKbRoute] = useState<KbRoute | null>(kbFromPath)
  const [kbVersion, setKbVersion] = useState(0)
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [models, setModels] = useState<ModelOptions | null>(null)
  const [commands, setCommands] = useState<CommandInfo[] | null>(null)
  const [newModel, setNewModel] = useState<ModelChoice>(null)
  const [newMode, setNewMode] = useState<ChatMode>('auto')
  const [sidebar, setSidebar] = useState(() => !isNarrow())
  const [narrow, setNarrow] = useState(isNarrow)
  useEffect(() => {
    const mq = matchMedia('(max-width: 768px)')
    const on = () => {
      setNarrow(mq.matches)
      setSidebar(!mq.matches)
    }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  // Свайп від лівого краю відкриває меню, свайп уліво — закриває (як у ChatGPT).
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [notif, setNotif] = useState(false)
  const [security, setSecurity] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Спільні налаштування: режим і модель, з якими стартують нові чати. */
  const defaults = useRef<ChatPrefs | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<ComposerHandle>(null)
  const stick = useRef(true)

  const current = chats.find((c) => c.id === currentId) ?? null
  const list = currentId ? messages[currentId] : undefined
  const runningMsg = list?.findLast((m) => m.role === 'assistant' && ACTIVE.has(m.status)) ?? null

  // ---------- Завантаження ----------

  const onLoggedIn = useCallback(() => {
    api.me().then((r) => {
      setUsername(r.username)
      setAuth('in')
    })
  }, [])

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
    api.commands().then(setCommands).catch(() => {})
    api
      .settings()
      .then((i) => {
        defaults.current = i.prefs
        setNewMode(i.prefs.defaultMode)
        setNewModel(i.prefs.defaultModel)
      })
      .catch(() => {})
    api.lists().then(setLists).catch(() => {})
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
      } else if (e.type === 'lists') {
        setLists(e.lists)
      } else if (e.type === 'kb') {
        setKbVersion((v) => v + 1)
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
    setJobsRoute(null)
    setKbRoute(null)
    setCurrentId(id)
    stick.current = true
    if (isNarrow()) setSidebar(false)
  }

  const goJobs = useCallback((r: JobsRoute | null) => {
    if (!r) return navigate(null)
    const url = jobsPath(r)
    if (location.pathname !== url) history.pushState(null, '', url)
    setJobsRoute(r)
    setKbRoute(null)
    setCurrentId(null)
    if (isNarrow()) setSidebar(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goKb = useCallback((r: KbRoute) => {
    const url = kbPath(r)
    if (location.pathname + location.search !== url) history.pushState(null, '', url)
    setKbRoute(r)
    setJobsRoute(null)
    setCurrentId(null)
    if (isNarrow()) setSidebar(false)
  }, [])

  // Посилання obsidian:// у відповідях Hermes ведуть у базу знань.
  useEffect(() => {
    let vaultName: string | null = null
    const on = async (e: Event) => {
      const href = (e as CustomEvent<string>).detail
      try {
        vaultName ??= (await kb.index()).name
        const path = obsidianUriToPath(href, vaultName)
        if (path) goKb({ kind: 'note', path })
      } catch {
        window.open(href, '_blank')
      }
    }
    window.addEventListener('chat:obsidian', on)
    return () => window.removeEventListener('chat:obsidian', on)
  }, [goKb])

  useEffect(() => {
    const onPop = () => {
      setCurrentId(chatIdFromPath())
      setJobsRoute(jobsFromPath())
      setKbRoute(kbFromPath())
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Сервер не шле пуш про чат, який зараз відкритий у видимій вкладці.
  useEffect(() => {
    if (auth !== 'in') return
    const report = () => reportPresence(currentId)
    report()
    const t = setInterval(() => document.visibilityState === 'visible' && report(), 60_000)
    document.addEventListener('visibilitychange', report)
    window.addEventListener('focus', report)
    window.addEventListener('blur', report)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', report)
      window.removeEventListener('focus', report)
      window.removeEventListener('blur', report)
    }
  }, [auth, currentId])

  // Клік по сповіщенню у вже відкритому вікні: service worker просить перейти на потрібну сторінку.
  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    const onMsg = (e: MessageEvent<{ type?: string; url?: string }>) => {
      if (e.data?.type !== 'navigate' || !e.data.url) return
      history.pushState(null, '', e.data.url)
      setCurrentId(chatIdFromPath())
      setJobsRoute(jobsFromPath())
      setKbRoute(kbFromPath())
    }
    sw.addEventListener('message', onMsg)
    return () => sw.removeEventListener('message', onMsg)
  }, [])

  useEffect(() => {
    document.title = kbRoute ? 'База знань · Hermes' : jobsRoute ? 'Розклад · Hermes' : current?.title ? `${current.title} · Hermes` : 'Hermes'
  }, [current?.title, jobsRoute, kbRoute])

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

  const flash = useCallback((e: unknown) => {
    setError((e as Error).message)
    setTimeout(() => setError(''), 6000)
  }, [])

  const send = async (text: string, attachments: Attachment[]) => {
    try {
      const r = await api.send({
        chatId: currentId ?? undefined,
        text,
        attachments: attachments.map((a) => a.id),
        ...(currentId ? {} : { model: newModel, mode: newMode, ...(newListId ? { listId: newListId } : {}) }),
      })
      setChats((c) => sortChats([...c.filter((x) => x.id !== r.chat.id), r.chat]))
      setMessages((m) => {
        let l = m[r.chat.id] ?? []
        for (const msg of r.messages) l = upsert(l, msg)
        return { ...m, [r.chat.id]: l }
      })
      stick.current = true
      if (!currentId) {
        setNewModel(defaults.current?.defaultModel ?? null)
        setNewMode(defaults.current?.defaultMode ?? 'auto')
        setNewListId(null)
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
    setNewListId(null)
    navigate(null)
    setTimeout(() => composer.current?.focus(), 0)
  }

  const empty = !currentId || (list && list.length === 0)
  // Нові чати — на рідному протоколі Hermes; старі (до оновлення) — без команд і повтору.
  const native = !current || Boolean(current.native)
  const composerEl = (
    <Composer
      ref={composer}
      draftKey={currentId ?? 'new'}
      running={Boolean(runningMsg)}
      onSend={send}
      onStop={stop}
      onSteer={steer}
      commands={native ? commands : null}
      modelSlot={<ModelPicker value={current ? current.model : newModel} options={models} onChange={setModel} narrow={narrow} />}
      mode={native ? (current?.mode ?? newMode) : undefined}
      onMode={(m) => {
        if (!current) return setNewMode(m)
        setChats((c) => c.map((x) => (x.id === current.id ? { ...x, mode: m } : x)))
        api.patchChat(current.id, { mode: m }).catch(flash)
      }}
    />
  )

  const applyChat = (r: { chat: Chat; messages: Message[] }) => {
    setChats((c) => sortChats([...c.filter((x) => x.id !== r.chat.id), r.chat]))
    setMessages((all) => ({ ...all, [r.chat.id]: r.messages }))
    stick.current = true
  }
  const actions = useMemo<MessageActions>(
    () => ({
      enabled: native && !runningMsg,
      retry: async (m) => {
        try {
          applyChat(await api.retry(m.id))
        } catch (e) {
          flash(e)
        }
      },
      edit: async (m, text) => {
        try {
          applyChat(await api.edit(m.id, text))
        } catch (e) {
          flash(e)
          throw e
        }
      },
      branch: async (m) => {
        try {
          const r = await api.branch(m.id)
          await loadChats()
          navigate(r.chatId)
        } catch (e) {
          flash(e)
        }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [native, runningMsg, flash, loadChats],
  )
  const header = (
      <header className="topbar">
        <div className="topbar-left">
          {(!sidebar || narrow) && (
            <>
              <button type="button" className="icon-btn m-menu-btn" aria-label="Показати панель" title="Показати панель" onClick={() => setSidebar(true)}>
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
          <span className="topbar-title">{current?.title || 'Hermes'}</span>
        </div>
        <div className="topbar-right">
          {current && (list?.length ?? 0) > 0 && (
            <button type="button" className="topbar-share" aria-label="Поділитися" title="Поділитися" onClick={() => setSharing(true)}>
              <Share size={18} />
              <span className="only-wide">Поділитися</span>
            </button>
          )}
          <button type="button" className="icon-btn only-narrow m-menu-btn" aria-label="Новий чат" onClick={newChat}>
            <SquarePen size={19} />
          </button>
        </div>
      </header>
  )

  if (auth === 'unknown') return <div className="boot" />
  if (auth === 'out') return <Login onDone={onLoggedIn} />

  return (
    <div
      className={`app ${sidebar ? 'sidebar-open' : ''} ${narrow ? 'is-narrow' : ''}`}
      onTouchStart={(e) => {
        const t = e.touches[0]!
        swipe.current = narrow && (sidebar || t.clientX < 32) ? { x: t.clientX, y: t.clientY } : null
      }}
      onTouchEnd={(e) => {
        const s0 = swipe.current
        swipe.current = null
        if (!s0) return
        const t = e.changedTouches[0]!
        const dx = t.clientX - s0.x
        if (Math.abs(t.clientY - s0.y) > 60) return
        if (!sidebar && dx > 50) setSidebar(true)
        if (sidebar && dx < -60) setSidebar(false)
      }}
    >
      {(sidebar || narrow) && (
        <>
          {sidebar && <div className="scrim" onClick={() => setSidebar(false)} />}
          <Sidebar
            narrow={narrow}
            chats={chats}
            currentId={currentId}
            username={username}
            onSelect={(id) => navigate(id)}
            onNew={newChat}
            jobsActive={Boolean(jobsRoute)}
            onJobs={() => goJobs({ kind: 'list' })}
            onKb={() => goKb({ kind: 'home' })}
            kbActive={Boolean(kbRoute)}
            onSettings={() => {
              if (isNarrow()) setSidebar(false)
              setSettingsOpen(true)
            }}
            onClose={() => setSidebar(false)}
            lists={lists}
            onMoveToList={(id, listId) => {
              setChats((c) => c.map((x) => (x.id === id ? { ...x, listId } : x)))
              api.patchChat(id, { listId }).catch(flash)
            }}
            onCreateList={async (name) => {
              try {
                const l = await api.createList(name)
                setLists((ls) => (ls.some((x) => x.id === l.id) ? ls : [...ls, l]))
                return l
              } catch (e) {
                flash(e)
                return null
              }
            }}
            onRenameList={(id, name) => {
              setLists((ls) => ls.map((l) => (l.id === id ? { ...l, name } : l)))
              api.renameList(id, name).catch(flash)
            }}
            onDeleteList={(id) => {
              setLists((ls) => ls.filter((l) => l.id !== id))
              setChats((c) => c.map((x) => (x.listId === id ? { ...x, listId: null } : x)))
              api.deleteList(id).catch(flash)
            }}
            onNewInList={(listId) => {
              setNewListId(listId)
              navigate(null)
              setTimeout(() => composer.current?.focus(), 0)
            }}
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
          />
        </>
      )}
      <main
        className="main"
        onDragOver={(e) => {
          if (jobsRoute || kbRoute || !e.dataTransfer.types.includes('Files')) return
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
        {kbRoute ? (
          <KbView
            route={kbRoute}
            go={goKb}
            back={() => (history.length > 1 ? history.back() : goKb({ kind: 'home' }))}
            sidebarOpen={sidebar && !narrow}
            openSidebar={() => setSidebar(true)}
            version={kbVersion}
            discuss={(note) => {
              setDraft('new', `Нотатка «${note.title}» з бази знань (${note.path}). `)
              navigate(null)
            }}
          />
        ) : jobsRoute ? (
          <JobsView route={jobsRoute} go={goJobs} sidebarOpen={sidebar && !narrow} openSidebar={() => setSidebar(true)} flash={flash} />
        ) : (
          <>
        {header}
        {empty ? (
          <div className="welcome">
            {!currentId && newListId && lists.find((l) => l.id === newListId) && (
              <div className="welcome-list">
                <span className="welcome-list-dot" style={{ background: lists.find((l) => l.id === newListId)!.color }} />
                Новий чат у списку «{lists.find((l) => l.id === newListId)!.name}»
              </div>
            )}
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
                <ActionsContext.Provider value={actions}>
                  {list?.map((m) => (
                    <MessageView key={m.id} m={m} />
                  ))}
                </ActionsContext.Provider>
              </div>
            </div>
            <div className="bottom">
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
              {current && <GoalBar chat={current} flash={flash} />}
              {composerEl}
            </div>
          </>
        )}
          </>
        )}
        {dragging && <div className="drop-overlay">Перетягни файли сюди, щоб додати їх до повідомлення</div>}
        {error && <div className="toast">{error}</div>}
        {settingsOpen && (
          <Settings
            narrow={narrow}
            username={username}
            models={models}
            onClose={() => setSettingsOpen(false)}
            onNotifications={() => setNotif(true)}
            onSecurity={() => setSecurity(true)}
            onLogout={() => {
              setSettingsOpen(false)
              void api.logout().finally(() => setAuth('out'))
            }}
            onPrefs={(p) => {
              const prev = defaults.current
              defaults.current = p
              // Нового чату ще не почато: одразу показуємо нові значення за замовчуванням.
              if (prev?.defaultMode !== p.defaultMode) setNewMode(p.defaultMode)
              if (JSON.stringify(prev?.defaultModel) !== JSON.stringify(p.defaultModel)) setNewModel(p.defaultModel)
            }}
            onDeletedAll={() => {
              setChats([])
              setMessages({})
              navigate(null, true)
            }}
          />
        )}
        {notif && <Notifications onClose={() => setNotif(false)} />}
        {security && <Security onClose={() => setSecurity(false)} />}
        {sharing && current && <ShareSheet chat={current} onClose={() => setSharing(false)} />}
      </main>
    </div>
  )
}
