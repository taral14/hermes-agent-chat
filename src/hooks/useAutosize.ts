import { type RefObject, useEffect } from 'react'

/** Поле вводу росте за текстом, але не вище max пікселів. */
export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: unknown, max: number) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
  }, [ref, value, max])
}
