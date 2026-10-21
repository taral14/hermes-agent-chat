import { ArrowUp, Check, ChevronDown, FileText, Hand, ListChecks, Loader2, MessageSquarePlus, Paperclip, Sparkles, Square, SquareSlash, X, Zap, type LucideIcon } from 'lucide-react'
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { type CommandInfo, api, uploadUrl } from '../api.ts'
import { useAutosize } from '../hooks/useAutosize.ts'
import { getPrefs } from '../prefs.ts'
import type { Attachment, ChatMode } from '../shared.ts'

type Pending = { key: string; name: string; mime: string; preview?: string; att?: Attachment; error?: string }

export type ComposerHandle = { addFiles: (files: FileList | File[]) => void; focus: () => void; insertQuote: (text: string) => void }

type Props = {
  ref?: Ref<ComposerHandle>
  running: boolean
  /** Hermes чекає відповіді на питання: надіслане з поля стає своєю відповіддю. */
  answering?: boolean
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>
  onStop: () => void
  onSteer: (text: string) => Promise<boolean>
  draftKey: string
  /** Команди Hermes для меню «/» (лише в чатах на рідному протоколі). */
  commands?: CommandInfo[] | null
  /** Режим чату (як у Claude Code); без нього перемикача немає (старі чати). */
  mode?: ChatMode
  onMode?: (m: ChatMode) => void
  /** Вибір моделі й зусилля (стоїть поруч із кнопкою відправки, як у Claude). */
  modelSlot?: ReactNode
}

export const MODES: { mode: ChatMode; label: string; hint: string; Icon: LucideIcon }[] = [
  { mode: 'ask', label: 'Питати дозволу', hint: 'Hermes зупиняється на ризикованих командах і чекає твого рішення', Icon: Hand },
  { mode: 'auto', label: 'Дозволяти все', hint: 'Команди виконуються без запитів, задача не зупиняється', Icon: Zap },
  { mode: 'plan', label: 'Лише план', hint: 'Hermes складає план і нічого не виконує', Icon: ListChecks },
]

