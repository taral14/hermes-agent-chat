import { MessageSquareQuote } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * «Запитати Hermes» біля виділеного тексту у відповіді: цитата йде в поле вводу, далі дописуєш питання.
 * На телефоні біля виділення системне меню, тому там кнопка стоїть над полем вводу.
 */
export function SelectionAsk({ onAsk }: { onAsk: (text: string) => void }) {
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null)
  const picked = useRef('')

  useEffect(() => {
    let timer = 0
    const update = () => {
      const sel = document.getSelection()
      const text = sel && !sel.isCollapsed ? sel.toString().trim() : ''
      if (!sel || !text || !sel.rangeCount) return setPos(null)
      const range = sel.getRangeAt(0)
      const node = range.commonAncestorContainer
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
      if (!el?.closest('.msg-assistant .answer')) return setPos(null)
      const r = range.getBoundingClientRect()
      if (!r.width && !r.height) return setPos(null)
      picked.current = text.slice(0, 2000)
      if (matchMedia('(pointer: coarse)').matches) {
        // На телефоні біля виділення стоїть системне меню (то над ним, то під ним), тому кнопка
        // чекає над полем вводу: там вона його не перекриває.
        const c = document.querySelector('.composer')?.getBoundingClientRect()
        return setPos({ x: c ? c.left + c.width / 2 : window.innerWidth / 2, y: (c ? c.top : window.innerHeight - 90) - 12, below: false })
      }
      const below = r.top < 80
      setPos({
        x: Math.min(Math.max(r.left + r.width / 2, 90), window.innerWidth - 90),
        y: below ? Math.min(r.bottom + 12, window.innerHeight - 60) : r.top - 10,
        below,
      })
    }
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(update, 150)
    }
    document.addEventListener('selectionchange', schedule)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('selectionchange', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [])

  if (!pos) return null
  return createPortal(
    <button
      type="button"
      className={`sel-ask ${pos.below ? 'is-below' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      // Не знімати виділення натисканням, поки не взяли текст.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onAsk(picked.current)
        document.getSelection()?.removeAllRanges()
        setPos(null)
      }}
    >
      <MessageSquareQuote size={16} />
      Запитати Hermes
    </button>,
    document.body,
  )
}
