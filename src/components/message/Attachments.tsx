// Вкладення повідомлення: картинки, аудіо, відео, файли з посиланнями на завантаження.
import { Download, Link2, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isPublicView, uploadUrl } from '../../api.ts'
import { fileKind, formatSize } from '../../fileKind.ts'
import { request } from '../../http.ts'
import type { Attachment } from '../../shared.ts'
import { AudioPlayer } from '../AudioPlayer.tsx'

/** Файл на сторінці спільного доступу: просте завантаження, а файли, що лишились на сервері, — тільки назва. */
function PublicFileCard({ a }: { a: Attachment }) {
  const kind = fileKind(a.name, a.mime)
  const icon = (
    <span className="att-file-icon" style={{ background: kind.color }}>
      <kind.Icon size={19} />
      {kind.ext && kind.ext.length <= 4 && <span className="att-ext">{kind.ext}</span>}
    </span>
  )
  const text = (
    <span className="att-file-text">
      <span className="att-file-name">{a.name}</span>
      <span className="att-file-meta">
        {kind.label} · {formatSize(a.size)}
        {a.ref && <span className="att-ref"> · доступний лише власнику</span>}
      </span>
    </span>
  )
  if (a.ref || !a.id) {
    return (
      <div className="att-file">
        <span className="att-file-open">
          {icon}
          {text}
        </span>
      </div>
    )
  }
  return (
    <div className="att-file">
      <a href={uploadUrl(a.id)} target="_blank" rel="noreferrer" className="att-file-open" title={a.name}>
        {icon}
        {text}
      </a>
      <a href={`${uploadUrl(a.id)}?download`} download={a.name} className="icon-btn" title="Завантажити" aria-label="Завантажити">
        <Download size={16} />
      </a>
    </div>
  )
}

function FileCard({ a }: { a: Attachment }) {
  if (isPublicView()) return <PublicFileCard a={a} />
  return <PrivateFileCard a={a} />
}

function PrivateFileCard({ a }: { a: Attachment }) {
  const kind = fileKind(a.name, a.mime)
  const [busy, setBusy] = useState<'' | 'dl' | 'copy'>('')
  const [note, setNote] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const flashNote = (t: string) => {
    setNote(t)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setNote(''), 2500)
  }
  /** Тимчасове посилання (1 год) на оригінал: для великих файлів без копіювання. */
  const link = async () => {
    const d = await request<{ url: string }>('POST', `${uploadUrl(a.id)}/link`)
    return new URL(d.url, location.origin).href
  }
  const download = async () => {
    setBusy('dl')
    try {
      const href = await link()
      const el = document.createElement('a')
      el.href = href
      el.download = a.name
      document.body.appendChild(el)
      el.click()
      el.remove()
    } catch (e) {
      flashNote((e as Error).message)
    } finally {
      setBusy('')
    }
  }
  const copy = async () => {
    setBusy('copy')
    try {
      await navigator.clipboard.writeText(await link())
      flashNote('Посилання скопійовано, діє 1 годину')
    } catch (e) {
      flashNote((e as Error).message)
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="att-file">
      <a href={uploadUrl(a.id)} target="_blank" rel="noreferrer" className="att-file-open" title={a.name}>
        <span className="att-file-icon" style={{ background: kind.color }}>
          <kind.Icon size={19} />
          {kind.ext && kind.ext.length <= 4 && <span className="att-ext">{kind.ext}</span>}
        </span>
        <span className="att-file-text">
          <span className="att-file-name">{a.name}</span>
          <span className="att-file-meta">
            {note || (
              <>
                {kind.label} · {formatSize(a.size)}
                {a.ref && <span className="att-ref"> · на сервері</span>}
              </>
            )}
          </span>
        </span>
      </a>
      <button type="button" className="icon-btn" title="Копіювати посилання (1 год)" aria-label="Копіювати посилання" disabled={!!busy} onClick={() => void copy()}>
        {busy === 'copy' ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
      </button>
      <button type="button" className="icon-btn" title="Завантажити" aria-label="Завантажити" disabled={!!busy} onClick={() => void download()}>
        {busy === 'dl' ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
      </button>
    </div>
  )
}

export function Attachments({ items, side }: { items: Attachment[]; side: 'user' | 'assistant' }) {
  if (!items.length) return null
  return (
    <div className={`msg-attachments is-${side}`}>
      {items.map((a, i) =>
        !a.id ? (
          <FileCard key={`${i}:${a.name}`} a={a} />
        ) : a.mime.startsWith('image/') ? (
          <a key={a.id} href={uploadUrl(a.id)} target="_blank" rel="noreferrer" className="att-image">
            <img src={uploadUrl(a.id)} alt={a.name} loading="lazy" />
          </a>
        ) : a.mime.startsWith('audio/') ? (
          <AudioPlayer key={a.id} a={a} />
        ) : /^video\/(mp4|quicktime|webm)$/.test(a.mime) ? (
          <div key={a.id} className="att-media att-video">
            <video controls playsInline preload="metadata" src={uploadUrl(a.id)} />
            <FileCard a={a} />
          </div>
        ) : (
          <FileCard key={a.id} a={a} />
        ),
      )}
    </div>
  )
}
