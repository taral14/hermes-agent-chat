// Шари поверх сторінки (шторки, налаштування): Escape закриває лише верхній.
import { useEffect, useRef } from 'react'

const stack: object[] = []

/** Зареєструвати шар: поки він верхній, Escape викликає onEscape. */
export function useEscapeLayer(onEscape: () => void) {
  const fn = useRef(onEscape)
  fn.current = onEscape
  useEffect(() => {
    const me = {}
    stack.push(me)
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== me) return
      e.preventDefault()
      fn.current()
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      stack.splice(stack.indexOf(me), 1)
    }
  }, [])
}
