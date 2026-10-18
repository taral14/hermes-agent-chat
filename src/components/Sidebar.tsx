import {
  Bell,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  Folder,
  FolderMinus,
  FolderPlus,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Chat, ChatList } from '../shared.ts'

type Props = {
  chats: Chat[]
  lists: ChatList[]
  currentId: string | null
  username: string
  narrow: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onPin: (id: string, pinned: boolean) => void
  onDelete: (id: string) => void
  onMoveToList: (chatId: string, listId: string | null) => void
  onCreateList: (name: string) => Promise<ChatList | null>
  onRenameList: (id: string, name: string) => void
  onDeleteList: (id: string) => void
  onNewInList: (listId: string) => void
  onClose: () => void
  onLogout: () => void
  onJobs: () => void
  jobsActive: boolean
  onKb: () => void
  kbActive: boolean
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

// ---------- Меню: на телефоні нижня шторка, на комп'ютері випадне ----------

type Action = { label: string; icon: ReactNode; danger?: boolean; checked?: boolean; run: () => void }

function ActionMenu({ narrow, title, note, actions, onClose }: {
  narrow: boolean
  title?: string
  note?: string
  actions: Action[]
  onClose: () => void
}) {
  if (narrow) {
    return createPortal(
      <div className="sheet-backdrop" onClick={onClose}>
        <div className="sheet action-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-grip" />
          {title && <div className="action-title">{title}</div>}
          {note && <div className="action-note">{note}</div>}
          {actions.map((a) => (
            <button key={a.label} type="button" className={`action-row ${a.danger ? 'danger' : ''}`} onClick={a.run}>
              {a.icon} <span className="action-label">{a.label}</span>
              {a.checked && <Check size={20} className="action-check" />}
            </button>
          ))}
        </div>
      </div>,
      document.body,
    )
  }
  return (
    <div className="menu chat-menu">
      {note && <div className="menu-note">{note}</div>}
      {actions.map((a) => (
        <button key={a.label} type="button" className={`menu-item ${a.danger ? 'danger' : ''}`} onClick={a.run}>
          {a.icon} <span className="menu-item-main">{a.label}</span>
          {a.checked && <Check size={16} />}
        </button>
      ))}
    </div>
  )
}

/** Довге натискання (телефон) або правий клік відкривають меню. */
function usePress(open: () => void) {
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false })
  const stop = () => {
    if (press.current.timer) clearTimeout(press.current.timer)
    press.current.timer = null
  }
  return {
    fired: () => {
      const f = press.current.fired
      press.current.fired = false
      return f
    },
    handlers: {
      onTouchStart: () => {
        press.current.fired = false
        press.current.timer = setTimeout(() => {
          press.current.fired = true
          navigator.vibrate?.(10)
          open()
        }, 450)
      },
      onTouchMove: stop,
      onTouchEnd: stop,
      onContextMenu: (e: ReactMouseEvent) => {
        e.preventDefault()
        open()
      },
    },
  }
}

function useOutside(active: boolean, box: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!active) return
    const on = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', on)
    return () => document.removeEventListener('mousedown', on)
  }, [active, box, close])
}

// ---------- Чат ----------

type ChatItemProps = {
  chat: Chat
  active: boolean
  narrow: boolean
  lists: ChatList[]
  indent?: boolean
  onSelect: () => void
  onRename: (t: string) => void
  onPin: () => void
  onDelete: () => void
  onMove: (listId: string | null) => void
}

