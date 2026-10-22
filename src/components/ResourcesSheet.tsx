// Ресурси чату, як «Медіа й файли» в месенджерах: картинки й відео, файли та посилання з усієї розмови.
// Тап по пункту закриває шторку й прокручує розмову до повідомлення; кнопка праворуч відкриває сам ресурс.
import { ArrowUpRight, Eye, Globe, Play } from 'lucide-react'
import { useContext, useEffect, useMemo, useState } from 'react'
import { uploadUrl } from '../api.ts'
import { emit } from '../bus.ts'
import { fileKind, formatSize } from '../fileKind.ts'
import { answerUrls, findUrls, youtubeId } from '../links.ts'
import type { Attachment, LinkPreview, Message } from '../shared.ts'
import { openInViewer, viewKind } from '../viewer.ts'
import { PreviewContext } from './Links.tsx'
import { Sheet } from './ui/Sheet.tsx'

type Tab = 'media' | 'files' | 'links'
type Item = { m: Message; a: Attachment } | { m: Message; url: string }

const isMedia = (a: Attachment) => Boolean(a.id) && /^(image|video)\//.test(a.mime)

/** Ресурси розмови, найновіші зверху. */
export function chatResources(list: Message[]): Record<Tab, Item[]> {
  const out: Record<Tab, Item[]> = { media: [], files: [], links: [] }
  for (const m of [...list].reverse()) {
    for (const a of m.attachments) (isMedia(a) ? out.media : out.files).push({ m, a })
    if (!m.text || m.text.startsWith('/')) continue
    const urls = m.role === 'assistant' ? (({ videos, links }) => [...videos, ...links])(answerUrls(m.text, 100)) : findUrls(m.text, 50)
    for (const url of urls) out.links.push({ m, url })
  }
  return out
}

const dateFmt = new Intl.DateTimeFormat('uk', { day: 'numeric', month: 'short' })
const when = (m: Message) => dateFmt.format(m.createdAt)
const who = (m: Message) => (m.role === 'assistant' ? 'Hermes' : 'Ти')

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function LinkRow({ m, url, onReveal }: { m: Message; url: string; onReveal: () => void }) {
  const resolve = useContext(PreviewContext)
  const [p, setP] = useState<LinkPreview | null>(null)
  const [iconOk, setIconOk] = useState(true)
  useEffect(() => {
    let alive = true
    void resolve(url).then((x) => alive && setP(x))
    return () => {
      alive = false
    }
  }, [url, resolve])
  const host = hostOf(url)
  const yt = youtubeId(url)
  return (
    <li className="res-row">
      <button type="button" className="res-main" onClick={onReveal}>
        <span className={`res-icon res-link-icon ${yt ? 'is-video' : ''}`}>
          {yt ? (
            <img src={`https://i.ytimg.com/vi/${yt.id}/mqdefault.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : p?.icon && iconOk ? (
            <img src={p.icon} alt="" referrerPolicy="no-referrer" onError={() => setIconOk(false)} />
          ) : (
            <Globe size={18} />
          )}
        </span>
        <span className="res-text">
          <span className="res-name">{p?.title || host}</span>
          <span className="res-meta">
            {p?.title ? `${host} · ` : ''}
            {who(m)} · {when(m)}
          </span>
        </span>
      </button>
      <a className="icon-btn" href={url} target="_blank" rel="noreferrer noopener" title="Відкрити посилання" aria-label="Відкрити посилання">
        <ArrowUpRight size={18} />
      </a>
    </li>
  )
}

function FileRow({ m, a, onReveal }: { m: Message; a: Attachment; onReveal: () => void }) {
  const kind = fileKind(a.name, a.mime)
  const canView = Boolean(a.id && viewKind(a.name, a.mime, a.size))
  return (
    <li className="res-row">
      <button type="button" className="res-main" onClick={onReveal}>
        <span className="res-icon att-file-icon" style={{ background: kind.color }}>
          <kind.Icon size={18} />
        </span>
        <span className="res-text">
          <span className="res-name">{a.name}</span>
          <span className="res-meta">
            {formatSize(a.size)} · {who(m)} · {when(m)}
          </span>
        </span>
      </button>
      {canView && (
        <a className="icon-btn" href={uploadUrl(a.id)} target="_blank" rel="noreferrer" title="Переглянути" aria-label="Переглянути" onClick={(e) => openInViewer(e, { url: uploadUrl(a.id), ...a })}>
          <Eye size={18} />
        </a>
      )}
    </li>
  )
}

const LABELS: Record<Tab, string> = { media: 'Медіа', files: 'Файли', links: 'Посилання' }
const EMPTY: Record<Tab, string> = {
  media: 'Картинок і відео в цьому чаті ще немає',
  files: 'Файлів у цьому чаті ще немає',
  links: 'Посилань у цьому чаті ще немає',
}

export function ResourcesSheet({ list, onClose }: { list: Message[]; onClose: () => void }) {
  const res = useMemo(() => chatResources(list), [list])
  const [tab, setTab] = useState<Tab>(() => (['media', 'files', 'links'] as const).find((t) => res[t].length) ?? 'media')
  const reveal = (m: Message, att?: string) => {
    onClose()
    // Після закриття шторки: інакше фокус, що повертається на кнопку, смикає прокрутку.
    setTimeout(() => emit('reveal', { id: m.id, att }), 60)
  }
  const items = res[tab]
  return (
    <Sheet title="Ресурси чату" className="res-sheet" onClose={onClose}>
      <div className="seg seg-wide res-tabs" role="tablist">
        {(['media', 'files', 'links'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === tab} className={t === tab ? 'is-on' : ''} onClick={() => setTab(t)}>
            {LABELS[t]}
            {res[t].length > 0 && <span className="res-count">{res[t].length}</span>}
          </button>
        ))}
      </div>
      {!items.length ? (
        <p className="res-empty">{EMPTY[tab]}</p>
      ) : tab === 'media' ? (
        <div className="res-grid">
          {items.map((it) =>
            'a' in it ? (
              <button key={it.a.id} type="button" className="res-tile" onClick={() => reveal(it.m, it.a.id)} title={`${it.a.name} · ${who(it.m)} · ${when(it.m)}`}>
                {it.a.mime.startsWith('image/') ? (
                  <img src={uploadUrl(it.a.id)} alt={it.a.name} loading="lazy" />
                ) : (
                  <>
                    <video src={`${uploadUrl(it.a.id)}#t=0.1`} preload="metadata" muted playsInline />
                    <span className="res-play">
                      <Play size={16} fill="currentColor" />
                    </span>
                  </>
                )}
              </button>
            ) : null,
          )}
        </div>
      ) : (
        <ul className="res-list">
          {items.map((it, i) =>
            'a' in it ? (
              <FileRow key={`${it.m.id}:${i}`} m={it.m} a={it.a} onReveal={() => reveal(it.m, it.a.id || undefined)} />
            ) : (
              <LinkRow key={`${it.m.id}:${it.url}`} m={it.m} url={it.url} onReveal={() => reveal(it.m)} />
            ),
          )}
        </ul>
      )}
    </Sheet>
  )
}
