import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type CommandInfo, api } from './api.ts'
import { on } from './bus.ts'
import { ChatPane } from './components/ChatPane.tsx'
import { Composer, type ComposerHandle, setDraft } from './components/Composer.tsx'
import { FileViewerHost } from './components/FileViewer.tsx'
import { JobsView, type JobsRoute } from './components/Jobs.tsx'
import { JobSheet } from './components/JobSheet.tsx'
import { type KbRoute, KbView } from './components/Kb.tsx'
import { Login } from './components/Login.tsx'
import { answerClarify } from './components/message/Prompts.tsx'
import type { MessageActions } from './components/MessageView.tsx'
import { ModelPicker } from './components/ModelPicker.tsx'
import { Notifications } from './components/Notifications.tsx'
import { Security } from './components/Security.tsx'
import { Settings } from './components/Settings.tsx'
import { ShareSheet } from './components/ShareSheet.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { useChats } from './hooks/useChats.ts'
import { useVisible } from './hooks/useVisible.ts'
import { holdKeyboard } from './keyboard.ts'
import { kb, obsidianUriToPath } from './kb.ts'
import { reportPresence } from './push.ts'
import { chatUrl, jobsUrl, kbUrl, navigateTo, pluginsUrl, useRoute } from './router.ts'
import type { Attachment, ChatMode, ChatPrefs, ModelChoice, ModelOptions, Part } from './shared.ts'

const ACTIVE = new Set(['queued', 'running', 'stopping'])
const NARROW = '(max-width: 768px)'
const isNarrow = () => matchMedia(NARROW).matches

const navigate = (id: string | null, replace = false) => navigateTo(chatUrl(id), replace)
/** Плагіни тягнуть іконки брендів (~60 КБ): вантажимо сторінку окремо, коли її відкривають. */
const PluginsView = lazy(() => import('./components/plugins/PluginsView.tsx').then((m) => ({ default: m.PluginsView })))

const goJobs = (r: JobsRoute | null) => (r ? navigateTo(jobsUrl(r)) : navigate(null))
const goKb = (r: KbRoute) => navigateTo(kbUrl(r))

