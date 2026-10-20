import { Check, ExternalLink, Loader2, Plus, RefreshCw, Search, Trash2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, unfurl } from '../api.ts'
import { BRAND_ICONS, POPULAR, STATUS_TEXT, isSecretField, matches, pluginSubtitle, pluginTitle } from '../plugins.ts'
import { navigateTo, pluginsUrl } from '../router.ts'
import { plural } from '../schedule.ts'
import type { Plugin, PluginAuthFlow, PluginTest } from '../shared.ts'
import { Sheet } from './ui/Sheet.tsx'
import { Switch } from './ui/Switch.tsx'
import { TopBar } from './ui/TopBar.tsx'

type Props = {
  name: string | null
  sidebarOpen: boolean
  openSidebar: () => void
  /** Росте, коли Hermes перепідключив сервери (подія з сервера). */
  version: number
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ---------- Іконка ----------

/** Темний гліф на темній плитці не видно: майже чорні й майже білі бренди малюємо кольором тексту. */
function glyphColor(hex: string) {
  const n = Number.parseInt(hex, 16)
  const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
  return l < 0.18 || l > 0.9 ? 'currentColor' : `#${hex}`
}

/** Гліф бренду, інакше іконка з сайту сервісу, інакше перша літера. */
export function PluginIcon({ plugin, size = 44 }: { plugin: Plugin; size?: number }) {
  const brand = BRAND_ICONS[plugin.name]
  const [src, setSrc] = useState<string | null>(null)
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    if (brand || !plugin.host) return
    let alive = true
    void unfurl(`https://${plugin.host}/`).then((r) => alive && r.icon && setSrc(r.icon))
    return () => {
      alive = false
    }
  }, [brand, plugin.host])
  const style = { width: size, height: size, borderRadius: size * 0.27 }
  if (brand)
    return (
      <span className="plugin-icon" style={style} aria-hidden>
        <svg viewBox="0 0 24 24" width={size * 0.52} height={size * 0.52} fill={glyphColor(brand.hex)}>
          <path d={brand.path} />
        </svg>
      </span>
    )
  if (src && !broken)
    return (
      <span className="plugin-icon is-image" style={style} aria-hidden>
        <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      </span>
    )
  return (
    <span className="plugin-icon is-letter" style={{ ...style, fontSize: size * 0.42 }} aria-hidden>
      {pluginTitle(plugin.name).charAt(0).toUpperCase()}
    </span>
  )
}

const dotClass = (p: Plugin) =>
  p.status === 'connected' ? 'is-ok' : p.status === 'failed' ? 'is-bad' : p.status === 'disabled' ? 'is-off' : 'is-wait'

// ---------- Список ----------

function PluginRow({ plugin, onOpen }: { plugin: Plugin; onOpen: () => void }) {
  return (
    <button type="button" className="plugin-row" onClick={onOpen}>
      <PluginIcon plugin={plugin} />
      <span className="plugin-row-main">
        <span className="plugin-row-name">{pluginTitle(plugin.name)}</span>
        <span className="plugin-row-sub">{pluginSubtitle(plugin)}</span>
      </span>
      {plugin.installed ? (
        <span className={`plugin-state ${dotClass(plugin)}`}>{plugin.status ? STATUS_TEXT[plugin.status] : ''}</span>
      ) : (
        <span className="plugin-add" aria-label="Підключити">
          <Plus size={22} />
        </span>
      )}
    </button>
  )
}

