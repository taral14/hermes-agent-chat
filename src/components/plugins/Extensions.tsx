import { ExternalLink, Loader2, RefreshCw, Trash2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api.ts'
import { pluginTitle } from '../../plugins.ts'
import type { Extension, ExtensionSetting } from '../../shared.ts'
import { Sheet } from '../ui/Sheet.tsx'
import { Switch } from '../ui/Switch.tsx'
import { Chips, Empty, ImageIcon, Limited, LoadState, Row, Section, type TabProps, message, useLoad } from './ui.tsx'

const CATEGORY: Record<string, string> = {
  tools: 'Інструменти',
  voice: 'Голос',
  memory: 'Пам’ять',
  web: 'Веб',
  automation: 'Автоматизація',
  models: 'Моделі',
  platform: 'Платформи',
  general: 'Інше',
  desktop: 'Десктоп',
}
const TIER = { official: 'Від Hermes', verified: 'Перевірене', community: 'Спільнота' } as const

const categoryLabel = (c: string) => CATEGORY[c] ?? c
/** У каталозі назва часто збігається з технічною (claude-subscription-directsdk): робимо її читабельною. */
const title = (e: Extension) => (e.title === e.name ? pluginTitle(e.name) : e.title)
const stateText = (e: Extension) => (e.status === 'enabled' ? 'Увімкнено' : e.status === 'available' ? 'У папці, вимкнено' : 'Вимкнено')
const matches = (e: Extension, q: string) => {
  const s = q.trim().toLowerCase()
  return !s || [e.name, e.title, e.description, e.maintainer].some((x) => x.toLowerCase().includes(s))
}

function ExtensionRow({ ext, onOpen }: { ext: Extension; onOpen: () => void }) {
  return (
    <Row
      icon={<ImageIcon src={ext.image} name={ext.title} />}
      title={title(ext)}
      sub={ext.description}
      right={ext.installed ? <span className={`plugin-state ${ext.status === 'enabled' ? 'is-ok' : 'is-off'}`}>{stateText(ext)}</span> : null}
      onOpen={onOpen}
    />
  )
}

/** Вкладка «Розширення»: code-плагіни Hermes з його каталогу та з папки ~/.hermes/plugins. */
export function ExtensionsTab({ q, id, open, close, version }: TabProps) {
  const { data: list, error, reload } = useLoad(api.extensions, version)
  const [category, setCategory] = useState('all')

  const groups = useMemo(() => {
    const all = list ?? []
    const byTitle = (a: Extension, b: Extension) => a.title.localeCompare(b.title)
    const installed = all.filter((e) => e.installed).sort(byTitle)
    const rest = all.filter((e) => !e.installed)
    const trusted = rest.filter((e) => e.tier === 'official' || e.tier === 'verified').sort(byTitle)
    const counts = new Map<string, number>()
    for (const e of rest) counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
    const categories = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
    return { installed, rest: rest.sort(byTitle), trusted, categories }
  }, [list])

  const found = q.trim() ? (list ?? []).filter((e) => matches(e, q)) : null
  const shown = category === 'all' ? groups.rest : groups.rest.filter((e) => e.category === category)
  const row = (e: Extension) => <ExtensionRow key={e.name} ext={e} onOpen={() => open(e.name)} />

  return (
    <>
      <LoadState loading={!list} error={error} retry={() => void reload()} />
      {found ? (
        found.length ? (
          <Section title={`Знайдено ${found.length}`}>
            <Limited key={q} items={found} render={row} />
          </Section>
        ) : (
          <Empty>Нічого не знайшлося. Свій плагін можна покласти в ~/.hermes/plugins — він з’явиться тут.</Empty>
        )
      ) : (
        list && (
          <>
            {groups.installed.length > 0 && <Section title="Встановлені">{groups.installed.map(row)}</Section>}
            {groups.trusted.length > 0 && <Section title="Від Hermes і перевірені">{groups.trusted.map(row)}</Section>}
            <section className="jobs-section">
              <h2>Каталог · {groups.rest.length}</h2>
              <Chips
                options={[{ value: 'all', label: 'Усі' }, ...groups.categories.map((c) => ({ value: c, label: categoryLabel(c) }))]}
                value={category}
                onChange={setCategory}
              />
              <div className="plugin-list">
                <Limited key={category} items={shown} render={row} />
              </div>
            </section>
          </>
        )
      )}
      {id && <ExtensionSheet key={id} name={id} onClose={close} />}
    </>
  )
}

// ---------- Картка розширення ----------

/** Поле налаштування: секрет — пароль (значення Hermes не віддає), решта — за типом. */
function SettingField({ field, value, onChange }: { field: ExtensionSetting; value: unknown; onChange: (v: unknown) => void }) {
  const label = (
    <span className="field-label">
      {field.label || field.key}
      {field.required ? ' *' : ''}
    </span>
  )
  if (field.type === 'boolean')
    return (
      <div className="job-sheet-row">
        <span>
          <b>{field.label || field.key}</b>
          {field.description && <small>{field.description}</small>}
        </span>
        <Switch on={Boolean(value ?? field.value ?? field.default)} label={field.label || field.key} onChange={onChange} />
      </div>
    )
  return (
    <label className="field">
      {label}
      {field.type === 'enum' ? (
        <select value={String(value ?? field.value ?? field.default ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(field.choices ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : field.type === 'json' ? (
        <textarea rows={3} value={String(value ?? JSON.stringify(field.value ?? field.default ?? null))} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          type={field.type === 'secret' ? 'password' : field.type === 'number' ? 'number' : 'text'}
          autoComplete="off"
          placeholder={field.type === 'secret' && field.hasValue ? 'Збережено — введи нове, щоб замінити' : String(field.default ?? '')}
          value={String(value ?? (field.type === 'secret' ? '' : (field.value ?? '')))}
          onChange={(e) => onChange(field.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value)}
        />
      )}
      {field.description && <span className="field-hint">{field.description}</span>}
    </label>
  )
}

function ExtensionSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const [ext, setExt] = useState<Extension | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [consent, setConsent] = useState<string[] | null>(null)
  const [confirm, setConfirm] = useState<'install' | 'remove' | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})

  const load = useCallback(
    () =>
      api
        .extension(name)
        .then(setExt)
        .catch((e: unknown) => setErr(message(e))),
    [name],
  )
  useEffect(() => {
    void load()
  }, [load])

  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind)
    setErr('')
    try {
      await fn()
      await load()
    } catch (e) {
      setErr(message(e))
    } finally {
      setBusy('')
    }
  }
  const report = (r: { restartRequired: boolean; warnings: string[]; missingEnv: string[] }, done: string) =>
    setNotes([
      done,
      ...r.warnings,
      ...(r.missingEnv.length ? [`Потрібно заповнити: ${r.missingEnv.join(', ')}`] : []),
      ...(r.restartRequired ? ['Частина змін запрацює після перезапуску Hermes.'] : []),
    ])

  if (!ext)
    return (
      <Sheet title="Розширення" className="plugin-sheet" onClose={onClose}>
        {err ? <div className="notif-msg">{err}</div> : <LoadState loading error="" retry={() => {}} />}
      </Sheet>
    )

  const install = () =>
    run('install', async () => {
      setConfirm(null)
      report(await api.installExtension(name), `${title(ext)} встановлено.`)
    })
  const toggle = (on: boolean) =>
    run('toggle', async () => report(await api.setExtensionEnabled(name, on), on ? 'Увімкнено.' : 'Вимкнено.'))
  const update = (accept: boolean) =>
    run('update', async () => {
      const r = await api.updateExtension(name, accept)
      if (r.consent) setConsent(r.consent)
      else {
        setConsent(null)
        report(r, 'Оновлено.')
      }
    })
  const remove = () =>
    run('remove', async () => {
      await api.removeExtension(name)
      onClose()
    })
  const save = () =>
    run('save', async () => {
      // Порожні секрети не надсилаємо: це означає «лишити збережене».
      const out = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''))
      setExt(await api.configureExtension(name, out))
      setValues({})
      setNotes(['Налаштування збережено.'])
    })

  const envOnly = ext.requiresEnv.filter((v) => !ext.settings.some((f) => f.env === v))
  const fields: ExtensionSetting[] = [
    ...ext.settings,
    ...envOnly.map((v) => ({ key: v, type: 'secret' as const, label: v, description: 'Змінна в ~/.hermes/.env', required: true, env: v })),
  ]
  const dirty = Object.values(values).some((v) => v !== '')
  const community = ext.tier === 'community'

  return (
    <Sheet title={title(ext)} label={`Розширення ${title(ext)}`} className="plugin-sheet" onClose={onClose}>
      <div className="plugin-head">
        <ImageIcon src={ext.image} name={ext.title} size={64} />
        <div className="plugin-badges">
          {ext.tier && <span className={`plugin-badge ${community ? '' : 'is-trusted'}`}>{TIER[ext.tier]}</span>}
          {!ext.tier && <span className="plugin-badge">Своя папка</span>}
          <span className="plugin-badge">{categoryLabel(ext.category)}</span>
          {ext.maintainer && <span className="plugin-badge">{ext.maintainer}</span>}
          {ext.installed && <span className={`plugin-state ${ext.status === 'enabled' ? 'is-ok' : 'is-off'}`}>{stateText(ext)}</span>}
        </div>
      </div>
      {ext.description && <p className="plugin-desc">{ext.description}</p>}
      {ext.knownIssues.map((k) => (
        <p key={k} className="plugin-warn">
          {k}
        </p>
      ))}
      {ext.docs && (
        <a className="plugin-docs" href={ext.docs} target="_blank" rel="noreferrer">
          <ExternalLink size={15} /> Документація
        </a>
      )}

      {!ext.installed &&
        (confirm === 'install' ? (
          <div className="form-card">
            <p className="plugin-warn">
              Це код від спільноти{ext.maintainer ? ` (${ext.maintainer})` : ''}. Hermes візьме перевірений у каталозі коміт, просканує код і поставить
              залежності, але код виконуватиметься на цьому комп’ютері.
            </p>
            <div className="plugin-actions">
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Скасувати
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void install()}>
                Встановити
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-wide"
            disabled={!!busy}
            onClick={() => (community ? setConfirm('install') : void install())}
          >
            {busy === 'install' ? <Loader2 size={16} className="spin" /> : null}
            {busy === 'install' ? 'Встановлюю… це може тривати кілька хвилин' : 'Встановити'}
          </button>
        ))}

      {ext.installed && (
        <>
          <div className="job-sheet-row">
            <Wrench size={18} />
            <span>
              <b>Hermes користується</b>
              <small>{ext.status === 'enabled' ? 'Працює в розмовах і задачах' : 'Вимкнено: Hermes його не завантажує'}</small>
            </span>
            <Switch on={ext.status === 'enabled'} busy={busy === 'toggle'} disabled={!!busy && busy !== 'toggle'} label="Увімкнено" onChange={(v) => void toggle(v)} />
          </div>
          {ext.category === 'memory' && (
            <p className="field-hint">Розширення пам’яті запрацює, коли обереш його провайдером пам’яті в налаштуваннях Hermes.</p>
          )}
          {ext.servers.map((s) => (
            <p key={s.name} className="field-hint">
              {s.name}: {s.sentence || s.state}
            </p>
          ))}

          {fields.length > 0 && (
            <div className="form-card">
              <span className="field-label">Налаштування</span>
              {fields.map((f) => (
                <SettingField key={f.key} field={f} value={values[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />
              ))}
              <button type="button" className="btn btn-primary" disabled={!dirty || !!busy} onClick={() => void save()}>
                {busy === 'save' ? <Loader2 size={16} className="spin" /> : 'Зберегти'}
              </button>
            </div>
          )}

          {consent ? (
            <div className="form-card">
              <p className="plugin-warn">Нова версія отримає більше можливостей:{'\n' + consent.join('\n')}</p>
              <div className="plugin-actions">
                <button type="button" className="btn" onClick={() => setConsent(null)}>
                  Не оновлювати
                </button>
                <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void update(true)}>
                  Погоджуюсь, оновити
                </button>
              </div>
            </div>
          ) : (
            ext.updateAvailable && (
              <button type="button" className="btn btn-wide" disabled={!!busy} onClick={() => void update(false)}>
                {busy === 'update' ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                Оновити
              </button>
            )
          )}

          {ext.dir &&
            (confirm === 'remove' ? (
              <div className="confirm">
                <span>Видалити {title(ext)}? Тека в ~/.hermes/plugins зникне.</span>
                <div>
                  <button type="button" className="btn" onClick={() => setConfirm(null)}>
                    Скасувати
                  </button>
                  <button type="button" className="btn btn-danger-solid" disabled={busy === 'remove'} onClick={() => void remove()}>
                    {busy === 'remove' ? <Loader2 size={16} className="spin" /> : 'Видалити'}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="job-sheet-delete" onClick={() => setConfirm('remove')}>
                <Trash2 size={16} /> Видалити
              </button>
            ))}
        </>
      )}

      {notes.map((n) => (
        <p key={n} className="plugin-note">
          {n}
        </p>
      ))}
      {err && <div className="notif-msg">{err}</div>}
    </Sheet>
  )
}