function ModePicker({ mode, onMode }: { mode: ChatMode; onMode: (m: ChatMode) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const cur = MODES.find((m) => m.mode === mode) ?? MODES[1]!
  return (
    <div className="mode-picker" ref={box}>
      <button type="button" className={`mode-chip is-${mode}`} onClick={() => setOpen((o) => !o)} title="Режим (Shift+Tab)">
        <cur.Icon size={15} />
        <span className="mode-chip-label">{cur.label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu mode-menu">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              className="menu-item"
              onClick={() => {
                onMode(m.mode)
                setOpen(false)
              }}
            >
              <span className={`mode-icon is-${m.mode}`}>
                <m.Icon size={16} />
              </span>
              <span className="menu-item-main">
                {m.label}
                <span className="menu-item-sub">{m.hint}</span>
              </span>
              {m.mode === mode && <Check size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const drafts = new Map<string, string>()

/** Підготувати текст у полі вводу чату (напр. «Обговорити з Hermes» з бази знань). */
export const setDraft = (key: string, text: string) => drafts.set(key, text)

export function Composer({ ref, running, answering, onSend, onStop, onSteer, draftKey, commands, mode, onMode, modelSlot }: Props) {
  const [text, setText] = useState(() => drafts.get(draftKey) ?? '')
  const [files, setFiles] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  /** Чат, у якому поле зараз: надсилання могло закінчитись уже після переходу в інший. */
  const keyRef = useRef(draftKey)
  keyRef.current = draftKey

  useEffect(() => {
    setText(drafts.get(draftKey) ?? '')
    setFiles([])
    // На телефоні фокус відкрив би клавіатуру й закрив пів відповіді: там поле фокусує лише «Новий чат».
    if (!matchMedia('(pointer: coarse)').matches) area.current?.focus()
  }, [draftKey])

  // Прев'ю картинок — blob-адреси: звільняємо пам'ять, щойно файл прибрано з поля.
  const previews = useRef(new Set<string>())
  useEffect(() => {
    const live = new Set(files.map((f) => f.preview))
    for (const u of previews.current) {
      if (live.has(u)) continue
      URL.revokeObjectURL(u)
      previews.current.delete(u)
    }
  }, [files])
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), [])

  useAutosize(area, text, 240)

  const addFiles = (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      const key = Math.random().toString(36).slice(2)
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      if (preview) previews.current.add(preview)
      setFiles((f) => [...f, { key, name: file.name || 'image.png', mime: file.type, preview }])
      const named = file.name ? file : new File([file], `image-${Date.now()}.png`, { type: file.type })
      api
        .upload(named)
        .then((att) => setFiles((f) => f.map((x) => (x.key === key ? { ...x, att } : x))))
        .catch((e: Error) => setFiles((f) => f.map((x) => (x.key === key ? { ...x, error: e.message } : x))))
    }
  }

  /** Цитата з відповіді: «> …» над тим, що вже набрано, курсор у кінці. */
  const insertQuote = (quote: string) => {
    const block = quote
      .trim()
      .split('\n')
      .map((l) => `> ${l}`.trimEnd())
      .join('\n')
    setText((prev) => {
      const next = `${block}\n\n${prev.replace(/^\s+/, '')}`
      drafts.set(draftKey, next)
      return next
    })
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      el.scrollTop = el.scrollHeight
    })
  }

  useImperativeHandle(ref, () => ({ addFiles, focus: () => area.current?.focus(), insertQuote }))

  const [menuIndex, setMenuIndex] = useState(0)
  const [menuClosed, setMenuClosed] = useState(false)
  const slashQuery = !running && commands && /^\/[^\s]*$/.test(text) ? text.slice(1).toLowerCase() : null
  const matches = useMemo(() => {
    if (slashQuery == null || !commands) return []
    const starts = commands.filter((c) => c.name.toLowerCase().startsWith(slashQuery))
    const contains = commands.filter((c) => !c.name.toLowerCase().startsWith(slashQuery) && c.name.toLowerCase().includes(slashQuery))
    return [...starts, ...contains].slice(0, 60)
  }, [slashQuery, commands])
  const menuOpen = matches.length > 0 && !menuClosed
  useEffect(() => {
    setMenuIndex(0)
    setMenuClosed(false)
  }, [slashQuery])
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [menuIndex])

  const pick = (c: CommandInfo) => {
    const next = `/${c.name}${c.hint || c.skill ? ' ' : ''}`
    setText(next)
    drafts.set(draftKey, next)
    setMenuClosed(true)
    area.current?.focus()
  }

  const uploading = files.some((f) => !f.att && !f.error)
  const ready = files.filter((f) => f.att).map((f) => f.att!)
  const canSend = !busy && !uploading && (text.trim().length > 0 || (!running && ready.length > 0))

  const submit = async () => {
    if (!canSend) return
    const key = draftKey
    const steering = running
    setBusy(true)
    const ok = steering ? await onSteer(text.trim()) : await onSend(text.trim(), ready)
    setBusy(false)
    if (!ok) return
    drafts.delete(key)
    // Поки йшло надсилання, людина могла перейти в інший чат: його чернетку не чіпаємо.
    if (keyRef.current !== key) return
    setText('')
    if (!steering) setFiles([])
    area.current?.focus()
  }

  return (
    <div className="composer-wrap">
      {menuOpen && (
        <div className="slash-menu" ref={listRef} role="listbox">
          {matches.map((c, i) => {
            const firstSkill = c.skill && !matches[i - 1]?.skill
            return (
              <div key={c.name}>
                {i === 0 && !c.skill && <div className="slash-group">Команди</div>}
                {firstSkill && <div className="slash-group">Навички</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === menuIndex}
                  className={`slash-item ${i === menuIndex ? 'is-active' : ''}`}
                  onMouseEnter={() => setMenuIndex(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c)}
                >
                  <span className="slash-icon">{c.skill ? <Sparkles size={15} /> : <SquareSlash size={15} />}</span>
                  <span className="slash-text">
                    <span className="slash-name">
                      /{c.name}
                      {c.hint && <span className="slash-hint"> {c.hint}</span>}
                    </span>
                    <span className="slash-desc">{c.description}</span>
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      )}
      <div className="composer">
        {files.length > 0 && (
          <div className="composer-files">
            {files.map((f) => (
              <div key={f.key} className={`chip ${f.error ? 'is-error' : ''}`} title={f.error ?? f.name}>
                {f.preview || (f.att && f.mime.startsWith('image/')) ? (
                  <img src={f.preview ?? uploadUrl(f.att!.id)} alt="" />
                ) : (
                  <span className="chip-icon">
                    <FileText size={18} />
                  </span>
                )}
                {!f.mime.startsWith('image/') && <span className="chip-name">{f.name}</span>}
                {!f.att && !f.error && (
                  <span className="chip-loading">
                    <Loader2 size={16} className="spin" />
                  </span>
                )}
                <button type="button" className="chip-x" aria-label="Прибрати" onClick={() => setFiles((x) => x.filter((y) => y.key !== f.key))}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          rows={1}
          value={text}
          placeholder={answering ? 'Своя відповідь…' : running ? 'Додати до поточної задачі…' : commands ? 'Напиши Hermes або «/» для команд' : 'Напиши Hermes'}
          onChange={(e) => {
            setText(e.target.value)
            drafts.set(draftKey, e.target.value)
          }}
          onKeyDown={(e) => {
            if (menuOpen) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                return setMenuIndex((i) => (i + 1) % matches.length)
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                return setMenuIndex((i) => (i - 1 + matches.length) % matches.length)
              }
              if (e.key === 'Escape') return setMenuClosed(true)
              const exact = matches[menuIndex]?.name.toLowerCase() === slashQuery
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !exact)) {
                e.preventDefault()
                return pick(matches[menuIndex]!)
              }
            }
            if (e.key === 'Tab' && e.shiftKey && mode && onMode) {
              // Як у Claude Code: Shift+Tab перемикає режим по колу.
              e.preventDefault()
              const i = MODES.findIndex((m) => m.mode === mode)
              return onMode(MODES[(i + 1) % MODES.length]!.mode)
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !matchMedia('(pointer: coarse)').matches) {
              // «Enter надсилає» вимкнено в налаштуваннях: надсилає ⌘/Ctrl+Enter, а Enter переносить рядок.
              if (!getPrefs().enterSends && !e.metaKey && !e.ctrlKey) return
              e.preventDefault()
              void submit()
            }
          }}
          onPaste={(e) => {
            const list = Array.from(e.clipboardData.files)
            if (list.length) {
              e.preventDefault()
              addFiles(list)
            }
          }}
        />
        <div className="composer-bar">
          <button type="button" className="icon-btn round" title="Прикріпити файл" aria-label="Прикріпити файл" onClick={() => picker.current?.click()}>
            <Paperclip size={18} />
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          {mode && onMode && <ModePicker mode={mode} onMode={onMode} />}
          <div className="composer-spacer" />
          {modelSlot}
          {running && answering && text.trim() ? (
            <button type="button" className="send-btn" title="Відповісти" aria-label="Відповісти" disabled={!canSend} onClick={() => void submit()}>
              {busy ? <Loader2 size={18} className="spin" /> : <ArrowUp size={20} strokeWidth={2.4} />}
            </button>
          ) : running && text.trim() ? (
            <button type="button" className="send-btn" title="Додати до поточної задачі" aria-label="Додати до задачі" disabled={!canSend} onClick={() => void submit()}>
              <MessageSquarePlus size={18} />
            </button>
          ) : running ? (
            <button type="button" className="send-btn" title="Зупинити" aria-label="Зупинити" onClick={onStop}>
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button type="button" className="send-btn" title="Надіслати" aria-label="Надіслати" disabled={!canSend} onClick={() => void submit()}>
              {busy ? <Loader2 size={18} className="spin" /> : <ArrowUp size={20} strokeWidth={2.4} />}
            </button>
          )}
        </div>
      </div>
      <div className="composer-hint">Hermes виконує дії на своєму комп'ютері. Перевіряй важливе.</div>
    </div>
  )
}
