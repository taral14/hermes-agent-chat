import { randomBytes } from 'node:crypto'

/** Короткий випадковий id для чатів, повідомлень, файлів. */
export const newId = () => randomBytes(9).toString('base64url')

/** Будь-яке значення як рядок; null і undefined — порожній. */
export const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
