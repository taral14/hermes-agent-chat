// Типізовані події між далекими частинами інтерфейсу: посилання у відповіді Hermes відкривають нотатку,
// задачу чи сторінку, а обробляє це App. emit каже, чи хтось обробив подію: на публічній сторінці
// спільного чату обробників немає, і посилання поводяться як звичайні.

type Events = {
  /** Відкрити налаштування задачі за розкладом. */
  job: string
  /** Відкрити нотатку бази знань за шляхом. */
  kbnote: string
  /** Посилання obsidian:// з відповіді. */
  obsidian: string
  /** Перейти на сторінку застосунку (/c/…, /jobs/…, /kb/…). */
  navigate: string
  /** Сесія закінчилась: показати вхід. */
  unauthorized: undefined
  /** Почав грати аудіоплеєр з цим id: інші ставлять на паузу. */
  'audio-play': string
  /** Відкрити файл (PDF, картинку, текст) у переглядачі поверх чату. */
  file: import('./viewer.ts').ViewFile
  /** Прокрутити розмову до повідомлення (чи його вкладення) й підсвітити (з «Ресурсів чату»). */
  reveal: { id: string; att?: string }
}

type Handler<K extends keyof Events> = (detail: Events[K]) => void
const handlers = new Map<keyof Events, Set<(detail: never) => void>>()

export function on<K extends keyof Events>(kind: K, fn: Handler<K>): () => void {
  let set = handlers.get(kind)
  if (!set) handlers.set(kind, (set = new Set()))
  set.add(fn)
  return () => void set.delete(fn)
}

export function emit<K extends keyof Events>(kind: K, ...[detail]: Events[K] extends undefined ? [] : [Events[K]]): boolean {
  const set = handlers.get(kind) as Set<Handler<K>> | undefined
  if (!set?.size) return false
  for (const fn of set) fn(detail as Events[K])
  return true
}
