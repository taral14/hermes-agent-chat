import { Check, ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ModelChoice, ModelOptions } from '../shared.ts'

/** Рівні зусилля, як у Claude Code: що вище, то довше Hermes думає перед відповіддю. */
export const EFFORTS: { id: string; label: string; hint: string }[] = [
  { id: 'low', label: 'Низьке', hint: 'Швидкі відповіді, мінімум роздумів' },
  { id: 'medium', label: 'Середнє', hint: 'Баланс швидкості й якості' },
  { id: 'high', label: 'Високе', hint: 'Довше думає над складними задачами' },
  { id: 'xhigh', label: 'Дуже високе', hint: 'Глибокий аналіз, помітно повільніше' },
  { id: 'max', label: 'Максимальне', hint: 'Найретельніше, для найскладнішого' },
]
const effortLabel = (id?: string) => EFFORTS.find((e) => e.id === id)?.label ?? id ?? ''

/** gpt-6.1-sol → GPT-6.1 Sol, claude-opus-5-5 → Claude Opus 5.5, moonshotai/Kimi-K2.5 → Kimi-K2.5. */
export function prettyModel(id: string): string {
  if (!id) return ''
  const base = id.split('/').pop()!.replace(/-(\d+k|1m)$/i, '')
  if (/[A-Z]/.test(base)) return base
  const parts = base.split('-')
  const out: string[] = []
  for (const p of parts) {
    const prev = out[out.length - 1]
    if (/^\d+$/.test(p) && prev && /\d$/.test(prev) && !/^\d{6,}$/.test(p)) out[out.length - 1] = `${prev}.${p}`
    else if (/^\d{8}$/.test(p)) continue // дата збірки
    else out.push(p === 'gpt' ? 'GPT' : p.replace(/^\w/, (c) => c.toUpperCase()))
  }
  return out.join(' ').replace(/^GPT (\d)/, 'GPT-$1')
}

const contextHint = (id: string) => (/-(\d+k|1m)$/i.exec(id)?.[1] ?? '').toUpperCase()

type Props = { value: ModelChoice; options: ModelOptions | null; onChange: (v: ModelChoice) => void; narrow: boolean }

