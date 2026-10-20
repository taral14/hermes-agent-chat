// Стан чатів на клієнті: список, повідомлення відкритих чатів, списки, і живі оновлення з сервера (SSE).
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { invalidateNoteIndex } from '../kb.ts'
import type { Chat, ChatList, Message, ServerEvent } from '../shared.ts'

export function sortChats(list: Chat[]) {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

export function upsert(list: Message[], m: Message) {
  const i = list.findIndex((x) => x.id === m.id)
  if (i < 0) return [...list, m].sort((a, b) => a.createdAt - b.createdAt)
  const next = list.slice()
  next[i] = m
  return next
}

const ACTIVE = new Set(['queued', 'running', 'stopping'])

/**
 * Відповідь на запит могла вже застаріти: поки вона йшла, SSE приніс завершення ходу.
 * Завершене повідомлення не повертаємо назад у «працює».
 */
function fresher(prev: Message | undefined, next: Message): Message {
  return prev && !ACTIVE.has(prev.status) && ACTIVE.has(next.status) ? prev : next
}

type Events = {
  /** Чат зник (видалено тут, в іншій вкладці чи його немає на сервері). */
  onGone: (chatId: string) => void
  /** Помилка дії: показати користувачу. */
  onError: (e: unknown) => void
}

/** Події SSE, що прийшли, поки чат вантажиться: знімок з сервера міг бути старішим за них. */
type Pending = { messages: Message[]; chat: Chat | null }

export function useChats(enabled: boolean, events: Events) {
  const [chats, setChats] = useState<Chat[]>([])
  const [lists, setLists] = useState<ChatList[]>([])
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [kbVersion, setKbVersion] = useState(0)
  const [pluginsVersion, setPluginsVersion] = useState(0)
  const on = useRef(events)
  on.current = events
  const pending = useRef(new Map<string, Pending>())

  const putChat = useCallback((chat: Chat) => setChats((c) => sortChats([...c.filter((x) => x.id !== chat.id), chat])), [])
  const loadChats = useCallback(() => api.chats().then((c) => setChats(sortChats(c))), [])
  const loadLists = useCallback(() => api.lists().then(setLists), [])

  /** Чат з повідомленнями. Події, що прийшли під час запиту, накладаються поверх знімка. */
  const loadChat = useCallback(
    async (id: string) => {
      const buf: Pending = { messages: [], chat: null }
      pending.current.set(id, buf)
      try {
        const r = await api.chat(id)
        if (pending.current.get(id) !== buf) return
        let list = r.messages
        for (const m of buf.messages) list = upsert(list, m)
        setMessages((all) => ({ ...all, [id]: list }))
        putChat(buf.chat ?? r.chat)
      } catch (e) {
        if ((e as { status?: number }).status === 404) on.current.onGone(id)
      } finally {
        if (pending.current.get(id) === buf) pending.current.delete(id)
      }
    },
    [putChat],
  )

  /** Відповідь сервера з чатом і повідомленнями (надсилання, повтор, редагування). */
  const applyChat = useCallback(
    (r: { chat: Chat; messages: Message[] }, replace = false) => {
      putChat(r.chat)
      setMessages((all) => {
        const prev = all[r.chat.id] ?? []
        const byId = new Map(prev.map((m) => [m.id, m]))
        let list = replace ? [] : prev
        for (const m of r.messages) list = upsert(list, fresher(byId.get(m.id), m))
        return { ...all, [r.chat.id]: list }
      })
    },
    [putChat],
  )

  useEffect(() => {
    if (!enabled) return
    void loadChats()
    void loadLists().catch(() => {})
  }, [enabled, loadChats, loadLists])

  // ---------- Живі оновлення ----------

  const openChats = useRef<() => string[]>(() => [])
  openChats.current = () => Object.keys(messages)
  useEffect(() => {
    if (!enabled) return
    const es = new EventSource('/api/events')
    let wasDown = false
    es.onopen = () => {
      if (!wasDown) return
      wasDown = false
      // Поки зв'язку не було, щось могло змінитись: перечитуємо список і відкриті чати.
      void loadChats()
      void loadLists().catch(() => {})
      for (const id of openChats.current()) void loadChat(id)
    }
    es.onerror = () => {
      wasDown = true
    }
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data) as ServerEvent
      if (e.type === 'message') {
        pending.current.get(e.message.chatId)?.messages.push(e.message)
        setMessages((all) => (all[e.message.chatId] ? { ...all, [e.message.chatId]: upsert(all[e.message.chatId]!, e.message) } : all))
      } else if (e.type === 'chat') {
        const p = pending.current.get(e.chat.id)
        if (p) p.chat = e.chat
        putChat(e.chat)
      } else if (e.type === 'lists') {
        setLists(e.lists)
      } else if (e.type === 'kb') {
        setKbVersion((v) => v + 1)
        invalidateNoteIndex()
      } else if (e.type === 'plugins') {
        setPluginsVersion((v) => v + 1)
      } else if (e.type === 'chat-deleted') {
        setChats((c) => c.filter((x) => x.id !== e.chatId))
        on.current.onGone(e.chatId)
      }
    }
    return () => es.close()
  }, [enabled, loadChats, loadLists, loadChat, putChat])

  // ---------- Дії з чатами й списками ----------
  // Інтерфейс змінюється одразу; якщо сервер відмовив — показуємо помилку й перечитуємо справжній стан.

  const optimistic = useCallback(
    (apply: () => void, request: Promise<unknown>, resync: () => Promise<unknown>) => {
      apply()
      request.catch((e: unknown) => {
        on.current.onError(e)
        void resync().catch(() => {})
      })
    },
    [],
  )

  const patchChat = useCallback(
    (id: string, patch: Partial<Pick<Chat, 'title' | 'pinned' | 'listId' | 'model' | 'mode'>>) =>
      optimistic(
        () => setChats((c) => sortChats(c.map((x) => (x.id === id ? { ...x, ...patch } : x)))),
        api.patchChat(id, patch),
        loadChats,
      ),
    [optimistic, loadChats],
  )

  const removeChat = useCallback(
    (id: string) => {
      optimistic(() => setChats((c) => c.filter((x) => x.id !== id)), api.deleteChat(id), loadChats)
      on.current.onGone(id)
    },
    [optimistic, loadChats],
  )

  const createList = useCallback(async (name: string) => {
    try {
      const l = await api.createList(name)
      setLists((ls) => (ls.some((x) => x.id === l.id) ? ls : [...ls, l]))
      return l
    } catch (e) {
      on.current.onError(e)
      return null
    }
  }, [])

  const renameList = useCallback(
    (id: string, name: string) => optimistic(() => setLists((ls) => ls.map((l) => (l.id === id ? { ...l, name } : l))), api.renameList(id, name), loadLists),
    [optimistic, loadLists],
  )

  const deleteList = useCallback(
    (id: string) =>
      optimistic(
        () => {
          setLists((ls) => ls.filter((l) => l.id !== id))
          setChats((c) => c.map((x) => (x.listId === id ? { ...x, listId: null } : x)))
        },
        api.deleteList(id),
        () => Promise.all([loadLists(), loadChats()]),
      ),
    [optimistic, loadLists, loadChats],
  )

  const clearAll = useCallback(() => {
    setChats([])
    setMessages({})
  }, [])

  return { chats, lists, messages, kbVersion, pluginsVersion, loadChat, applyChat, patchChat, removeChat, createList, renameList, deleteList, clearAll }
}
