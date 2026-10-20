// Спільне для вкладок сторінки «Плагіни»: завантаження, порожні стани, секції, рядки.
import { Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

/** Що вкладка отримує від сторінки: пошук, відкритий запис і як його відкрити чи закрити. */
export type TabProps = {
  q: string
  id: string | null
  open: (id: string) => void
  close: () => void
  /** Росте, коли Hermes перепідключив сервери чи змінив плагіни (подія з сервера). */
  version: number
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Дані вкладки: вантажаться на відкриття і знову, коли змінюється version. */
export function useLoad<T>(fetch: () => Promise<T>, version: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(
    () =>
      fetch()
        .then((d) => {
          setData(d)
          setError('')
        })
        .catch((e: unknown) => setError(message(e))),
    [fetch],
  )
  useEffect(() => {
    void reload()
  }, [reload, version])
  return { data, error, reload }
}

/** Крутилка, поки вантажиться, або помилка з «Спробувати ще». */
export function LoadState({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  if (error && loading)
    return (
      <div className="jobs-empty">
        <p>{error}</p>
        <button type="button" className="btn" onClick={retry}>
          <RefreshCw size={16} /> Спробувати ще
        </button>
      </div>
    )
  if (!loading) return null
  return (
    <div className="jobs-loading">
      <Loader2 size={22} className="spin" />
    </div>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="jobs-section">
      <h2>{title}</h2>
      <div className="plugin-list">{children}</div>
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="jobs-empty">
      <p>{children}</p>
    </div>
  )
}

/** Рядок каталогу: іконка, назва, підпис і стан чи «+» праворуч. */
export function Row({ icon, title, sub, right, onOpen }: { icon: ReactNode; title: string; sub: string; right: ReactNode; onOpen: () => void }) {
  return (
    <button type="button" className="plugin-row" onClick={onOpen}>
      {icon}
      <span className="plugin-row-main">
        <span className="plugin-row-name">{title}</span>
        {sub && <span className="plugin-row-sub">{sub}</span>}
      </span>
      {right}
    </button>
  )
}

/** Фільтр категорій: прокручуваний ряд кнопок. */
export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="plugin-chips">
      <div className="seg seg-small">
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={o.value === value} className={o.value === value ? 'is-on' : ''} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Довгий список (сотні записів каталогу) показуємо порціями. Новий список — новий key у батька. */
export function Limited<T>({ items, render, step = 40 }: { items: T[]; render: (item: T) => ReactNode; step?: number }) {
  const [limit, setLimit] = useState(step)
  return (
    <>
      {items.slice(0, limit).map(render)}
      {items.length > limit && (
        <button type="button" className="btn plugin-more" onClick={() => setLimit(limit + step * 2)}>
          Показати ще {Math.min(step * 2, items.length - limit)} з {items.length - limit}
        </button>
      )}
    </>
  )
}

/** Плитка-літера, коли іконки немає; колір — від назви, щоб сусіди відрізнялися. */
export function LetterIcon({ name, size = 44 }: { name: string; size?: number }) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <span
      className="plugin-icon is-letter"
      style={{ width: size, height: size, borderRadius: size * 0.27, fontSize: size * 0.42, color: `hsl(${h} 45% 55%)` }}
      aria-hidden
    >
      {name.replace(/^[^a-zа-яіїє0-9]+/i, '').charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** Картинка з каталогу (https), а якщо не завантажилась — літера. */
export function ImageIcon({ src, name, size = 44 }: { src: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return <LetterIcon name={name} size={size} />
  return (
    <span className="plugin-icon is-image" style={{ width: size, height: size, borderRadius: size * 0.27 }} aria-hidden>
      <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    </span>
  )
}
