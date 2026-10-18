import { Bell, CalendarClock, LogOut, ShieldCheck, MoreHorizontal, PanelLeftClose, Pencil, Pin, PinOff, Search, SquarePen, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Chat } from '../shared.ts'

type Props = {
  chats: Chat[]
  currentId: string | null
  username: string
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

function ChatItem({ chat, active, onSelect, onRename, onPin, onDelete }: {
  chat: Chat
  active: boolean
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

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return
      setMenu(false)
      setConfirm(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

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

  return (
    <div ref={box} className={`chat-item ${active ? 'is-active' : ''} ${menu ? 'has-menu' : ''}`}>
      <button type="button" className="chat-link" onClick={onSelect} title={chat.title}>
        {chat.running && <span className="running-dot" aria-label="Працює" />}
        <span className="chat-title">{chat.title || 'Новий чат'}</span>
      </button>
      <button type="button" className="chat-more" aria-label="Дії" onClick={() => setMenu((m) => !m)}>
        <MoreHorizontal size={16} />
      </button>
      {menu && (
        <div className="menu chat-menu">
          {confirm ? (
            <>
              <div className="menu-note">Видалити чат і його сесію в Hermes?</div>
              <button type="button" className="menu-item danger" onClick={() => (setMenu(false), onDelete())}>
                <Trash2 size={16} /> Так, видалити
              </button>
              <button type="button" className="menu-item" onClick={() => setConfirm(false)}>
                <X size={16} /> Скасувати
              </button>
            </>
          ) : (
            <>
              <button type="button" className="menu-item" onClick={() => (setMenu(false), setTitle(chat.title), setEditing(true))}>
                <Pencil size={16} /> Перейменувати
              </button>
              <button type="button" className="menu-item" onClick={() => (setMenu(false), onPin())}>
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

export function Sidebar(p: Props) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? p.chats.filter((c) => c.title.toLowerCase().includes(q)) : p.chats
    const out: [string, Chat[]][] = []
    for (const c of list) {
      const g = c.pinned ? 'Закріплені' : groupOf(c.updatedAt)
      const last = out[out.length - 1]
      if (last && last[0] === g) last[1].push(c)
      else out.push([g, [c]])
    }
    return out
  }, [p.chats, query])

  return (
    <nav className="sidebar">
      <div className="sidebar-top">
        <button type="button" className="icon-btn" title="Сховати панель" aria-label="Сховати панель" onClick={p.onClose}>
          <PanelLeftClose size={20} />
        </button>
        <div className="sidebar-top-right">
          <button type="button" className="icon-btn" title="Пошук чатів" aria-label="Пошук чатів" onClick={() => (setSearching((s) => !s), setQuery(''))}>
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
      <button type="button" className={`nav-row ${p.jobsActive ? 'is-active' : ''}`} onClick={p.onJobs}>
        <span className="nav-icon">
          <CalendarClock size={18} />
        </span>
        <span>Розклад</span>
      </button>
      {searching && (
        <div className="sidebar-search">
          <Search size={15} />
          <input autoFocus placeholder="Пошук чатів" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      <div className="chat-list">
        {groups.map(([g, list]) => (
          <div key={g} className="chat-group">
            <div className="chat-group-title">{g}</div>
            {list.map((c) => (
              <ChatItem
                key={c.id}
                chat={c}
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
    </nav>
  )
}

