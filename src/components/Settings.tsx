import {
  Bell,
  Bot,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileDown,
  Info,
  Link2,
  Loader2,
  LogOut,
  MessageSquarePlus,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api.ts'
import { formatSize } from '../fileKind.ts'
import { TEXT_SIZES, type Theme, setPrefs, usePrefs } from '../prefs.ts'
import { relative } from '../schedule.ts'
import type { ChatPrefs, ModelOptions, SettingsInfo, ShareListItem, StorageInfo } from '../shared.ts'
import { MODES } from './Composer.tsx'
import { ModelPicker, prettyModel } from './ModelPicker.tsx'

type SectionId = 'appearance' | 'chats' | 'hermes' | 'account' | 'data' | 'about'

const SECTIONS: { id: SectionId; label: string; Icon: LucideIcon }[] = [
  { id: 'appearance', label: 'Вигляд', Icon: Palette },
  { id: 'chats', label: 'Нові чати', Icon: MessageSquarePlus },
  { id: 'hermes', label: 'Hermes', Icon: Bot },
  { id: 'account', label: 'Обліковий запис', Icon: UserRound },
  { id: 'data', label: 'Дані', Icon: Database },
  { id: 'about', label: 'Про застосунок', Icon: Info },
]

// ---------- Будівельні блоки ----------

function Group({ title, foot, children }: { title?: string; foot?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-group">
      {title && <h3 className="set-group-title">{title}</h3>}
      <div className="set-card">{children}</div>
      {foot && <p className="set-foot">{foot}</p>}
    </section>
  )
}

function ToggleRow({ title, hint, value, onChange }: { title: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="set-row">
      <span className="set-row-text">
        <span className="set-row-title">{title}</span>
        {hint && <span className="set-row-hint">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={value} className={`switch ${value ? 'is-on' : ''}`} onClick={() => onChange(!value)}>
        <span className="switch-knob" />
      </button>
    </label>
  )
}

function NavRow({ Icon, title, hint, onClick, danger, href }: { Icon: LucideIcon; title: string; hint?: string; onClick?: () => void; danger?: boolean; href?: string }) {
  const body = (
    <>
      <span className={`set-row-icon ${danger ? 'is-danger' : ''}`}>
        <Icon size={18} />
      </span>
      <span className="set-row-text">
        <span className="set-row-title">{title}</span>
        {hint && <span className="set-row-hint">{hint}</span>}
      </span>
      {href ? (
        href.startsWith('/') ? <Download size={16} className="set-chevron" /> : <ExternalLink size={16} className="set-chevron" />
      ) : (
        !danger && <ChevronRight size={18} className="set-chevron" />
      )}
    </>
  )
  return href ? (
    <a className="set-row is-button" href={href} target={href.startsWith('/') ? undefined : '_blank'} rel="noreferrer" download={href.startsWith('/api/export') ? '' : undefined}>
      {body}
    </a>
  ) : (
    <button type="button" className={`set-row is-button ${danger ? 'is-danger' : ''}`} onClick={onClick}>
      {body}
    </button>
  )
}

// ---------- Вигляд ----------

const THEMES: { id: Theme; label: string; Icon: LucideIcon }[] = [
  { id: 'system', label: 'Як у системі', Icon: Monitor },
  { id: 'light', label: 'Світла', Icon: Sun },
  { id: 'dark', label: 'Темна', Icon: Moon },
]

function Appearance() {
  const prefs = usePrefs()
  const coarse = matchMedia('(pointer: coarse)').matches
  return (
    <>
      <Group title="Тема">
        <div className="theme-tiles">
          {THEMES.map((t) => (
            <button key={t.id} type="button" className={`theme-tile ${prefs.theme === t.id ? 'is-on' : ''}`} onClick={() => setPrefs({ theme: t.id })}>
              <span className={`theme-preview is-${t.id}`}>
                <span className="tp-side" />
                <span className="tp-main">
                  <span className="tp-bubble" />
                  <span className="tp-line" />
                  <span className="tp-line short" />
                </span>
              </span>
              <span className="theme-label">
                <t.Icon size={15} />
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Розмір тексту" foot="Змінює текст повідомлень, бази знань і поля вводу на цьому пристрої.">
        <div className="text-size">
          <div className="text-size-steps" role="radiogroup" aria-label="Розмір тексту">
            {TEXT_SIZES.map((s, i) => (
              <button
                key={s.label}
                type="button"
                role="radio"
                aria-checked={prefs.textSize === i}
                aria-label={s.label}
                className={`text-size-step ${prefs.textSize === i ? 'is-on' : ''}`}
                style={{ fontSize: `${13 + i * 2.5}px` }}
                onClick={() => setPrefs({ textSize: i })}
              >
                А
              </button>
            ))}
          </div>
          <div className="text-size-preview" style={{ fontSize: `calc(1rem * ${TEXT_SIZES[prefs.textSize]?.scale ?? 1})` }}>
            <span className="tsp-bubble">Привіт! Як тобі такий розмір?</span>
            <span className="tsp-answer">Так виглядатимуть відповіді Hermes. {TEXT_SIZES[prefs.textSize]?.label} розмір.</span>
          </div>
        </div>
      </Group>

      <Group title="Чат">
        {!coarse && (
          <ToggleRow
            title="Enter надсилає"
            hint={prefs.enterSends ? 'Shift+Enter — новий рядок' : 'Надсилає ⌘+Enter, Enter — новий рядок'}
            value={prefs.enterSends}
            onChange={(v) => setPrefs({ enterSends: v })}
          />
        )}
        <ToggleRow
          title="Показувати хід роботи"
          hint="Кроки Hermes лишаються розгорнутими і після відповіді"
          value={prefs.expandActivity}
          onChange={(v) => setPrefs({ expandActivity: v })}
        />
        <ToggleRow title="Модель і токени під відповіддю" value={prefs.showMeta} onChange={(v) => setPrefs({ showMeta: v })} />
      </Group>
    </>
  )
}

// ---------- Нові чати ----------

function Chats({ prefs, models, onChange }: { prefs: ChatPrefs; models: ModelOptions | null; onChange: (p: Partial<ChatPrefs>) => void }) {
  const [draft, setDraft] = useState(prefs.instructions)
  const [saved, setSaved] = useState(false)
  useEffect(() => setDraft(prefs.instructions), [prefs.instructions])
  const dirty = draft.trim() !== prefs.instructions
  return (
    <>
      <Group title="Режим за замовчуванням" foot="У кожному чаті режим можна змінити в полі вводу або через Shift+Tab.">
        {MODES.map((m) => (
          <button key={m.mode} type="button" className="set-row is-button" onClick={() => onChange({ defaultMode: m.mode })}>
            <span className={`set-row-icon mode-ico is-${m.mode}`}>
              <m.Icon size={18} />
            </span>
            <span className="set-row-text">
              <span className="set-row-title">{m.label}</span>
              <span className="set-row-hint">{m.hint}</span>
            </span>
            {prefs.defaultMode === m.mode && <Check size={18} className="set-check" />}
          </button>
        ))}
      </Group>

      <Group title="Модель і зусилля" foot="«Авто» бере модель і зусилля з налаштувань Hermes. Telegram це не змінює.">
        <div className="set-row set-model">
          <span className="set-row-text">
            <span className="set-row-title">Для нових чатів</span>
            <span className="set-row-hint">{prefs.defaultModel?.model ? prettyModel(prefs.defaultModel.model) : `Як у Hermes${models ? ` · ${prettyModel(models.current.model)}` : ''}`}</span>
          </span>
          <ModelPicker value={prefs.defaultModel} options={models} onChange={(v) => onChange({ defaultModel: v })} narrow={matchMedia('(max-width: 768px)').matches} />
        </div>
      </Group>

      <Group title="Особисті інструкції" foot="Додаються до кожного запиту з цього чату. Telegram і задачі за розкладом не зачіпають.">
        <div className="set-instructions">
          <textarea
            value={draft}
            maxLength={4000}
            rows={5}
            placeholder={'Наприклад: відповідай коротко, без вступів.\nТаблиці краще за довгі списки.\nЗвертайся на «ти».'}
            onChange={(e) => {
              setDraft(e.target.value)
              setSaved(false)
            }}
          />
          <div className="set-instructions-foot">
            <span>{draft.length} / 4000</span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!dirty}
              onClick={() => {
                onChange({ instructions: draft.trim() })
                setSaved(true)
              }}
            >
              {saved && !dirty ? 'Збережено' : 'Зберегти'}
            </button>
          </div>
        </div>
      </Group>

      <Group>
        <ToggleRow
          title="Автоматичні назви чатів"
          hint={prefs.autoTitles ? 'Hermes придумує назву після перших повідомлень' : 'Назва — початок першого повідомлення'}
          value={prefs.autoTitles}
          onChange={(v) => onChange({ autoTitles: v })}
        />
      </Group>
    </>
  )
}

// ---------- Hermes ----------

function Hermes({ info, models, onJobs }: { info: SettingsInfo | null; models: ModelOptions | null; onJobs: () => void }) {
  const dot = (ok: boolean | undefined) => <span className={`status-dot ${ok ? 'is-ok' : ok === false ? 'is-bad' : ''}`} />
  return (
    <>
      <Group title="Стан">
        <div className="set-row">
          <span className="set-row-text">
            <span className="set-row-title">Зв’язок з Hermes</span>
          </span>
          <span className="set-value">
            {dot(info?.about.hermes)}
            {!info ? '…' : info.about.hermes ? 'На зв’язку' : 'Немає зв’язку'}
          </span>
        </div>
        <div className="set-row">
          <span className="set-row-text">
            <span className="set-row-title">Модель Hermes</span>
          </span>
          <span className="set-value">{models ? `${prettyModel(models.current.model)} · ${models.current.provider}` : '…'}</span>
        </div>
        <div className="set-row">
          <span className="set-row-text">
            <span className="set-row-title">База знань</span>
          </span>
          <span className="set-value">
            {dot(info?.about.vault)}
            {!info ? '…' : info.about.vault ? 'Підключена' : 'Недоступна'}
          </span>
        </div>
      </Group>
      <Group foot="Задачі зазвичай живуть у своїх чатах. Тут — усі разом, зокрема ті, що пишуть у Telegram, і службові скрипти.">
        <NavRow Icon={CalendarClock} title="Усі задачі за розкладом" onClick={onJobs} />
      </Group>
      {info?.about.panelUrl && (
        <Group foot="Сесії, навички, пам’ять і повні налаштування Hermes.">
          <NavRow Icon={ExternalLink} title="Панель Hermes" hint={info.about.panelUrl.replace(/^https?:\/\//, '')} href={info.about.panelUrl} />
        </Group>
      )}
    </>
  )
}

// ---------- Обліковий запис ----------

function Account({ username, onNotifications, onSecurity, onLogout }: { username: string; onNotifications: () => void; onSecurity: () => void; onLogout: () => void }) {
  return (
    <>
      <div className="set-user">
        <span className="avatar big">{username.slice(0, 1).toUpperCase()}</span>
        <span className="set-user-name">{username}</span>
      </div>
      <Group>
        <NavRow Icon={Bell} title="Сповіщення" hint="Відповіді, запити на дозвіл, задачі за розкладом" onClick={onNotifications} />
        <NavRow Icon={ShieldCheck} title="Вхід і безпека" hint="Ключі доступу, пароль, пристрої" onClick={onSecurity} />
      </Group>
      <Group>
        <NavRow Icon={LogOut} title="Вийти" danger onClick={onLogout} />
      </Group>
    </>
  )
}

// ---------- Дані ----------

function Data({ onDeletedAll }: { onDeletedAll: () => void }) {
  const [shares, setShares] = useState<ShareListItem[] | null>(null)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [copied, setCopied] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.shares().then(setShares).catch((e: Error) => setMsg(e.message))
    api.storage().then(setStorage).catch((e: Error) => setMsg(e.message))
  }, [])

  return (
    <>
      <Group title="Посилання, якими ти поділився" foot={shares?.length ? 'Видалене посилання одразу перестає працювати.' : undefined}>
        {!shares ? (
          <div className="set-row set-muted">Завантажую…</div>
        ) : !shares.length ? (
          <div className="set-row set-muted">Поки що немає. Поділитися чатом можна кнопкою вгорі чату.</div>
        ) : (
          shares.map((s) => (
            <div key={s.chatId} className="set-row">
              <span className="set-row-icon">
                <Link2 size={17} />
              </span>
              <span className="set-row-text">
                <span className="set-row-title">{s.title}</span>
                <span className="set-row-hint">оновлено {relative(s.updatedAt)}</span>
              </span>
              <button
                type="button"
                className="icon-btn round"
                aria-label="Копіювати посилання"
                title="Копіювати посилання"
                onClick={() =>
                  void navigator.clipboard.writeText(s.url).then(() => {
                    setCopied(s.chatId)
                    setTimeout(() => setCopied(''), 1500)
                  })
                }
              >
                {copied === s.chatId ? <Check size={16} /> : <Copy size={16} />}
              </button>
              <button
                type="button"
                className="icon-btn round danger-icon"
                aria-label="Видалити посилання"
                title="Видалити посилання"
                onClick={() =>
                  void api
                    .deleteShare(s.chatId)
                    .then(() => setShares((l) => l?.filter((x) => x.chatId !== s.chatId) ?? null))
                    .catch((e: Error) => setMsg(e.message))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}
      </Group>

      <Group title="Місце на сервері">
        <div className="set-row">
          <span className="set-row-text">
            <span className="set-row-title">Файли в чатах</span>
            {storage && storage.macFiles > 0 && <span className="set-row-hint">Ще {storage.macFiles} великих файлів лежать на місці й місця не займають</span>}
          </span>
          <span className="set-value">{storage ? `${storage.files} · ${formatSize(storage.bytes)}` : '…'}</span>
        </div>
        <div className="set-row">
          <span className="set-row-text">
            <span className="set-row-title">Історія чатів</span>
          </span>
          <span className="set-value">{storage ? formatSize(storage.dbBytes) : '…'}</span>
        </div>
        <div className="set-row">
          <span className="set-row-text">
            <span className="set-row-title">Картки посилань</span>
            <span className="set-row-hint">Збережені заголовки й картинки сторінок</span>
          </span>
          <button
            type="button"
            className="btn"
            disabled={!storage?.linkCache || busy === 'cache'}
            onClick={() => {
              setBusy('cache')
              api
                .clearLinkCache()
                .then(setStorage)
                .catch((e: Error) => setMsg(e.message))
                .finally(() => setBusy(''))
            }}
          >
            {storage?.linkCache ? `Очистити (${storage.linkCache})` : 'Порожньо'}
          </button>
        </div>
      </Group>

      <Group foot="Усі чати одним файлом Markdown: хто що написав і назви прикріплених файлів.">
        <NavRow Icon={FileDown} title="Експортувати всі чати" hint="Файл .md з усіма розмовами" href="/api/export" />
      </Group>

      <Group>
        {confirm ? (
          <div className="set-row set-danger-confirm">
            <span className="set-row-text">
              <span className="set-row-title">Видалити всі чати назавжди?</span>
              <span className="set-row-hint">Разом із файлами, сесіями Hermes і посиланнями. Відновити не вийде.</span>
            </span>
            <span className="set-confirm-actions">
              <button
                type="button"
                className="btn btn-danger-solid"
                disabled={busy === 'all'}
                onClick={() => {
                  setBusy('all')
                  api
                    .deleteAllChats()
                    .then((r) => {
                      setMsg(`Видалено чатів: ${r.deleted}`)
                      setConfirm(false)
                      setShares([])
                      onDeletedAll()
                      return api.storage().then(setStorage)
                    })
                    .catch((e: Error) => setMsg(e.message))
                    .finally(() => setBusy(''))
                }}
              >
                {busy === 'all' ? <Loader2 size={16} className="spin" /> : 'Видалити все'}
              </button>
              <button type="button" className="icon-btn round" aria-label="Скасувати" onClick={() => setConfirm(false)}>
                <X size={16} />
              </button>
            </span>
          </div>
        ) : (
          <NavRow Icon={Trash2} title="Видалити всі чати" danger onClick={() => setConfirm(true)} />
        )}
      </Group>
      {msg && <div className="notif-msg">{msg}</div>}
    </>
  )
}

// ---------- Про застосунок ----------

function About({ info }: { info: SettingsInfo | null }) {
  return (
    <Group foot="Свій чат для Hermes Agent: React, SQLite і рідний протокол Hermes.">
      <div className="set-row">
        <span className="set-row-text">
          <span className="set-row-title">Версія</span>
        </span>
        <span className="set-value mono">{info?.about.version ?? '…'}</span>
      </div>
      <div className="set-row">
        <span className="set-row-text">
          <span className="set-row-title">Сервер запущено</span>
        </span>
        <span className="set-value">{info ? relative(info.about.startedAt) : '…'}</span>
      </div>
    </Group>
  )
}

// ---------- Екран налаштувань ----------

type Props = {
  narrow: boolean
  username: string
  models: ModelOptions | null
  onClose: () => void
  onNotifications: () => void
  onJobs: () => void
  onSecurity: () => void
  onLogout: () => void
  /** Змінились спільні налаштування (режим, модель нових чатів). */
  onPrefs: (p: ChatPrefs) => void
  onDeletedAll: () => void
}

export function Settings(p: Props) {
  const [section, setSection] = useState<SectionId>('appearance')
  const [info, setInfo] = useState<SettingsInfo | null>(null)
  const [err, setErr] = useState('')

  const close = useRef(p.onClose)
  close.current = p.onClose

  useEffect(() => {
    api.settings().then(setInfo).catch((e: Error) => setErr(e.message))
    // Escape закриває налаштування, якщо поверх не відкрита шторка (сповіщення, безпека, модель).
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.sheet-backdrop') && close.current()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [])

  const change = (patch: Partial<ChatPrefs>) => {
    if (!info) return
    const prefs = { ...info.prefs, ...patch }
    setInfo({ ...info, prefs })
    p.onPrefs(prefs)
    api
      .patchSettings(patch)
      .then((saved) => {
        setInfo((i) => (i ? { ...i, prefs: saved } : i))
        p.onPrefs(saved)
      })
      .catch((e: Error) => setErr(e.message))
  }

  const render = (id: SectionId) => {
    switch (id) {
      case 'appearance':
        return <Appearance />
      case 'chats':
        return info ? <Chats prefs={info.prefs} models={p.models} onChange={change} /> : <Loader2 size={22} className="spin set-loading" />
      case 'hermes':
        return <Hermes info={info} models={p.models} onJobs={p.onJobs} />
      case 'account':
        return <Account username={p.username} onNotifications={p.onNotifications} onSecurity={p.onSecurity} onLogout={p.onLogout} />
      case 'data':
        return <Data onDeletedAll={p.onDeletedAll} />
      case 'about':
        return <About info={info} />
    }
  }

  // Телефон: увесь екран, розділи один під одним. Комп'ютер: вікно з розділами ліворуч.
  if (p.narrow) {
    return createPortal(
      <div className="settings-page" role="dialog" aria-modal="true" aria-label="Налаштування">
        <header className="settings-top">
          <button type="button" className="icon-btn round" aria-label="Назад" onClick={p.onClose}>
            <ChevronLeft size={22} />
          </button>
          <h2>Налаштування</h2>
          <span style={{ width: 40 }} />
        </header>
        <div className="settings-scroll">
          {(['account', 'appearance', 'chats', 'hermes', 'data', 'about'] as SectionId[]).map((id) => (
            <div key={id} className="settings-section">
              <h2 className="settings-section-title">{SECTIONS.find((s) => s.id === id)!.label}</h2>
              {render(id)}
            </div>
          ))}
          {err && <div className="notif-msg">{err}</div>}
        </div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div className="settings-backdrop" onClick={p.onClose}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Налаштування" onClick={(e) => e.stopPropagation()}>
        <nav className="settings-nav">
          <div className="settings-nav-head">
            <button type="button" className="icon-btn round" aria-label="Закрити" onClick={p.onClose}>
              <X size={20} />
            </button>
          </div>
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={`settings-nav-item ${section === s.id ? 'is-on' : ''}`} onClick={() => setSection(s.id)}>
              <s.Icon size={18} />
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <h2 className="settings-body-title">{SECTIONS.find((s) => s.id === section)!.label}</h2>
          {render(section)}
          {err && <div className="notif-msg">{err}</div>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
