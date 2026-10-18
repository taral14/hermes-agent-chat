import { Globe, Play } from 'lucide-react'
import { createContext, useContext, useEffect, useState } from 'react'
import { unfurl } from '../api.ts'
import { answerUrls, findUrls, splitLinks, youtubeId } from '../links.ts'
import type { LinkPreview } from '../shared.ts'

/** Звідки брати картки: у чаті — із сервера, на сторінці спільного доступу — з уже готового знімка. */
export const PreviewContext = createContext<(url: string) => Promise<LinkPreview>>(unfurl)

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** https://www.example.com/a/b?c → example.com/a/b?c, довгі обрізаємо. */
function shortUrl(url: string) {
  const s = url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
  return s.length > 64 ? `${s.slice(0, 61)}…` : s
}

/** Текст повідомлення, у якому адреси стають посиланнями. */
export function LinkText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((p, i) =>
        p.url ? (
          <a key={i} href={p.url} target="_blank" rel="noreferrer noopener" className="bubble-link" title={p.url}>
            {shortUrl(p.url)}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

const fmtTime = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

function YouTubeCard({ url, p }: { url: string; p: LinkPreview | null }) {
  const yt = youtubeId(url)!
  const [playing, setPlaying] = useState(false)
  const [thumb, setThumb] = useState(`https://i.ytimg.com/vi/${yt.id}/maxresdefault.jpg`)
  const fallback = `https://i.ytimg.com/vi/${yt.id}/hqdefault.jpg`
  const src = `https://www.youtube-nocookie.com/embed/${yt.id}?autoplay=1&playsinline=1&rel=0${yt.start ? `&start=${yt.start}` : ''}`
  return (
    <div className={`yt-card ${yt.short ? 'is-short' : ''}`}>
      <div className="yt-frame">
        {playing ? (
          <iframe src={src} title={p?.title ?? 'YouTube'} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        ) : (
          <button type="button" className="yt-thumb" aria-label="Відтворити відео" onClick={() => setPlaying(true)}>
            <img
              src={thumb}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              // Якщо великої обкладинки немає, YouTube віддає сіру заглушку 120×90.
              onLoad={(e) => e.currentTarget.naturalWidth <= 120 && thumb !== fallback && setThumb(fallback)}
              onError={() => thumb !== fallback && setThumb(fallback)}
            />
            <span className="yt-play">
              <Play size={22} fill="currentColor" />
            </span>
            {yt.start ? <span className="yt-start">з {fmtTime(yt.start)}</span> : null}
          </button>
        )}
      </div>
      <a className="yt-meta" href={url} target="_blank" rel="noreferrer noopener">
        <span className="yt-title">{p?.title ?? (p ? 'Відео на YouTube' : ' ')}</span>
        <span className="yt-channel">
          <span className="yt-logo" aria-hidden>
            <Play size={8} fill="currentColor" />
          </span>
          {p?.channel ?? 'YouTube'}
        </span>
      </a>
    </div>
  )
}

function LinkCard({ url, p }: { url: string; p: LinkPreview | null }) {
  const [imgOk, setImgOk] = useState(true)
  const [iconOk, setIconOk] = useState(true)
  const host = hostOf(url)
  if (!p || p.failed || !p.title) {
    return (
      <a className={`link-card is-compact ${p ? '' : 'is-loading'}`} href={url} target="_blank" rel="noreferrer noopener">
        <span className="link-card-globe">
          <Globe size={16} />
        </span>
        <span className="link-card-body">
          <span className="link-card-title">{p?.siteName ?? host}</span>
          <span className="link-card-url">{shortUrl(url)}</span>
        </span>
      </a>
    )
  }
  return (
    <a className="link-card" href={url} target="_blank" rel="noreferrer noopener">
      {p.image && imgOk && (
        <span className="link-card-image">
          <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImgOk(false)} />
        </span>
      )}
      <span className="link-card-body">
        <span className="link-card-site">
          {p.icon && iconOk ? <img src={p.icon} alt="" referrerPolicy="no-referrer" onError={() => setIconOk(false)} /> : <Globe size={13} />}
          <span>{p.siteName ?? host}</span>
        </span>
        <span className="link-card-title">{p.title}</span>
        {p.description && <span className="link-card-desc">{p.description}</span>}
      </span>
    </a>
  )
}

function Preview({ url }: { url: string }) {
  const resolve = useContext(PreviewContext)
  const [p, setP] = useState<LinkPreview | null>(null)
  useEffect(() => {
    let alive = true
    void resolve(url).then((x) => alive && setP(x))
    return () => {
      alive = false
    }
  }, [url, resolve])
  return youtubeId(url) ? <YouTubeCard url={url} p={p} /> : <LinkCard url={url} p={p} />
}

/** Картки для посилань з повідомлення (до трьох), під бульбашкою. */
export function LinkPreviews({ text }: { text: string }) {
  const urls = findUrls(text, 3)
  if (!urls.length) return null
  return (
    <div className="link-previews">
      {urls.map((u) => (
        <Preview key={u} url={u} />
      ))}
    </div>
  )
}

/** Джерело у відповіді: значок сайту й домен, назва сторінки — у підказці. */
function SourceChip({ url }: { url: string }) {
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
  return (
    <a className="source-chip" href={url} target="_blank" rel="noreferrer noopener" title={p?.title ? `${p.title}\n${url}` : url}>
      {p?.icon && iconOk ? <img src={p.icon} alt="" referrerPolicy="no-referrer" onError={() => setIconOk(false)} /> : <Globe size={14} />}
      <span>{p?.siteName && p.siteName.length <= 28 ? p.siteName : host}</span>
    </a>
  )
}

/**
 * Посилання з відповіді Hermes: відео — картками з плеєром, одне-два посилання — картками,
 * а три й більше (типово для досліджень) — компактним рядком «Джерела», щоб не захаращувати відповідь.
 */
export function AnswerLinks({ text }: { text: string }) {
  const { videos, links, total } = answerUrls(text)
  if (!videos.length && !links.length) return null
  return (
    <div className="answer-links">
      {videos.map((u) => (
        <Preview key={u} url={u} />
      ))}
      {links.length > 0 && links.length <= 2
        ? links.map((u) => <Preview key={u} url={u} />)
        : links.length > 2 && (
            <div className="sources">
              <span className="sources-label">Джерела · {total}</span>
              <div className="sources-row">
                {links.map((u) => (
                  <SourceChip key={u} url={u} />
                ))}
              </div>
            </div>
          )}
    </div>
  )
}
