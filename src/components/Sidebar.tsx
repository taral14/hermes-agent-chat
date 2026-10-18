import {
  Bell,
  CalendarClock,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Search,
  Settings,
  ShieldCheck,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { Chat } from '../shared.ts'

type Props = {
  chats: Chat[]
  currentId: string | null
  username: string
  narrow: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onPin: (id: string, pinned: boolean) => void
  onDelete: (id: string) => void
  onClose: () => void
  onLogout: () => void
  onJobs: () => void
  jobsActive: boolean
  onNotifications: () => void
  onSecurity: () => void
}

function groupOf(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const day = 86400_000
  if (d >= today) return 'Сьогодні'
  if (d.getTime() >= today.getTime() - day) return 'Вчора'
  if (d.getTime() >= today.getTime() - 7 * day) return 'Попередні 7 днів'
  if (d.getTime() >= today.getTime() - 30 * day) return 'Попередні 30 днів'
  return d.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })
}

/** Нижня шторка з діями над чатом (телефон, довге натискання). */
function ChatSheet({ chat, onClose, onRename, onPin, onDelete }: {
  chat: Chat
  onClose: () => void
  onRename: () => void
  onPin: () => void
  onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  return (
    createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet action-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="action-title">{chat.title || 'Новий чат'}</div>
        {confirm ? (
          <>
            <div className="action-note">Видалити чат і його сесію в Hermes?</div>
            <button type="button" className="action-row danger" onClick={onDelete}>
              <Trash2 size={20} /> Так, видалити
            </button>
            <button type="button" className="action-row" onClick={() => setConfirm(false)}>
              <X size={20} /> Скасувати
            </button>
          </>
        ) : (
          <>
            <button type="button" className="action-row" onClick={onRename}>
              <Pencil size={20} /> Перейменувати
            </button>
            <button type="button" className="action-row" onClick={onPin}>
              {chat.pinned ? <PinOff size={20} /> : <Pin size={20} />} {chat.pinned ? 'Відкріпити' : 'Закріпити'}
            </button>
            <button type="button" className="action-row danger" onClick={() => setConfirm(true)}>
              <Trash2 size={20} /> Видалити
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
    )
  )
}

function ChatItem({ chat, active, narrow, onSelect, onRename, onPin, onDelete }: {
  chat: Chat
  active: boolean
  narrow: boolean
  onSelect: () => void
  onRename: (t: string) => void
  onPin: () => void
  onDelete: () => void
}) {
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [title, setTitle] = useState(chat.title)
  const box = useRef<HTMLDivElement>(null)
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false })

  useEffect(() => {
    if (!menu || narrow) return
    const close = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return
      setMenu(false)
      setConfirm(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu, narrow])

  if (editing) {
    return (
      <form
        className="chat-item is-editing"
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) onRename(title.trim())
          setEditing(false)
        }}
      >
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} />
      </form>
    )
  }

  const stopPress = () => {
    if (press.current.timer) clearTimeout(press.current.timer)
    press.current.timer = null
  }
  const close = () => setMenu(false)

  return (
    <div ref={box} className={`chat-item ${active ? 'is-active' : ''} ${menu && !narrow ? 'has-menu' : ''}`}>
      <button
        type="button"
        className="chat-link"
        title={chat.title}
        onClick={() => {
          if (press.current.fired) {
            press.current.fired = false
            return
          }
          onSelect()
        }}
        // Довге натискання на телефоні відкриває дії, як у ChatGPT.
        onTouchStart={() => {
          press.current.fired = false
          press.current.timer = setTimeout(() => {
            press.current.fired = true
            navigator.vibrate?.(10)
            setMenu(true)
          }, 450)
        }}
        onTouchMove={stopPress}
        onTouchEnd={stopPress}
        onContextMenu={(e: ReactMouseEvent) => {
          e.preventDefault()
          setMenu(true)
        }}
      >
        {chat.running && <span className="running-dot" aria-label="Працює" />}
        <span className="chat-title">{chat.title || 'Новий чат'}</span>
      </button>
      {!narrow && (
        <button type="button" className="chat-more" aria-label="Дії" onClick={() => setMenu((m) => !m)}>
          <MoreHorizontal size={16} />
        </button>
      )}
      {menu && narrow && (
        <ChatSheet
          chat={chat}
          onClose={close}
          onRename={() => {
            close()
            setTitle(chat.title)
            setEditing(true)
          }}
          onPin={() => {
            close()
            onPin()
          }}
          onDelete={() => {
            close()
            onDelete()
          }}
        />
      )}
      {menu && !narrow && (
        <div className="menu chat-menu">
          {confirm ? (
            <>
              <div className="menu-note">Видалити чат і його сесію в Hermes?</div>
              <button
                type="button"
                className="menu-item danger"
                onClick={() => {
                  close()
                  onDelete()
                }}
              >
                <Trash2 size={16} /> Так, видалити
              </button>
              <button type="button" className="menu-item" onClick={() => setConfirm(false)}>
                <X size={16} /> Скасувати
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  close()
                  setTitle(chat.title)
                  setEditing(true)
                }}
              >
                <Pencil size={16} /> Перейменувати
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  close()
                  onPin()
                }}
              >
                {chat.pinned ? <PinOff size={16} /> : <Pin size={16} />} {chat.pinned ? 'Відкріпити' : 'Закріпити'}
              </button>
              <button type="button" className="menu-item danger" onClick={() => setConfirm(true)}>
                <Trash2 size={16} /> Видалити
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Шторка налаштувань із шестерні (телефон). */
function SettingsSheet({ username, onClose, items }: {
  username: string
  onClose: () => void
  items: { label: string; icon: ReactNode; danger?: boolean; run: () => void }[]
}) {
  return (
    createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet action-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="settings-user">
          <span className="avatar big">{username.slice(0, 1).toUpperCase()}</span>
          <span>{username}</span>
        </div>
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            className={`action-row ${it.danger ? 'danger' : ''}`}
            onClick={() => {
              onClose()
              it.run()
            }}
          >
            {it.icon} {it.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
    )
  )
}

export function Sidebar(p: Props) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [settings, setSettings] = useState(false)
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? p.chats.filter((c) => c.title.toLowerCase().includes(q)) : p.chats
    const out: [string, Chat[]][] = []
    for (const c of list) {
      // Телефон: як у ChatGPT — «Закріплено» й «Нещодавні». Комп'ютер: групи за датою.
      const g = c.pinned ? 'Закріплено' : p.narrow ? 'Нещодавні' : groupOf(c.updatedAt)
      const last = out[out.length - 1]
      if (last && last[0] === g) last[1].push(c)
      else out.push([g, [c]])
    }
    return out
  }, [p.chats, query, p.narrow])

  const toggleSearch = () => {
    setSearching((s) => !s)
    setQuery('')
  }

  return (
    <nav className="sidebar">
      {p.narrow ? (
        <div className="m-head">
          <span className="m-title">Hermes</span>
          <button type="button" className="m-round" aria-label="Пошук чатів" onClick={toggleSearch}>
            {searching ? <X size={22} /> : <Search size={22} />}
          </button>
        </div>
      ) : (
        <>
          <div className="sidebar-top">
            <button type="button" className="icon-btn" title="Сховати панель" aria-label="Сховати панель" onClick={p.onClose}>
              <PanelLeftClose size={20} />
            </button>
            <div className="sidebar-top-right">
              <button type="button" className="icon-btn" title="Пошук чатів" aria-label="Пошук чатів" onClick={toggleSearch}>
                <Search size={19} />
              </button>
              <button type="button" className="icon-btn" title="Новий чат" aria-label="Новий чат" onClick={p.onNew}>
                <SquarePen size={19} />
              </button>
            </div>
          </div>
          <button type="button" className="new-chat" onClick={p.onNew}>
            <span className="brand-mark">H</span>
            <span>Hermes</span>
          </button>
        </>
      )}
      {searching && (
        <div className="sidebar-search">
          <Search size={p.narrow ? 18 : 15} />
          <input autoFocus placeholder="Пошук чатів" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      <div className="chat-list">
        {!searching && (
          <div className="nav-block">
            <button type="button" className={`nav-row ${p.jobsActive ? 'is-active' : ''}`} onClick={p.onJobs}>
              <span className="nav-icon">
                <CalendarClock size={p.narrow ? 24 : 18} />
              </span>
              <span>Розклад</span>
            </button>
          </div>
        )}
        {groups.map(([g, list]) => (
          <div key={g} className="chat-group">
            <div className="chat-group-title">{g}</div>
            {list.map((c) => (
              <ChatItem
                key={c.id}
                chat={c}
                narrow={p.narrow}
                active={c.id === p.currentId}
                onSelect={() => p.onSelect(c.id)}
                onRename={(t) => p.onRename(c.id, t)}
                onPin={() => p.onPin(c.id, !c.pinned)}
                onDelete={() => p.onDelete(c.id)}
              />
            ))}
          </div>
        ))}
        {!groups.length && <div className="chat-empty">{query ? 'Нічого не знайдено' : 'Тут з’являться твої чати'}</div>}
      </div>
      {p.narrow ? (
        <div className="m-foot">
          <button type="button" className="m-new" onClick={p.onNew}>
            <SquarePen size={22} />
            <span>Чат</span>
          </button>
          <button type="button" className="m-round" aria-label="Налаштування" onClick={() => setSettings(true)}>
            <Settings size={22} />
          </button>
        </div>
      ) : (
        <div className="sidebar-foot">
          <div className="user-row">
            <span className="avatar">{p.username.slice(0, 1).toUpperCase()}</span>
            <span className="user-name">{p.username}</span>
            <button type="button" className="icon-btn" title="Вхід і безпека" aria-label="Вхід і безпека" onClick={p.onSecurity}>
              <ShieldCheck size={17} />
            </button>
            <button type="button" className="icon-btn" title="Сповіщення" aria-label="Сповіщення" onClick={p.onNotifications}>
              <Bell size={17} />
            </button>
            <button type="button" className="icon-btn" title="Вийти" aria-label="Вийти" onClick={p.onLogout}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      )}
      {settings && (
        <SettingsSheet
          username={p.username}
          onClose={() => setSettings(false)}
          items={[
            { label: 'Сповіщення', icon: <Bell size={20} />, run: p.onNotifications },
            { label: 'Вхід і безпека', icon: <ShieldCheck size={20} />, run: p.onSecurity },
            { label: 'Вийти', icon: <LogOut size={20} />, danger: true, run: p.onLogout },
          ]}
        />
      )}
    </nav>
  )
}