function ChatItem({ chat, active, narrow, lists, indent, onSelect, onRename, onPin, onDelete, onMove }: ChatItemProps) {
  const [menu, setMenu] = useState<null | 'main' | 'lists' | 'confirm'>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(chat.title)
  const box = useRef<HTMLDivElement>(null)
  const close = () => setMenu(null)
  useOutside(Boolean(menu) && !narrow, box, close)
  const press = usePress(() => setMenu('main'))
  const sz = narrow ? 20 : 16

  if (editing) {
    return (
      <form
        className={`chat-item is-editing ${indent ? 'is-indented' : ''}`}
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

  const inList = lists.find((l) => l.id === chat.listId)
  const run = (fn: () => void) => () => {
    close()
    fn()
  }
  let actions: Action[]
  if (menu === 'confirm') {
    actions = [
      { label: 'Так, видалити', icon: <Trash2 size={sz} />, danger: true, run: run(onDelete) },
      { label: 'Скасувати', icon: <X size={sz} />, run: () => setMenu('main') },
    ]
  } else if (menu === 'lists') {
    actions = lists.map((l) => ({
      label: l.name,
      icon: <Folder size={sz} style={{ color: l.color }} />,
      checked: chat.listId === l.id,
      run: run(() => onMove(l.id)),
    }))
    if (chat.listId) actions.push({ label: 'Прибрати зі списку', icon: <FolderMinus size={sz} />, run: run(() => onMove(null)) })
  } else {
    actions = [
      {
        label: 'Перейменувати',
        icon: <Pencil size={sz} />,
        run: run(() => {
          setTitle(chat.title)
          setEditing(true)
        }),
      },
      { label: chat.pinned ? 'Відкріпити' : 'Закріпити', icon: chat.pinned ? <PinOff size={sz} /> : <Pin size={sz} />, run: run(onPin) },
    ]
    if (lists.length) actions.push({ label: inList ? `У списку «${inList.name}»` : 'Додати до списку', icon: <FolderPlus size={sz} />, run: () => setMenu('lists') })
    actions.push({ label: 'Видалити', icon: <Trash2 size={sz} />, danger: true, run: () => setMenu('confirm') })
  }

  return (
    <div ref={box} className={`chat-item ${active ? 'is-active' : ''} ${menu && !narrow ? 'has-menu' : ''} ${indent ? 'is-indented' : ''}`}>
      <button
        type="button"
        className="chat-link"
        title={chat.title}
        onClick={() => {
          if (!press.fired()) onSelect()
        }}
        {...press.handlers}
      >
        {chat.running && <span className="running-dot" aria-label="Працює" />}
        <span className="chat-title">{chat.title || 'Новий чат'}</span>
      </button>
      {!narrow && (
        <button type="button" className="chat-more" aria-label="Дії" onClick={() => setMenu((m) => (m ? null : 'main'))}>
          <MoreHorizontal size={16} />
        </button>
      )}
      {menu && (
        <ActionMenu
          narrow={narrow}
          title={chat.title || 'Новий чат'}
          note={menu === 'confirm' ? 'Видалити чат і його сесію в Hermes?' : menu === 'lists' ? 'Перемістити до списку' : undefined}
          actions={actions}
          onClose={close}
        />
      )}
    </div>
  )
}

// ---------- Список ----------

const CLOSED_KEY = 'chat-lists-closed'
function readClosed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function ListBlock({ list, chats, p, closed, toggle, item }: {
  list: ChatList
  chats: Chat[]
  p: Props
  closed: boolean
  toggle: () => void
  item: (c: Chat, indent: boolean) => ReactNode
}) {
  const [menu, setMenu] = useState<null | 'main' | 'confirm'>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(list.name)
  const box = useRef<HTMLDivElement>(null)
  const close = () => setMenu(null)
  useOutside(Boolean(menu) && !p.narrow, box, close)
  const press = usePress(() => setMenu('main'))
  const sz = p.narrow ? 20 : 16
  const run = (fn: () => void) => () => {
    close()
    fn()
  }

  return (
    <div className="list-block">
      <div ref={box} className={`chat-item list-row ${menu && !p.narrow ? 'has-menu' : ''}`}>
        {editing ? (
          <form
            className="list-edit"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) p.onRenameList(list.id, name.trim())
              setEditing(false)
            }}
          >
            <Folder size={sz} style={{ color: list.color }} />
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(false)} />
          </form>
        ) : (
          <button
            type="button"
            className="chat-link"
            onClick={() => {
              if (!press.fired()) toggle()
            }}
            {...press.handlers}
          >
            <Folder size={sz} className="list-icon" style={{ color: list.color }} fill={list.color} fillOpacity={0.2} />
            <span className="chat-title">{list.name}</span>
            {chats.length > 0 && <span className="list-count">{chats.length}</span>}
            <ChevronRight size={15} className={`list-chevron ${closed ? '' : 'is-open'}`} />
          </button>
        )}
        {!p.narrow && !editing && (
          <>
            <button type="button" className="chat-more" title="Новий чат у списку" aria-label="Новий чат у списку" onClick={() => p.onNewInList(list.id)}>
              <Plus size={16} />
            </button>
            <button type="button" className="chat-more" aria-label="Дії зі списком" onClick={() => setMenu((m) => (m ? null : 'main'))}>
              <MoreHorizontal size={16} />
            </button>
          </>
        )}
        {menu && (
          <ActionMenu
            narrow={p.narrow}
            title={list.name}
            note={menu === 'confirm' ? 'Видалити список? Чати з нього лишаться в «Нещодавніх».' : undefined}
            actions={
              menu === 'confirm'
                ? [
                    { label: 'Так, видалити список', icon: <Trash2 size={sz} />, danger: true, run: run(() => p.onDeleteList(list.id)) },
                    { label: 'Скасувати', icon: <X size={sz} />, run: () => setMenu('main') },
                  ]
                : [
                    { label: 'Новий чат у списку', icon: <SquarePen size={sz} />, run: run(() => p.onNewInList(list.id)) },
                    {
                      label: 'Перейменувати',
                      icon: <Pencil size={sz} />,
                      run: run(() => {
                        setName(list.name)
                        setEditing(true)
                      }),
                    },
                    { label: 'Видалити список', icon: <Trash2 size={sz} />, danger: true, run: () => setMenu('confirm') },
                  ]
            }
            onClose={close}
          />
        )}
      </div>
      {!closed && chats.map((c) => item(c, true))}
      {!closed && chats.length === 0 && <div className="list-empty">Порожньо. Додай чат через його меню.</div>}
    </div>
  )
}

