// Адреса сторінки — єдине джерело маршруту: /c/<чат>, /jobs/…, /kb/…. Переходи — лише через navigateTo.
import { useSyncExternalStore } from 'react'
import type { JobsRoute } from './components/Jobs.tsx'
import type { KbRoute } from './components/Kb.tsx'
import { notePath } from './kb.ts'

export type Route = { kind: 'chat'; id: string | null } | { kind: 'jobs'; jobs: JobsRoute } | { kind: 'kb'; kb: KbRoute }

const CHANGE = 'chat:route'

export function parseRoute(pathname: string, search = ''): Route {
  const c = /^\/c\/([\w-]+)/.exec(pathname)
  if (c) return { kind: 'chat', id: c[1]! }
  const j = /^\/jobs(?:\/([\w-]+))?\/?$/.exec(pathname)
  if (j) return { kind: 'jobs', jobs: !j[1] ? { kind: 'list' } : j[1] === 'new' ? { kind: 'new' } : { kind: 'job', id: j[1] } }
  if (pathname === '/kb' || pathname === '/kb/') return { kind: 'kb', kb: { kind: 'home' } }
  if (pathname === '/kb/graph') return { kind: 'kb', kb: { kind: 'graph', focus: new URLSearchParams(search).get('focus') ?? undefined } }
  if (pathname.startsWith('/kb/n/')) return { kind: 'kb', kb: { kind: 'note', path: pathname.slice(6).split('/').map(decodeURIComponent).join('/') } }
  return { kind: 'chat', id: null }
}

export const chatUrl = (id: string | null) => (id ? `/c/${id}` : '/')
export const jobsUrl = (r: JobsRoute) => (r.kind === 'list' ? '/jobs' : r.kind === 'new' ? '/jobs/new' : `/jobs/${r.id}`)
export const kbUrl = (r: KbRoute) =>
  r.kind === 'home' ? '/kb' : r.kind === 'graph' ? `/kb/graph${r.focus ? `?focus=${encodeURIComponent(r.focus)}` : ''}` : notePath(r.path)

/** Перейти на сторінку застосунку без перезавантаження. */
export function navigateTo(url: string, replace = false) {
  if (location.pathname + location.search !== url) history[replace ? 'replaceState' : 'pushState'](null, '', url)
  window.dispatchEvent(new Event(CHANGE))
}

function subscribe(fn: () => void) {
  window.addEventListener('popstate', fn)
  window.addEventListener(CHANGE, fn)
  return () => {
    window.removeEventListener('popstate', fn)
    window.removeEventListener(CHANGE, fn)
  }
}

const snapshot = () => location.pathname + location.search
let cache: { key: string; route: Route } | null = null

/** Поточний маршрут; змінюється на «Назад»/«Вперед» і на navigateTo. */
export function useRoute(): Route {
  const key = useSyncExternalStore(subscribe, snapshot)
  if (cache?.key !== key) cache = { key, route: parseRoute(location.pathname, location.search) }
  return cache.route
}
