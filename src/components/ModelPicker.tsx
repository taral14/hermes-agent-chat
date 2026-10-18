import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ModelChoice, ModelOptions } from '../shared.ts'

const EFFORTS: [string | undefined, string][] = [
  [undefined, 'Авто'],
  ['low', 'Швидко'],
  ['medium', 'Середньо'],
  ['high', 'Глибоко'],
]

type Props = { value: ModelChoice; options: ModelOptions | null; onChange: (v: ModelChoice) => void; disabled?: boolean }

export function ModelPicker({ value, options, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const current = options?.current
  const model = value?.model ?? current?.model ?? ''
  const provider = value?.provider ?? current?.provider ?? ''
  const effort = value?.effort
  const supportsEffort = options?.providers.find((p) => p.slug === provider)?.reasoning[model] ?? true

  const pick = (prov: string, m: string, eff = effort) => {
    const isDefault = prov === current?.provider && m === current?.model && !eff
    onChange(isDefault ? null : { provider: prov, model: m, ...(eff ? { effort: eff } : {}) })
  }

  return (
    <div className="model-picker" ref={box}>
      <button type="button" className="model-btn" onClick={() => setOpen((o) => !o)} disabled={disabled}>
        <span className="model-name">Hermes</span>
        <span className="model-sub">
          {model}
          {effort ? ` · ${EFFORTS.find((e) => e[0] === effort)?.[1]}` : ''}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="menu model-menu">
          <div className="menu-label">Модель, якою думає Hermes</div>
          {current && (
            <button type="button" className="menu-item" onClick={() => (onChange(null), setOpen(false))}>
              <span className="menu-item-main">
                За замовчуванням
                <span className="menu-item-sub">{current.model} · налаштування Hermes</span>
              </span>
              {!value && <Check size={16} />}
            </button>
          )}
          {supportsEffort && (
            <div className="effort-row">
              {EFFORTS.map(([e, label]) => (
                <button key={label} type="button" className={`effort ${effort === e ? 'is-on' : ''}`} onClick={() => pick(provider, model, e)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="model-scroll">
            {!options && <div className="menu-note">Завантажую список…</div>}
            {options?.providers.map((p) => (
              <div key={p.slug} className="model-group">
                <div className="menu-label">{p.name}</div>
                {p.models.map((m) => (
                  <button key={m} type="button" className="menu-item" onClick={() => (pick(p.slug, m), setOpen(false))}>
                    <span className="menu-item-main">{m}</span>
                    {value && value.provider === p.slug && value.model === m && <Check size={16} />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
