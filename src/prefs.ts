// Налаштування цього пристрою: тема, розмір тексту, Enter, хід роботи, підписи під відповідями.
// Лежать у localStorage: на телефоні й на Mac можна мати різні. Першу тему ставить public/theme.js.
import { useSyncExternalStore } from 'react'

export type Theme = 'system' | 'light' | 'dark'

export type DevicePrefs = {
  theme: Theme
  /** Індекс у TEXT_SIZES. */
  textSize: number
  /** Enter надсилає (на комп'ютері). Вимкнено — надсилає ⌘/Ctrl+Enter. */
  enterSends: boolean
  /** Хід роботи Hermes розгорнутий і після завершення. */
  expandActivity: boolean
  /** Модель і токени під відповідями. */
  showMeta: boolean
}

export const TEXT_SIZES = [
  { scale: 0.9375, label: 'Менший' },
  { scale: 1, label: 'Звичайний' },
  { scale: 1.0625, label: 'Більший' },
  { scale: 1.125, label: 'Великий' },
  { scale: 1.1875, label: 'Найбільший' },
]

const KEY = 'chat:prefs'
const DEFAULTS: DevicePrefs = { theme: 'system', textSize: 1, enterSends: true, expandActivity: false, showMeta: true }

function load(): DevicePrefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DevicePrefs>) }
  } catch {
    return DEFAULTS
  }
}

let current = load()
const listeners = new Set<() => void>()
const mq = window.matchMedia('(prefers-color-scheme: dark)')

export const getPrefs = () => current

export function isDark(p: DevicePrefs = current) {
  return p.theme === 'dark' || (p.theme === 'system' && mq.matches)
}

/** Застосувати тему й розмір тексту до сторінки. */
function apply() {
  const dark = isDark()
  const root = document.documentElement
  root.dataset.scheme = dark ? 'dark' : 'light'
  root.style.setProperty('--text-scale', String(TEXT_SIZES[current.textSize]?.scale ?? 1))
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#212121' : '#ffffff')
  window.dispatchEvent(new Event('chat:scheme'))
}

export function setPrefs(patch: Partial<DevicePrefs>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* приватний режим: діє до перезавантаження */
  }
  apply()
  for (const l of listeners) l()
}

mq.addEventListener('change', () => {
  if (current.theme !== 'system') return
  apply()
  for (const l of listeners) l()
})

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const usePrefs = () => useSyncExternalStore(subscribe, getPrefs)
