import { Check, Copy, ExternalLink, Link2, Loader2, RefreshCw, Share, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api.ts'
import { relative } from '../schedule.ts'
import type { Chat, ShareInfo } from '../shared.ts'

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10
  const h = n % 100
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many
}

/** Поділитися чатом: посилання лише для перегляду, знімок до моменту створення чи оновлення. */
export function ShareSheet({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const [info, setInfo] = useState<ShareInfo | null | undefined>(undefined)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    api
      .share(chat.id)
      .then((r) => setInfo(r.share))
      .catch((e: Error) => setMsg(e.message))
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [chat.id, onClose])

  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind)
    setMsg('')
    try {
      await fn()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy('')
    }
  }
  const create = () =>
    run('create', async () => {
      const r = await api.createShare(chat.id)
      setInfo(r.share)
    })
  const copy = async () => {
    if (!info) return
    await navigator.clipboard.writeText(info.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  const nativeShare = typeof navigator.share === 'function'

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet share-sheet" role="dialog" aria-modal="true" aria-label="Поділитися чатом" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>Поділитися чатом</h2>
          <button type="button" className="icon-btn round" onClick={onClose} aria-label="Закрити">
            <X size={20} />
          </button>
        </div>
        <p className="sheet-lead">
          Хто має посилання, побачить цей діалог лише для читання: повідомлення, відповіді Hermes і прикріплені файли. Хід роботи Hermes і великі
          файли, що лежать лише на сервері, не видно.
        </p>

        {info === undefined ? (
          <div className="jobs-loading">
            <Loader2 size={22} className="spin" />
          </div>
        ) : !info ? (
          <button type="button" className="share-create" disabled={!!busy} onClick={() => void create()}>
            {busy === 'create' ? <Loader2 size={18} className="spin" /> : <Link2 size={18} />}
            Створити посилання
          </button>
        ) : (
          <>
            <div className="share-link">
              <span className="share-link-url">{info.url.replace(/^https:\/\//, '')}</span>
              <button type="button" className="btn btn-primary share-copy" onClick={() => void copy()}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Скопійовано' : 'Копіювати'}
              </button>
            </div>
            <div className="share-actions">
              {nativeShare && (
                <button type="button" className="btn" onClick={() => void navigator.share({ title: chat.title || 'Чат з Hermes', url: info.url }).catch(() => {})}>
                  <Share size={16} />
                  Надіслати
                </button>
              )}
              <a className="btn" href={info.url} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
                Відкрити
              </a>
            </div>
            <div className="share-status">
              {info.count} {plural(info.count, 'повідомлення', 'повідомлення', 'повідомлень')} · оновлено {relative(info.updatedAt)}
            </div>
            {info.newer > 0 ? (
              <div className="share-newer">
                <span>
                  Після цього в чаті з'явилось ще {info.newer} {plural(info.newer, 'повідомлення', 'повідомлення', 'повідомлень')}. За посиланням їх не видно.
                </span>
                <button type="button" className="btn" disabled={!!busy} onClick={() => void create()}>
                  {busy === 'create' ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                  Оновити
                </button>
              </div>
            ) : (
              <p className="notif-foot">Нові повідомлення не з'являться за посиланням, доки ти його не оновиш.</p>
            )}
            {confirm ? (
              <div className="share-confirm">
                <span>Посилання перестане працювати для всіх.</span>
                <button
                  type="button"
                  className="btn btn-danger-solid"
                  disabled={!!busy}
                  onClick={() =>
                    void run('delete', async () => {
                      await api.deleteShare(chat.id)
                      setInfo(null)
                      setConfirm(false)
                    })
                  }
                >
                  Видалити
                </button>
                <button type="button" className="icon-btn round" aria-label="Скасувати" onClick={() => setConfirm(false)}>
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button type="button" className="sec-revoke" onClick={() => setConfirm(true)}>
                <Trash2 size={16} />
                Видалити посилання
              </button>
            )}
          </>
        )}
        {msg && <div className="notif-msg">{msg}</div>}
      </div>
    </div>,
    document.body,
  )
}
