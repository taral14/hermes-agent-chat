// Шторка поверх сторінки: знизу на телефоні, по центру на широкому екрані.
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeLayer } from './layers.ts'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

type Props = {
  title: ReactNode
  /** Назва для читачів екрана, якщо title — не простий текст. */
  label?: string
  className?: string
  onClose: () => void
  children: ReactNode
}

/** Escape і тап поза шторкою закривають її; Tab не виходить за її межі; після закриття фокус повертається. */
export function Sheet({ title, label, className = '', onClose, children }: Props) {
  const box = useRef<HTMLDivElement>(null)
  useEscapeLayer(onClose)

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    box.current?.focus({ preventScroll: true })
    return () => back?.focus?.({ preventScroll: true })
  }, [])

  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !box.current) return
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
    if (!items.length) return
    const first = items[0]!
    const last = items[items.length - 1]!
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={box}
        tabIndex={-1}
        className={`sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === 'string' ? title : undefined)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trap}
      >
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn round" onClick={onClose} aria-label="Закрити">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
