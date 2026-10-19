// Відкритий чат: шапка, розмова з прокруткою, панелі мети й задач, поле вводу.
import { ArrowDown, Menu, PanelLeftOpen, Share, SquarePen } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Chat, Message } from '../shared.ts'
import { GoalBar } from './GoalBar.tsx'
import { JobBar } from './JobSheet.tsx'
import { ActionsContext, type MessageActions, MessageView, TimeSeparator, needsTimeSeparator } from './MessageView.tsx'
import { SelectionAsk } from './SelectionAsk.tsx'

type Props = {
  chat: Chat | null
  /** Повідомлення чату; undefined — ще вантажаться. */
  list: Message[] | undefined
  /** Відкрито чат, якого ще немає в пам'яті (вантажиться). */
  loading: boolean
  actions: MessageActions
  composer: ReactNode
  /** Над привітанням нового чату (напр. «Новий чат у списку …»). */
  welcomeNote?: ReactNode
  /** Показати кнопки меню й нового чату в шапці (панель згорнута або вузький екран). */
  showNav: boolean
  onOpenSidebar: () => void
  onNewChat: () => void
  onShare: () => void
  onQuote: (text: string) => void
  flash: (e: unknown) => void
}

export function ChatPane({ chat, list, loading, actions, composer, welcomeNote, showNav, onOpenSidebar, onNewChat, onShare, onQuote, flash }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  /** Тримати розмову внизу, поки людина сама не прокрутила вгору. */
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  // Інший чат або нове питання (надіслане, повторене, відредаговане) — знову до низу.
  const lastUser = list?.findLast((m) => m.role === 'user')?.id
  useEffect(() => {
    stick.current = true
    setAtBottom(true)
  }, [chat?.id, lastUser])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [list])

  // Картинки, картки посилань і плеєри дорендерюються вже після повідомлень: тримаємо низ і тоді.
  const inner = useRef<HTMLDivElement>(null)
  const hasThread = Boolean(chat && list?.length)
  useEffect(() => {
    const box = inner.current
    if (!box) return
    const ro = new ResizeObserver(() => {
      const el = scroller.current
      if (el && stick.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [hasThread])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stick.current = near
    setAtBottom(near)
  }

  const header = (
    <header className="topbar">
      <div className="topbar-left">
        {showNav && (
          <>
            <button type="button" className="icon-btn m-menu-btn" aria-label="Показати панель" title="Показати панель" onClick={onOpenSidebar}>
              <span className="only-wide">
                <PanelLeftOpen size={20} />
              </span>
              <span className="only-narrow">
                <Menu size={20} />
              </span>
            </button>
            <button type="button" className="icon-btn only-wide" aria-label="Новий чат" title="Новий чат" onClick={onNewChat}>
              <SquarePen size={19} />
            </button>
          </>
        )}
        <span className="topbar-title">{chat?.title || 'Hermes'}</span>
      </div>
      <div className="topbar-right">
        {chat && (list?.length ?? 0) > 0 && (
          <button type="button" className="topbar-share" aria-label="Поділитися" title="Поділитися" onClick={onShare}>
            <Share size={18} />
            <span className="only-wide">Поділитися</span>
          </button>
        )}
        <button type="button" className="icon-btn only-narrow m-menu-btn" aria-label="Новий чат" onClick={onNewChat}>
          <SquarePen size={19} />
        </button>
      </div>
    </header>
  )

  // Новий чат або порожній; поки повідомлення вантажаться, привітання не показуємо.
  if (!chat || !list?.length) {
    return (
      <>
        {header}
        {chat?.jobs?.length ? <JobBar chat={chat} /> : null}
        <div className="welcome">
          {welcomeNote}
          <h1 className="welcome-title">{loading ? '' : 'Чим можу допомогти?'}</h1>
          {composer}
        </div>
      </>
    )
  }

  return (
    <>
      {header}
      {chat.jobs?.length ? <JobBar chat={chat} /> : null}
      <SelectionAsk onAsk={onQuote} />
      <div className="thread" ref={scroller} onScroll={onScroll}>
        <div className="thread-inner" ref={inner}>
          <ActionsContext.Provider value={actions}>
            {list.map((m, i) => (
              <Fragment key={m.id}>
                {needsTimeSeparator(list[i - 1], m) && <TimeSeparator at={m.createdAt} />}
                <MessageView m={m} />
              </Fragment>
            ))}
          </ActionsContext.Provider>
        </div>
      </div>
      <div className="bottom">
        {!atBottom && (
          <button type="button" className="to-bottom" aria-label="Донизу" onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })}>
            <ArrowDown size={18} />
          </button>
        )}
        <GoalBar chat={chat} flash={flash} />
        {composer}
      </div>
    </>
  )
}