/** Шторка налаштувань із шестерні (телефон). */
function SettingsSheet({ username, onClose, items }: {
  username: string
  onClose: () => void
  items: { label: string; icon: ReactNode; danger?: boolean; run: () => void }[]
}) {
  return createPortal(
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
}

export function Sidebar(p: Props) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [settings, setSettings] = useState(false)
  const [closedLists, setClosedLists] = useState(readClosed)
  const [newList, setNewList] = useState<string | null>(null)

  const toggleList = (id: string) =>
    setClosedLists((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify([...next]))
      } catch {
        /* приватний режим */
      }
      return next
    })

  const q = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const listIds = new Set(p.lists.map((l) => l.id))
    const list = q ? p.chats.filter((c) => c.title.toLowerCase().includes(q)) : p.chats
    const out: [string, Chat[]][] = []
    for (const c of list) {
      // Без пошуку чати зі списків показуємо лише у своєму списку; закріплені — у «Закріплено».
      if (!q && !c.pinned && c.listId && listIds.has(c.listId)) continue
      const g = c.pinned ? 'Закріплено' : p.narrow || q ? 'Нещодавні' : groupOf(c.updatedAt)
      const last = out[out.length - 1]
      if (last && last[0] === g) last[1].push(c)
      else out.push([g, [c]])
    }
    return out
  }, [p.chats, q, p.narrow, p.lists])

  const toggleSearch = () => {
    setSearching((s) => !s)
    setQuery('')
  }

  const item = (c: Chat, indent = false) => (
    <ChatItem
      key={c.id}
      chat={c}
      indent={indent}
      narrow={p.narrow}
      lists={p.lists}
      active={c.id === p.currentId}
      onSelect={() => p.onSelect(c.id)}
      onRename={(t) => p.onRename(c.id, t)}
      onPin={() => p.onPin(c.id, !c.pinned)}
      onDelete={() => p.onDelete(c.id)}
      onMove={(l) => p.onMoveToList(c.id, l)}
    />
  )

  const pinned = groups.find(([g]) => g === 'Закріплено')
  const rest = groups.filter(([g]) => g !== 'Закріплено')

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
            <button type="button" className={`nav-row ${p.kbActive ? 'is-active' : ''}`} onClick={p.onKb}>
              <span className="nav-icon">
                <BookOpen size={p.narrow ? 24 : 18} />
              </span>
              <span>База знань</span>
            </button>
          </div>
        )}

        {pinned && (
          <div className="chat-group">
            <div className="chat-group-title">Закріплено</div>
            {pinned[1].map((c) => item(c))}
          </div>
        )}

        {!q && (
          <div className="chat-group">
            <div className="chat-group-title group-with-action">
              <span>Списки</span>
              <button type="button" className="group-action" aria-label="Новий список" title="Новий список" onClick={() => setNewList('')}>
                <Plus size={p.narrow ? 20 : 15} />
              </button>
            </div>
            {newList !== null && (
              <form
                className="chat-item is-editing list-new"
                onSubmit={(e) => {
                  e.preventDefault()
                  const name = newList.trim()
                  setNewList(null)
                  if (name) void p.onCreateList(name)
                }}
              >
                <Folder size={p.narrow ? 20 : 16} />
                <input
                  autoFocus
                  placeholder="Назва списку"
                  value={newList}
                  onChange={(e) => setNewList(e.target.value)}
                  onBlur={() => {
                    if (!newList.trim()) setNewList(null)
                  }}
                  onKeyDown={(e) => e.key === 'Escape' && setNewList(null)}
                />
              </form>
            )}
            {p.lists.map((l) => (
              <ListBlock
                key={l.id}
                list={l}
                chats={p.chats.filter((c) => c.listId === l.id && !c.pinned)}
                p={p}
                closed={closedLists.has(l.id)}
                toggle={() => toggleList(l.id)}
                item={item}
              />
            ))}
            {p.lists.length === 0 && newList === null && (
              <button type="button" className="list-hint" onClick={() => setNewList('')}>
                Створи список, щоб групувати чати
              </button>
            )}
          </div>
        )}

        {rest.map(([g, list]) => (
          <div key={g} className="chat-group">
            <div className="chat-group-title">{g}</div>
            {list.map((c) => item(c))}
          </div>
        ))}
        {!groups.length && q && <div className="chat-empty">Нічого не знайдено</div>}
        {!p.chats.length && !q && <div className="chat-empty">Тут з’являться твої чати</div>}
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
