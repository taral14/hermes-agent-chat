import { Loader2, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api.ts'
import { pluginTitle } from '../../plugins.ts'
import { plural } from '../../schedule.ts'
import type { Skill } from '../../shared.ts'
import { Markdown } from '../Markdown.tsx'
import { Sheet } from '../ui/Sheet.tsx'
import { Switch } from '../ui/Switch.tsx'
import { Chips, Empty, LetterIcon, Limited, LoadState, Row, Section, type TabProps, message, useLoad } from './ui.tsx'

const PROVENANCE: Record<NonNullable<Skill['provenance']>, string> = {
  bundled: 'Разом із Hermes',
  hub: 'З каталогу',
  agent: 'Своя',
  external: 'З іншої папки',
}
const TRUST: Record<NonNullable<Skill['trust']>, string> = { builtin: 'Від Hermes', trusted: 'Перевірене джерело', community: 'Спільнота' }

/** «autonomous-ai-agents» → «Autonomous ai agents». */
const categoryLabel = (c: string) => (c ? c.charAt(0).toUpperCase() + c.slice(1).replace(/[-_]+/g, ' ') : 'Інше')

const matches = (s: Skill, q: string) => {
  const t = q.trim().toLowerCase()
  return !t || [s.name, s.description, s.category].some((x) => x.toLowerCase().includes(t))
}

/** Звідки навичка: для чужих джерел ще й назва джерела — однакові назви з різних каталогів трапляються часто. */
const subtitle = (s: Skill) => {
  const from = s.provenance ? PROVENANCE[s.provenance] : s.trust ? TRUST[s.trust] : ''
  const where = !s.installed && s.source && s.source !== 'official' ? s.source : ''
  return [from, where, s.description].filter(Boolean).join(' · ')
}

function SkillRow({ skill, onOpen }: { skill: Skill; onOpen: () => void }) {
  return (
    <Row
      icon={<LetterIcon name={skill.name} />}
      title={pluginTitle(skill.name)}
      sub={subtitle(skill)}
      right={skill.installed ? <span className={`plugin-state ${skill.enabled ? 'is-ok' : 'is-off'}`}>{skill.enabled ? 'Увімкнено' : 'Вимкнено'}</span> : null}
      onOpen={onOpen}
    />
  )
}

/** Пошук в інших джерелах — мережа, до пів хвилини: чекаємо, поки людина допише. */
function useRemoteSearch(q: string) {
  const [state, setState] = useState<{ q: string; results: Skill[] | null; error: string }>({ q: '', results: null, error: '' })
  useEffect(() => {
    const term = q.trim()
    if (term.length < 3) return
    let alive = true
    const t = setTimeout(() => {
      setState({ q: term, results: null, error: '' })
      api
        .searchSkills(term)
        .then((r) => alive && setState({ q: term, results: r.results, error: '' }))
        .catch((e: unknown) => alive && setState({ q: term, results: [], error: message(e) }))
    }, 800)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q])
  return state.q === q.trim() ? state : null
}

/** Вкладка «Навички»: встановлені скіли, офіційний каталог Hermes і пошук в інших джерелах. */
export function SkillsTab({ q, id, open, close, version }: TabProps) {
  const { data: list, error, reload } = useLoad(api.skills, version)
  const [category, setCategory] = useState('all')
  const remote = useRemoteSearch(q)

  const groups = useMemo(() => {
    const all = list ?? []
    const installed = all.filter((s) => s.installed).sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name))
    const catalog = all.filter((s) => !s.installed).sort((a, b) => a.name.localeCompare(b.name))
    const counts = new Map<string, number>()
    for (const s of catalog) counts.set(s.category, (counts.get(s.category) ?? 0) + 1)
    return { installed, catalog, categories: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c) }
  }, [list])

  const found = q.trim() ? (list ?? []).filter((s) => matches(s, q)) : null
  // Зовнішні результати без тих, що вже є в списку (офіційний каталог).
  const known = new Set((list ?? []).map((s) => s.id))
  const elsewhere = remote?.results?.filter((s) => !known.has(s.id)) ?? []
  const shown = category === 'all' ? groups.catalog : groups.catalog.filter((s) => s.category === category)
  const current = id ? ((list ?? []).find((s) => s.id === id) ?? remote?.results?.find((s) => s.id === id) ?? null) : null
  const row = (s: Skill) => <SkillRow key={s.id} skill={s} onOpen={() => open(s.id)} />

  return (
    <>
      <LoadState loading={!list} error={error} retry={() => void reload()} />
      {found ? (
        <>
          {found.length > 0 && (
            <Section title={`Знайдено ${found.length}`}>
              <Limited key={q} items={found} render={row} />
            </Section>
          )}
          {q.trim().length >= 3 && (
            <section className="jobs-section">
              <h2>В інших джерелах</h2>
              <div className="plugin-list">
                {!remote || !remote.results ? (
                  <div className="jobs-loading">
                    <Loader2 size={20} className="spin" />
                  </div>
                ) : remote.error ? (
                  <p className="field-hint">{remote.error}</p>
                ) : elsewhere.length ? (
                  elsewhere.map(row)
                ) : (
                  <p className="field-hint">Більше ніде не знайшлося.</p>
                )}
              </div>
            </section>
          )}
          {!found.length && q.trim().length < 3 && <Empty>Нічого не знайшлося.</Empty>}
        </>
      ) : (
        list && (
          <>
            {groups.installed.length > 0 && (
              <Section title={`Встановлені · ${groups.installed.length}`}>
                <Limited items={groups.installed} render={row} step={20} />
              </Section>
            )}
            <section className="jobs-section">
              <h2>Каталог Hermes · {groups.catalog.length}</h2>
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
      {current && <SkillSheet key={current.id} skill={current} onClose={close} />}
    </>
  )
}

// ---------- Картка навички ----------

function SkillSheet({ skill: s, onClose }: { skill: Skill; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState<'install' | 'remove' | null>(null)
  // Після дій картка показує новий стан ще до того, як список перечитається.
  const [state, setState] = useState({ installed: s.installed, enabled: s.enabled })

  const loadText = useCallback(
    (installed: boolean) =>
      api
        .skillText(installed ? s.name : s.id, installed)
        .then((r) => setText(r.text))
        .catch(() => setText('')),
    [s.id, s.name],
  )
  useEffect(() => {
    void loadText(s.installed)
  }, [loadText, s.installed])

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
  const install = () =>
    run('install', async () => {
      setConfirm(null)
      await api.installSkill(s.id)
      setState({ installed: true, enabled: true })
      setNote('Встановлено. Hermes побачить навичку з наступної відповіді.')
    })
  const toggle = (on: boolean) =>
    run('toggle', async () => {
      await api.setSkillEnabled(s.name, on)
      setState({ ...state, enabled: on })
    })
  const remove = () =>
    run('remove', async () => {
      await api.uninstallSkill(s.name)
      onClose()
    })

  const community = s.trust === 'community'
  return (
    <Sheet title={pluginTitle(s.name)} label={`Навичка ${s.name}`} className="plugin-sheet" onClose={onClose}>
      <div className="plugin-badges">
        {s.provenance && <span className="plugin-badge">{PROVENANCE[s.provenance]}</span>}
        {s.trust && <span className={`plugin-badge ${community ? '' : 'is-trusted'}`}>{TRUST[s.trust]}</span>}
        {s.category && <span className="plugin-badge">{categoryLabel(s.category)}</span>}
        {s.usage > 0 && <span className="plugin-badge">Використана {s.usage} {plural(s.usage, 'раз', 'рази', 'разів')}</span>}
      </div>
      {s.description && <p className="plugin-desc">{s.description}</p>}

      {!state.installed &&
        (confirm === 'install' ? (
          <div className="form-card">
            <p className="plugin-warn">
              Навичка від спільноти. Hermes просканує її перед встановленням і не поставить, якщо знайде небезпечне, але інструкції в ній писали не автори
              Hermes.
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
          <button type="button" className="btn btn-primary btn-wide" disabled={!!busy} onClick={() => (community ? setConfirm('install') : void install())}>
            {busy === 'install' ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            Встановити
          </button>
        ))}

      {state.installed && (
        <div className="job-sheet-row">
          <Sparkles size={18} />
          <span>
            <b>Hermes користується</b>
            <small>{state.enabled ? 'Hermes бачить навичку й бере її, коли вона доречна' : 'Вимкнено: Hermes її не бачить'}</small>
          </span>
          <Switch on={state.enabled} busy={busy === 'toggle'} disabled={!!busy && busy !== 'toggle'} label="Увімкнено" onChange={(v) => void toggle(v)} />
        </div>
      )}

      {text === null ? (
        <LoadState loading error="" retry={() => {}} />
      ) : (
        text && (
          <div className="form-card plugin-text">
            <Markdown text={text} />
          </div>
        )
      )}

      {state.installed &&
        s.provenance === 'hub' &&
        (confirm === 'remove' ? (
          <div className="confirm">
            <span>Видалити навичку «{pluginTitle(s.name)}»?</span>
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
      {state.installed && s.provenance === 'bundled' && <p className="field-hint">Ця навичка йде разом із Hermes: її можна вимкнути, але не видалити.</p>}

      {note && <p className="plugin-note">{note}</p>}
      {err && <div className="notif-msg">{err}</div>}
    </Sheet>
  )
}