export default function App() {
  const [auth, setAuth] = useState<'unknown' | 'out' | 'in'>('unknown')
  const [username, setUsername] = useState('')
  /** База знань увімкнена на сервері (VAULT_PATH); null — ще не знаємо. */
  const [kbEnabled, setKbEnabled] = useState<boolean | null>(null)
  const route = useRoute()
  const currentId = route.kind === 'chat' ? route.id : null
  const routeRef = useRef(route)
  routeRef.current = route

  const [error, setError] = useState('')
  const toast = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flash = useCallback((e: unknown) => {
    setError((e as Error).message)
    clearTimeout(toast.current)
    toast.current = setTimeout(() => setError(''), 6000)
  }, [])

  const store = useChats(auth === 'in', {
    // Чат видалили (тут чи в іншій вкладці) або його немає: якщо він відкритий — на новий чат.
    onGone: (id) => {
      if (routeRef.current.kind === 'chat' && routeRef.current.id === id) navigate(null, true)
    },
    onError: flash,
  })
  const { chats, lists, messages, applyChat, loadChat } = store

  /** Список, у якому буде створено наступний новий чат. */
  const [newListId, setNewListId] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOptions | null>(null)
  const [commands, setCommands] = useState<CommandInfo[] | null>(null)
  const [newModel, setNewModel] = useState<ModelChoice>(null)
  const [newMode, setNewMode] = useState<ChatMode>('auto')
  /** Спільні налаштування: режим і модель, з якими стартують нові чати. */
  const defaults = useRef<ChatPrefs | null>(null)

  const [sidebar, setSidebar] = useState(() => !isNarrow())
  const [narrow, setNarrow] = useState(isNarrow)
  useEffect(() => {
    const mq = matchMedia(NARROW)
    const change = () => {
      setNarrow(mq.matches)
      setSidebar(!mq.matches)
    }
    mq.addEventListener('change', change)
    return () => mq.removeEventListener('change', change)
  }, [])
  // На телефоні панель ховається після переходу на іншу сторінку.
  useEffect(() => {
    if (isNarrow()) setSidebar(false)
  }, [route])

  // Свайп від лівого краю відкриває меню, свайп уліво — закриває (як у ChatGPT).
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [notif, setNotif] = useState(false)
  const [security, setSecurity] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [jobSheet, setJobSheet] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const closeNotif = useCallback(() => setNotif(false), [])
  const closeSecurity = useCallback(() => setSecurity(false), [])
  const closeSharing = useCallback(() => setSharing(false), [])
  const closeJobSheet = useCallback(() => setJobSheet(null), [])
  const composer = useRef<ComposerHandle>(null)

  const current = chats.find((c) => c.id === currentId) ?? null
  /** Непрочитане в чатах зі сповіщеннями: число на іконці застосунку й на кнопці меню. */
  const unreadTotal = chats.reduce((n, c) => n + (c.muted ? 0 : c.unread), 0)
  const list = currentId ? messages[currentId] : undefined
  const runningMsg = list?.findLast((m) => m.role === 'assistant' && ACTIVE.has(m.status)) ?? null
  const asking = runningMsg?.parts.find((p): p is Extract<Part, { type: 'clarify' }> => p.type === 'clarify' && p.state === 'pending') ?? null

  // ---------- Вхід і початкові дані ----------

  const onLoggedIn = useCallback(() => {
    api.me().then((r) => {
      setUsername(r.username)
      setKbEnabled(r.kb)
      setAuth('in')
    })
  }, [])

  useEffect(() => {
    api
      .me()
      .then((r) => (setUsername(r.username), setKbEnabled(r.kb), setAuth('in')))
      .catch(() => setAuth('out'))
    return on('unauthorized', () => setAuth('out'))
  }, [])

  useEffect(() => {
    if (auth !== 'in') return
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
  }, [auth])

  useEffect(() => {
    if (auth === 'in' && currentId) void loadChat(currentId)
  }, [auth, currentId, loadChat])

  // Базу знань вимкнено на сервері, а адреса веде в неї (стара закладка): на головну.
  useEffect(() => {
    if (kbEnabled === false && route.kind === 'kb') navigateTo('/', true)
  }, [kbEnabled, route.kind])

  // ---------- Події з відповідей і сповіщень ----------

  useEffect(() => {
    let vaultName: string | null = null
    const offs = [
      // Посилання obsidian:// у відповідях Hermes ведуть у базу знань.
      on('obsidian', (href) => {
        void (async () => {
          try {
            vaultName ??= (await kb.index()).name
            const path = obsidianUriToPath(href, vaultName)
            if (path) goKb({ kind: 'note', path })
          } catch {
            window.open(href, '_blank')
          }
        })()
      }),
      // Згадка нотатки у відповіді Hermes (шлях чи [[назва]]), уже знайдена в базі знань.
      on('kbnote', (path) => goKb({ kind: 'note', path })),
      // Задача за розкладом (смужка в чаті, плашка над результатом, чипи) — налаштування поверх чату.
      on('job', setJobSheet),
      on('navigate', (url) => navigateTo(url)),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Клік по сповіщенню у вже відкритому вікні: service worker просить перейти на потрібну сторінку.
  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    const onMsg = (e: MessageEvent<{ type?: string; url?: string }>) => {
      if (e.data?.type === 'navigate' && e.data.url) navigateTo(e.data.url)
    }
    sw.addEventListener('message', onMsg)
    return () => sw.removeEventListener('message', onMsg)
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

  // Чат на екрані — прочитаний: і той, що відкрили, і відповідь, що прийшла, поки на нього дивляться.
  // На телефоні відкрита панель закриває чат, тож тоді ще не прочитано.
  const visible = useVisible()
  const currentUnread = current?.unread ?? 0
  const { markRead } = store
  const covered = narrow && sidebar
  useEffect(() => {
    if (currentId && currentUnread && visible && !covered) markRead(currentId)
  }, [currentId, currentUnread, visible, covered, markRead])

  // Бейдж на іконці ставить і пуш, поки застосунок згорнутий: тоді число тут могло не змінитись (відповідь
  // прочитали деінде чи вже після пуша), тож звіряємо його ще й щоразу, як застосунок відкривають.
  useEffect(() => {
    if (auth !== 'in' || !('setAppBadge' in navigator)) return
    void (unreadTotal ? navigator.setAppBadge(unreadTotal) : navigator.clearAppBadge()).catch(() => {})
  }, [auth, unreadTotal, visible])

  useEffect(() => {
    const page =
      route.kind === 'kb'
        ? 'База знань · Hermes'
        : route.kind === 'jobs'
          ? 'Розклад · Hermes'
          : route.kind === 'plugins'
            ? 'Плагіни · Hermes'
            : current?.title
              ? `${current.title} · Hermes`
              : 'Hermes'
    document.title = unreadTotal ? `(${unreadTotal}) ${page}` : page
  }, [current?.title, route.kind, unreadTotal])

  // ---------- Дії ----------

  const send = async (text: string, attachments: Attachment[]) => {
    try {
      const r = await api.send({
        chatId: currentId ?? undefined,
        text,
        attachments: attachments.map((a) => a.id),
        ...(currentId ? {} : { model: newModel, mode: newMode, ...(newListId ? { listId: newListId } : {}) }),
      })
      applyChat(r)
      if (!currentId) {
        setNewModel(defaults.current?.defaultModel ?? null)
        setNewMode(defaults.current?.defaultMode ?? 'auto')
        setNewListId(null)
        // Переходимо в новий чат, лише якщо людина ще на сторінці нового чату.
        const now = routeRef.current
        if (now.kind === 'chat' && !now.id) navigate(r.chat.id)
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
      // Hermes чекає відповіді на питання: текст із поля — це «свій варіант», а не доповнення задачі.
      if (asking) await answerClarify(runningMsg, asking, text)
      else if (/^\/btw\s+\S/.test(text)) await api.btw(runningMsg.id, text.replace(/^\/btw\s+/, ''))
      else await api.steer(runningMsg.id, text)
      return true
    } catch (e) {
      flash(e)
      return false
    }
  }

  /** Питання «до речі»: Hermes відповідає окремо, задача не переривається. */
  const btw = async (text: string) => {
    if (!runningMsg) return false
    try {
      await api.btw(runningMsg.id, text)
      return true
    } catch (e) {
      flash(e)
      return false
    }
  }

  const stop = () => {
    if (runningMsg) api.stop(runningMsg.id).catch(flash)
  }

  const setModel = (v: ModelChoice) => (current ? store.patchChat(current.id, { model: v }) : setNewModel(v))
  const setMode = (m: ChatMode) => (current ? store.patchChat(current.id, { mode: m }) : setNewMode(m))

  /** Новий чат одразу з курсором у полі вводу (і відкритою клавіатурою на телефоні, див. keyboard.ts). */
  const newChat = (listId: string | null = null) => {
    const release = holdKeyboard()
    // Якщо новий чат уже відкрито, адреса не зміниться, і панель сама не сховається.
    if (isNarrow()) setSidebar(false)
    setNewListId(listId)
    navigate(null)
    setTimeout(() => {
      composer.current?.focus()
      release()
    }, 50)
  }

  // Чати старої версії (до рідного протоколу Hermes) лишаються лише для читання.
  const native = !current || Boolean(current.native)
  const enabled = native && !runningMsg
  const actions = useMemo<MessageActions>(
    () => ({
      enabled,
      retry: async (m) => {
        try {
          applyChat(await api.retry(m.id), true)
        } catch (e) {
          flash(e)
        }
      },
      edit: async (m, text) => {
        try {
          applyChat(await api.edit(m.id, text), true)
        } catch (e) {
          flash(e)
          throw e
        }
      },
      branch: async (m) => {
        try {
          navigate((await api.branch(m.id)).chatId)
        } catch (e) {
          flash(e)
        }
      },
    }),
    [enabled, applyChat, flash],
  )

  const composerEl = native ? (
    <Composer
      ref={composer}
      draftKey={currentId ?? 'new'}
      running={Boolean(runningMsg)}
      answering={Boolean(asking)}
      onSend={send}
      onStop={stop}
      onSteer={steer}
      onBtw={btw}
      onError={flash}
      commands={commands}
      modelSlot={<ModelPicker value={current ? current.model : newModel} options={models} onChange={setModel} narrow={narrow} />}
      mode={current?.mode ?? newMode}
      onMode={setMode}
    />
  ) : (
    <div className="composer-legacy">Цей чат створено старою версією: його можна читати, а продовжити розмову — у новому чаті.</div>
  )

  const newList = !currentId && newListId ? lists.find((l) => l.id === newListId) : undefined

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
            onSelect={(id) => {
              // Той самий чат: адреса не зміниться, тож панель ховаємо самі.
              if (isNarrow()) setSidebar(false)
              navigate(id)
            }}
            onNew={() => newChat()}
            onKb={kbEnabled ? () => goKb({ kind: 'home' }) : undefined}
            kbActive={route.kind === 'kb'}
            onPlugins={() => navigateTo(pluginsUrl())}
            pluginsActive={route.kind === 'plugins'}
            onSettings={() => {
              if (isNarrow()) setSidebar(false)
              setSettingsOpen(true)
            }}
            onClose={() => setSidebar(false)}
            lists={lists}
            onMoveToList={(id, listId) => store.patchChat(id, { listId })}
            onCreateList={store.createList}
            onRenameList={store.renameList}
            onDeleteList={store.deleteList}
            onNewInList={(listId) => newChat(listId)}
            onRename={(id, title) => store.patchChat(id, { title })}
            onPin={(id, pinned) => store.patchChat(id, { pinned })}
            onRead={markRead}
            onDelete={store.removeChat}
          />
        </>
      )}
      <main
        className="main"
        onDragOver={(e) => {
          if (route.kind !== 'chat' || !native || !e.dataTransfer.types.includes('Files')) return
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
        {route.kind === 'kb' ? (
          <KbView
            route={route.kb}
            go={goKb}
            back={() => (history.length > 1 ? history.back() : goKb({ kind: 'home' }))}
            sidebarOpen={sidebar && !narrow}
            openSidebar={() => setSidebar(true)}
            version={store.kbVersion}
            discuss={(note) => {
              setDraft('new', `Нотатка «${note.title}» з бази знань (${note.path}). `)
              navigate(null)
            }}
          />
        ) : route.kind === 'plugins' ? (
          <Suspense fallback={null}>
            <PluginsView tab={route.tab} id={route.id} sidebarOpen={sidebar && !narrow} openSidebar={() => setSidebar(true)} version={store.pluginsVersion} />
          </Suspense>
        ) : route.kind === 'jobs' ? (
          <JobsView route={route.jobs} go={goJobs} sidebarOpen={sidebar && !narrow} openSidebar={() => setSidebar(true)} flash={flash} />
        ) : (
          <ChatPane
            chat={current}
            list={list}
            loading={Boolean(currentId) && !list}
            actions={actions}
            composer={composerEl}
            welcomeNote={
              newList && (
                <div className="welcome-list">
                  <span className="welcome-list-dot" style={{ background: newList.color }} />
                  Новий чат у списку «{newList.name}»
                </div>
              )
            }
            showNav={!sidebar || narrow}
            unread={unreadTotal - (current && !current.muted ? current.unread : 0)}
            onOpenSidebar={() => setSidebar(true)}
            onNewChat={() => newChat()}
            onShare={() => setSharing(true)}
            onQuote={(t) => composer.current?.insertQuote(t)}
            flash={flash}
          />
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
            onJobs={() => {
              setSettingsOpen(false)
              goJobs({ kind: 'list' })
            }}
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
              store.clearAll()
              navigate(null, true)
            }}
          />
        )}
        {notif && <Notifications onClose={closeNotif} />}
        {security && <Security onClose={closeSecurity} />}
        {sharing && current && <ShareSheet chat={current} onClose={closeSharing} />}
        {jobSheet && (
          <JobSheet id={jobSheet} chat={chats.find((c) => c.jobs?.some((j) => j.id === jobSheet)) ?? null} onClose={closeJobSheet} flash={flash} />
        )}
        <FileViewerHost />
      </main>
    </div>
  )
}
