// Пошук посилань у тексті й розпізнавання YouTube. Без імпортів: файл читає і сервер (Node), і клієнт (Vite).

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi

/** Прибрати розділові знаки, що прилипли в кінці («див. https://x.com/a.»), але не дужку з Вікіпедії. */
export function trimUrl(raw: string): string {
  let u = raw.replace(/[.,;:!?…»"'\])]+$/, '')
  const rest = raw.slice(u.length)
  if (rest.startsWith(')') && (u.match(/\(/g)?.length ?? 0) > (u.match(/\)/g)?.length ?? 0)) u += ')'
  return u
}

/** Шматки тексту: звичайний текст і посилання, по черзі. */
export function splitLinks(text: string): { text: string; url?: string }[] {
  const out: { text: string; url?: string }[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0])
    const at = m.index ?? 0
    if (at > last) out.push({ text: text.slice(last, at) })
    out.push({ text: url, url })
    last = at + url.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** Унікальні посилання з тексту, не більше max. */
export function findUrls(text: string, max = 3): string[] {
  const out: string[] = []
  for (const p of splitLinks(text)) {
    if (p.url && p.url.length <= 2000 && !out.includes(p.url)) out.push(p.url)
    if (out.length >= max) break
  }
  return out
}

function parseTime(t: string): number {
  if (/^\d+$/.test(t)) return Number(t)
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t)
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0
}

/** youtube.com/watch?v=…, youtu.be/…, /shorts/…, /live/… → id відео, час старту і чи це Shorts. */
export function youtubeId(url: string): { id: string; start?: number; short: boolean } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '')
  let id: string | null = null
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else id = /^\/(?:shorts|live|embed|v)\/([\w-]{11})/.exec(u.pathname)?.[1] ?? null
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null
  const t = u.searchParams.get('t') ?? u.searchParams.get('start')
  const start = t ? parseTime(t) : 0
  return { id, ...(start ? { start } : {}), short: u.pathname.startsWith('/shorts/') }
}

/**
 * Посилання з відповіді Hermes (Markdown): з [тексту](адреси) і голі, без коду.
 * Відео YouTube окремо (до трьох), решта — до max у порядку появи.
 */
export function answerUrls(text: string, max = 10): { videos: string[]; links: string[]; total: number } {
  const noCode = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
  const found: string[] = []
  const add = (u: string) => {
    if (u.length <= 2000 && !found.includes(u)) found.push(u)
  }
  // [текст](https://…) — адреса може мати одну пару дужок (Вікіпедія).
  const rest = noCode.replace(/\[[^\]]*\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/gi, (_m, url: string) => {
    add(url)
    return ' '
  })
  for (const u of findUrls(rest, 50)) add(u)
  const seenVideo = new Set<string>()
  const videos: string[] = []
  const links: string[] = []
  for (const u of found) {
    const yt = youtubeId(u)
    if (yt) {
      if (!seenVideo.has(yt.id) && videos.length < 3) videos.push(u)
      seenVideo.add(yt.id)
    } else links.push(u)
  }
  return { videos, links: links.slice(0, max), total: links.length }
}

/** https://www.example.com/a/b?c → example.com/a/b?c, довгі обрізаємо. */
export function shortUrl(url: string) {
  const s = url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
  return s.length > 64 ? `${s.slice(0, 61)}…` : s
}

/** Посилання з відповіді, які стають картками під нею (як у AnswerLinks): відео і одне-два звичайні. */
export function cardedUrls(text: string): string[] {
  const { videos, links } = answerUrls(text)
  return [...videos, ...(links.length <= 2 ? links : [])]
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)]|>)?\s*$/

/**
 * Голе посилання в кінці рядка, для якого під повідомленням є картка, з тексту прибираємо: картка вже показує
 * і його, і куди воно веде («Ось огляд: https://…» → «Ось огляд:» + картка). Посилання посеред речення,
 * у коді, таблиці чи окремим пунктом списку лишаються.
 */
export function dropCardedUrls(text: string, carded: string[]): string {
  if (!carded.length) return text
  let code = false
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) code = !code
    if (code || line.includes('|') || line.includes('`')) {
      out.push(line)
      continue
    }
    // Знімаємо з кінця рядка посилання з картками одне за одним («А ці дві: https://a https://b»).
    let rest = line
    for (;;) {
      const m = /(^|\s)(https?:\/\/[^\s<>"'`]+)\s*$/.exec(rest)
      if (!m || !carded.includes(trimUrl(m[2]!))) break
      rest = rest.slice(0, m.index).trimEnd()
    }
    if (rest === line) out.push(line)
    else if (!rest) continue
    else out.push(LIST_ITEM.test(rest) ? line : rest)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