export function PluginsView({ name, sidebarOpen, openSidebar, version }: Props) {
  const [list, setList] = useState<Plugin[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  /** Картку відкрили зі списку: «Закрити» = крок назад в історії, а не новий запис. */
  const fromList = useRef(false)

  const load = useCallback(
    () =>
      api
        .plugins()
        .then((l) => {
          setList(l)
          setError('')
        })
        .catch((e: unknown) => setError(message(e))),
    [],
  )
  useEffect(() => {
    void load()
  }, [load, version])

  const groups = useMemo(() => {
    const all = list ?? []
    const byTitle = (a: Plugin, b: Plugin) => pluginTitle(a.name).localeCompare(pluginTitle(b.name))
    const installed = all.filter((p) => p.installed).sort(byTitle)
    const rest = all.filter((p) => !p.installed && p.catalog)
    const popular = POPULAR.map((n) => rest.find((p) => p.name === n)).filter((p): p is Plugin => Boolean(p))
    const open = rest.filter((p) => p.auth === 'none' && !POPULAR.includes(p.name)).sort(byTitle)
    const other = rest.filter((p) => !popular.includes(p) && !open.includes(p)).sort(byTitle)
    return { installed, popular, open, other }
  }, [list])

  const openPlugin = (p: Plugin) => {
    fromList.current = true
    navigateTo(pluginsUrl(p.name))
  }
  const close = () => {
    if (fromList.current) history.back()
    else navigateTo(pluginsUrl(null), true)
    fromList.current = false
  }

  const found = q.trim() ? (list ?? []).filter((p) => matches(p, q)) : null
  const current = name ? (list?.find((p) => p.name === name) ?? null) : null
  const working = groups.installed.filter((p) => p.status === 'connected').length

  const section = (title: string, items: Plugin[]) =>
    items.length > 0 && (
      <section className="jobs-section">
        <h2>{title}</h2>
        <div className="plugin-list">
          {items.map((p) => (
            <PluginRow key={p.name} plugin={p} onOpen={() => openPlugin(p)} />
          ))}
        </div>
      </section>
    )

  return (
    <>
      <TopBar title="Плагіни" sidebarOpen={sidebarOpen} openSidebar={openSidebar} />
      <div className="jobs-scroll">
        <div className="jobs-inner">
          <div className="jobs-hero">
            <h1>Плагіни</h1>
            <p>
              Сервіси, якими Hermes користується в розмовах і задачах.
              {list && groups.installed.length > 0 && ` Підключено ${groups.installed.length}, працює ${working}.`}
            </p>
          </div>

          <label className="plugin-search">
            <Search size={18} />
            <input type="search" placeholder="Пошук плагінів" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>

          {error && !list && (
            <div className="jobs-empty">
              <p>{error}</p>
              <button type="button" className="btn" onClick={() => void load()}>
                <RefreshCw size={16} /> Спробувати ще
              </button>
            </div>
          )}
          {!list && !error && (
            <div className="jobs-loading">
              <Loader2 size={22} className="spin" />
            </div>
          )}

          {found ? (
            found.length ? (
              section(`Знайдено ${found.length}`, found)
            ) : (
              <div className="jobs-empty">
                <p>Нічого не знайшлося. Свій MCP-сервер можна додати в config.yaml Hermes.</p>
              </div>
            )
          ) : (
            list && (
              <>
                {groups.installed.length > 0 && (
                  <section className="jobs-section">
                    <h2>Підключені</h2>
                    <div className="plugin-tiles">
                      {groups.installed.map((p) => (
                        <button key={p.name} type="button" className="plugin-tile" onClick={() => openPlugin(p)} title={pluginTitle(p.name)}>
                          <span className="plugin-tile-icon">
                            <PluginIcon plugin={p} size={56} />
                            <span className={`plugin-dot ${dotClass(p)}`} aria-label={p.status ? STATUS_TEXT[p.status] : undefined} />
                          </span>
                          <span className="plugin-tile-name">{pluginTitle(p.name)}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {section('Популярні', groups.popular)}
                {section('Без входу', groups.open)}
                {section('Усі', groups.other)}
              </>
            )
          )}
        </div>
      </div>
      {current && <PluginSheet key={current.name} plugin={current} onClose={close} reload={load} />}
    </>
  )
}

// ---------- Картка плагіна ----------

const RELOAD_NOTE = {
  now: '',
  'after-run': 'Hermes застосує зміну, щойно закінчить поточну відповідь.',
} as const

function PluginSheet({ plugin: p, onClose, reload }: { plugin: Plugin; onClose: () => void; reload: () => Promise<void> }) {
  const title = pluginTitle(p.name)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [env, setEnv] = useState<Record<string, string>>({})
  const [test, setTest] = useState<PluginTest | null>(null)
  const [flow, setFlow] = useState<PluginAuthFlow | null>(null)
  const [pasted, setPasted] = useState('')
  const [confirm, setConfirm] = useState(false)

  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind)
    setErr('')
    try {
      await fn()
    } catch (e) {
      setErr(message(e))
    } finally {
      setBusy('')
    }
  }

  const startAuth = () =>
    run('auth', async () => {
      setTest(null)
      const f = await api.startPluginAuth(p.name)
      if (f.status === 'error') throw new Error(f.error || 'Hermes не зміг почати вхід')
      setFlow(f)
    })

  const install = () =>
    run('install', async () => {
      const r = await api.installPlugin(p.name, env)
      setNote(RELOAD_NOTE[r.reload])
      await reload()
      if (p.auth === 'oauth') {
        const f = await api.startPluginAuth(p.name)
        if (f.status === 'error') throw new Error(f.error || 'Hermes не зміг почати вхід')
        setFlow(f)
      } else setNote(`${title} підключено. ${RELOAD_NOTE[r.reload]}`.trim())
    })

  const toggle = (on: boolean) =>
    run('toggle', async () => {
      const r = await api.setPluginEnabled(p.name, on)
      setNote(RELOAD_NOTE[r.reload])
      await reload()
    })

  const remove = () =>
    run('remove', async () => {
      await api.removePlugin(p.name)
      await reload()
      onClose()
    })

  const check = () => run('test', async () => setTest(await api.testPlugin(p.name)))

  const finish = () =>
    run('paste', async () => {
      if (!flow) return
      setFlow(await api.finishPluginFlow(flow.id, pasted))
    })

  // Чекаємо, поки людина увійде на сторінці сервісу; закриття картки скасовує незавершений вхід.
  const pending = flow && (flow.status === 'starting' || flow.status === 'authorization_required') ? flow.id : null
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => {
      api
        .pluginFlow(pending)
        .then((f) => {
          setFlow(f)
          if (f.status === 'approved') {
            setNote(`Готово: ${title} підключено.`)
            void reload()
          }
        })
        .catch((e: unknown) => {
          setFlow(null)
          setErr(message(e))
        })
    }, 2000)
    return () => clearInterval(t)
  }, [pending, title, reload])
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  useEffect(() => () => void (pendingRef.current && api.cancelPluginFlow(pendingRef.current).catch(() => {})), [])

  const missing = p.env.some((v) => v.required && !env[v.name]?.trim())
  const canEdit = !p.fromPlugin
  const needsLogin = p.installed && p.auth === 'oauth' && (p.status === 'needs_auth' || p.status === 'failed' || test?.needsAuth)

  return (
    <Sheet title={title} label={`Плагін ${title}`} className="plugin-sheet" onClose={onClose}>
      <div className="plugin-head">
        <PluginIcon plugin={p} size={64} />
        <div>
          <p className="plugin-head-sub">{pluginSubtitle(p)}</p>
          {p.installed && p.status && (
            <span className={`plugin-state ${dotClass(p)}`}>
              {STATUS_TEXT[p.status]}
              {p.tools ? ` · ${p.tools} ${plural(p.tools, 'інструмент', 'інструменти', 'інструментів')}` : ''}
            </span>
          )}
        </div>
      </div>

      {p.docs && (
        <a className="plugin-docs" href={p.docs} target="_blank" rel="noreferrer">
          <ExternalLink size={15} /> Про цей сервер
        </a>
      )}

      {!p.installed && (
        <div className="form-card">
          <p className="sheet-lead">
            {p.auth === 'oauth'
              ? `Hermes відкриє сторінку ${title}, де ти дозволиш доступ. Пароль від сервісу Hermes не бачить.`
              : 'Входити нікуди не треба: Hermes одразу зможе ним користуватися.'}
          </p>
          {p.env.map((v) => (
            <label key={v.name} className="field">
              <span className="field-label">{v.prompt}</span>
              <input
                type={isSecretField(v.name) ? 'password' : 'text'}
                autoComplete="off"
                value={env[v.name] ?? ''}
                onChange={(e) => setEnv({ ...env, [v.name]: e.target.value })}
              />
            </label>
          ))}
          <button type="button" className="btn btn-primary btn-wide" disabled={!!busy || missing} onClick={() => void install()}>
            {busy === 'install' ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
            Підключити
          </button>
        </div>
      )}

      {flow && flow.status !== 'approved' && (
        <div className="form-card plugin-auth">
          {flow.status === 'error' ? (
            <>
              <p className="sheet-lead">Вхід не вдався: {flow.error || 'невідома помилка'}</p>
              <button type="button" className="btn" onClick={() => void startAuth()}>
                <RefreshCw size={16} /> Спробувати ще
              </button>
            </>
          ) : (
            <>
              <p className="sheet-lead">Увійди в {title} і дозволь доступ. Ця картка сама побачить, коли все готово.</p>
              {flow.url ? (
                <a className="btn btn-primary btn-wide" href={flow.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} /> Відкрити {title}
                </a>
              ) : (
                <div className="jobs-loading">
                  <Loader2 size={20} className="spin" />
                </div>
              )}
              {flow.loopback && (
                <div className="plugin-paste">
                  <p className="field-hint">
                    Після входу {title} перекине на адресу 127.0.0.1, яка відкривається лише на комп’ютері з Hermes. Якщо побачиш помилку
                    «сторінка недоступна», скопіюй адресу тієї сторінки й встав сюди.
                  </p>
                  <div className="field-inline">
                    <input placeholder="http://127.0.0.1:…/callback?code=…" value={pasted} onChange={(e) => setPasted(e.target.value)} />
                    <button type="button" className="btn" disabled={!pasted.trim() || !!busy} onClick={() => void finish()}>
                      {busy === 'paste' ? <Loader2 size={16} className="spin" /> : 'Готово'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {p.installed && (
        <>
          {needsLogin && !flow && (
            <button type="button" className="btn btn-primary btn-wide" disabled={!!busy || !canEdit} onClick={() => void startAuth()}>
              {busy === 'auth' ? <Loader2 size={16} className="spin" /> : <ExternalLink size={16} />}
              Увійти в {title}
            </button>
          )}
          <div className="job-sheet-row">
            <Wrench size={18} />
            <span>
              <b>Hermes користується</b>
              <small>{p.enabled ? 'Інструменти доступні в розмовах і задачах' : 'Вимкнено: Hermes його не бачить'}</small>
            </span>
            <Switch on={p.enabled} busy={busy === 'toggle'} disabled={!canEdit || (!!busy && busy !== 'toggle')} label="Увімкнено" onChange={(v) => void toggle(v)} />
          </div>
          {p.fromPlugin && <p className="field-hint">Цей сервер додав плагін Hermes «{p.fromPlugin}»: керуй ним там.</p>}

          <div className="plugin-actions">
            <button type="button" className="btn" disabled={!!busy || !p.enabled} onClick={() => void check()}>
              {busy === 'test' ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              Перевірити
            </button>
          </div>
          {test && (
            <div className="form-card plugin-test">
              {test.ok ? (
                <>
                  <span className="field-label">
                    Що вміє · {test.tools.length} {plural(test.tools.length, 'інструмент', 'інструменти', 'інструментів')}
                  </span>
                  <ul>
                    {test.tools.map((t) => (
                      <li key={t.name}>
                        <code>{t.name}</code>
                        {t.description && <span>{t.description}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="sheet-lead is-error">{test.error}</p>
              )}
            </div>
          )}

          {p.catalog &&
            canEdit &&
            (confirm ? (
              <div className="confirm">
                <span>Відключити {title}? Hermes перестане ним користуватися.</span>
                <div>
                  <button type="button" className="btn" onClick={() => setConfirm(false)}>
                    Скасувати
                  </button>
                  <button type="button" className="btn btn-danger-solid" disabled={busy === 'remove'} onClick={() => void remove()}>
                    {busy === 'remove' ? <Loader2 size={16} className="spin" /> : 'Відключити'}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="job-sheet-delete" onClick={() => setConfirm(true)}>
                <Trash2 size={16} /> Відключити
              </button>
            ))}
          {!p.catalog && <p className="field-hint">Свій сервер із config.yaml Hermes: тут його можна вимкнути, а прибрати — лише в конфігу.</p>}
        </>
      )}

      {note && <p className="plugin-note">{note}</p>}
      {err && <div className="notif-msg">{err}</div>}
    </Sheet>
  )
}
