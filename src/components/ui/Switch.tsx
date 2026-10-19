/** Перемикач (як в iOS). У рядку з <label> назву дає сам рядок; окремо — передай label. */
export function Switch({ on, busy, disabled, onChange, label }: { on: boolean; busy?: boolean; disabled?: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      className={`switch ${on ? 'is-on' : ''} ${busy ? 'is-busy' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        if (!busy) onChange(!on)
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="switch-knob" />
    </button>
  )
}