export function ModelPicker({ value, options, onChange, narrow }: Props) {
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || narrow) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open, narrow])
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open])

  const current = options?.current
  const model = value?.model || current?.model || ''
  const provider = value?.model ? value.provider : current?.provider ?? ''
  const effort = value?.effort
  const supportsEffort = options?.providers.find((p) => p.slug === provider)?.reasoning[model] ?? true

  /** Популярні: моделі поточного провайдера без варіантів з розширеним контекстом. */
  const featured = useMemo(() => {
    const p = options?.providers.find((x) => x.slug === current?.provider)
    return (p?.models ?? []).filter((m) => !contextHint(m)).slice(0, 5)
  }, [options, current?.provider])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (options?.providers ?? [])
      .map((p) => ({ ...p, models: p.models.filter((m) => !q || m.toLowerCase().includes(q) || prettyModel(m).toLowerCase().includes(q)) }))
      .filter((p) => p.models.length)
  }, [options, query])

  const pickModel = (prov: string, m: string) => {
    const isDefault = prov === current?.provider && m === current?.model
    const next = isDefault ? { provider: '', model: '', ...(effort ? { effort } : {}) } : { provider: prov, model: m, ...(effort ? { effort } : {}) }
    onChange(next.model || next.effort ? next : null)
    setOpen(false)
    setMore(false)
  }
  const pickEffort = (e?: string) => {
    const next = { provider: value?.provider ?? '', model: value?.model ?? '', ...(e ? { effort: e } : {}) }
    onChange(next.model || next.effort ? next : null)
  }
  const isSelected = (prov: string, m: string) =>
    value?.model ? value.provider === prov && value.model === m : prov === current?.provider && m === current?.model

  const row = (prov: string, m: string, sub?: string) => (
    <button key={`${prov}/${m}`} type="button" className="mp-row" onClick={() => pickModel(prov, m)}>
      <span className="mp-row-main">
        <span className="mp-row-title">
          {prettyModel(m)}
          {contextHint(m) && <span className="mp-badge">{contextHint(m)}</span>}
        </span>
        {sub && <span className="mp-row-sub">{sub}</span>}
      </span>
      {isSelected(prov, m) && <Check size={18} />}
    </button>
  )

  const effortIdx = EFFORTS.findIndex((e) => e.id === (effort ?? options?.defaultEffort))
  const menu = (
    <div className={`mp-menu ${narrow ? 'is-sheet' : ''}`} onClick={(e) => e.stopPropagation()}>
      {narrow && <div className="sheet-grip" />}
      {!more ? (
        <>
          <div className="mp-label">Модель</div>
          {featured.map((m, i) => row(current!.provider, m, i === 0 ? 'Модель Hermes за замовчуванням' : undefined))}
          {value?.model && !featured.includes(value.model) && row(value.provider, value.model, options?.providers.find((p) => p.slug === value.provider)?.name)}
          <button type="button" className="mp-row mp-more" onClick={() => setMore(true)}>
            <span className="mp-row-main">
              <span className="mp-row-title">Інші моделі</span>
            </span>
            <ChevronRight size={18} />
          </button>
          {supportsEffort && (
            <div className="mp-effort">
              <div className="mp-effort-head">
                <span className="mp-label">Зусилля</span>
                <button type="button" className={`mp-auto ${!effort ? 'is-on' : ''}`} onClick={() => pickEffort(undefined)}>
                  Авто{options ? ` · ${effortLabel(options.defaultEffort)}` : ''}
                </button>
              </div>
              <div className="mp-track" role="radiogroup" aria-label="Зусилля">
                <span className="mp-track-line" />
                <span className="mp-track-fill" style={{ width: `${(Math.max(0, effortIdx) / (EFFORTS.length - 1)) * 100}%` }} />
                {EFFORTS.map((e, i) => (
                  <button
                    key={e.id}
                    type="button"
                    role="radio"
                    aria-checked={effort === e.id}
                    aria-label={e.label}
                    className={`mp-dot ${i <= effortIdx ? 'is-filled' : ''} ${i === effortIdx ? 'is-current' : ''} ${!effort ? 'is-auto' : ''}`}
                    style={{ left: `${(i / (EFFORTS.length - 1)) * 100}%` }}
                    onClick={() => pickEffort(e.id)}
                  />
                ))}
              </div>
              <div className="mp-effort-label">
                <b>{effortLabel(effort ?? options?.defaultEffort)}</b>
                {!effort && ' (налаштування Hermes)'} — {EFFORTS[Math.max(0, effortIdx)]?.hint}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mp-more-head">
            <button type="button" className="icon-btn round" aria-label="Назад" onClick={() => (setMore(false), setQuery(''))}>
              <ChevronRight size={18} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <div className="mp-search">
              <Search size={15} />
              <input autoFocus={!narrow} placeholder="Пошук моделі" value={query} onChange={(e) => setQuery(e.target.value)} />
              {query && (
                <button type="button" className="icon-btn" aria-label="Очистити" onClick={() => setQuery('')}>
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="mp-scroll">
            {!options && <div className="menu-note">Завантажую список…</div>}
            {groups.map((p) => (
              <div key={p.slug}>
                <div className="mp-label">{p.name}</div>
                {p.models.slice(0, query ? 200 : 40).map((m) => row(p.slug, m))}
              </div>
            ))}
            {options && !groups.length && <div className="menu-note">Нічого не знайдено</div>}
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="mp" ref={box}>
      <button type="button" className={`mp-btn ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)} title="Модель і зусилля" aria-haspopup="true" aria-expanded={open}>
        <span className="mp-btn-model">{prettyModel(model) || 'Модель'}</span>
        {effort && <span className="mp-btn-effort">{effortLabel(effort)}</span>}
        <ChevronDown size={14} />
      </button>
      {open &&
        (narrow
          ? createPortal(
              <div className="sheet-backdrop" onClick={() => (setOpen(false), setMore(false))}>
                {menu}
              </div>,
              document.body,
            )
          : menu)}
    </div>
  )
}
