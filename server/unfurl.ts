// Картки посилань: сервер сам читає сторінку і бере з неї заголовок, опис і картинку (Open Graph).
// YouTube — через офіційний oEmbed. Результат кешується в базі.
//
// Безпека: сервер ходить у мережу від імені Mac mini, тож будь-яка адреса з повідомлення не має дістатись
// до роутера, інших служб чи пристроїв у локальній мережі (SSRF). Приватні адреси відсікаються на рівні
// DNS у момент з'єднання, тому підміна DNS між перевіркою і запитом теж не спрацює.
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { type IncomingMessage, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { youtubeId } from '../src/links.ts'
import type { LinkPreview } from '../src/shared.ts'
import { getLinkPreview, saveLinkPreview } from './db.ts'

const PRIVATE = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const)
  PRIVATE.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [
  ['::', 127],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
] as const)
  PRIVATE.addSubnet(net, bits, 'ipv6')

export function isPrivate(addr: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr)
  if (mapped) return PRIVATE.check(mapped[1]!, 'ipv4')
  const fam = isIP(addr)
  if (!fam) return true
  return PRIVATE.check(addr, fam === 4 ? 'ipv4' : 'ipv6')
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/** DNS, що не віддає приватних адрес: якщо хоч одна відповідь приватна, з'єднання не буде. */
function safeLookup(hostname: string, options: { all?: boolean; family?: number }, cb: LookupCb) {
  dnsLookup(hostname, { family: options.family ?? 0, all: true }, (err, addrs) => {
    if (err) return cb(err, '')
    if (!addrs.length || addrs.some((a) => isPrivate(a.address))) {
      return cb(Object.assign(new Error('Адреса в приватній мережі'), { code: 'EBLOCKED' }), '')
    }
    if (options.all) cb(null, addrs)
    else cb(null, addrs[0]!.address, addrs[0]!.family)
  })
}

const UA = 'Mozilla/5.0 (compatible; HermesChat/1.0; +https://chat.example.com) facebookexternalhit/1.1'

/** GET з обмеженнями: лише http(s), без приватних адрес, до 4 перенаправлень, до maxBytes, 8 с на все. */
async function fetchLimited(url: string, accept: string, maxBytes: number, stopAt?: string, hops = 0): Promise<{ url: string; type: string; body: Buffer }> {
  const u = new URL(url)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Непідтримуваний протокол')
  if (u.username || u.password) throw new Error('Облікові дані в адресі')
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) throw new Error('Нестандартний порт')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && isPrivate(host)) throw new Error('Адреса в приватній мережі')
  const res = await new Promise<IncomingMessage>((resolve, reject) => {
    const r = (u.protocol === 'https:' ? httpsRequest : httpRequest)(
      u,
      {
        method: 'GET',
        lookup: safeLookup as never,
        timeout: 6000,
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'uk,en;q=0.8', 'Accept-Encoding': 'gzip, deflate, br' },
      },
      resolve,
    )
    r.on('timeout', () => r.destroy(new Error('Час вийшов')))
    r.on('error', reject)
    r.end()
  })
  const status = res.statusCode ?? 0
  if (status >= 300 && status < 400 && res.headers.location) {
    res.resume()
    if (hops >= 4) throw new Error('Забагато перенаправлень')
    return fetchLimited(new URL(res.headers.location, u).href, accept, maxBytes, stopAt, hops + 1)
  }
  if (status >= 400) {
    res.resume()
    throw new Error(`HTTP ${status}`)
  }
  const enc = String(res.headers['content-encoding'] ?? '').toLowerCase()
  const stream = enc === 'gzip' ? res.pipe(createGunzip()) : enc === 'br' ? res.pipe(createBrotliDecompress()) : enc === 'deflate' ? res.pipe(createInflate()) : res
  stream.on('error', () => {})
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const c of stream) {
      const chunk = c as Buffer
      chunks.push(chunk)
      size += chunk.length
      if (size >= maxBytes) break
      if (stopAt && chunk.includes(stopAt)) break
    }
  } catch {
    /* обрив посеред тіла: беремо, що встигли */
  } finally {
    res.destroy()
  }
  return { url: u.href, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks).subarray(0, maxBytes) }
}

// ---------- Розбір HTML ----------

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', laquo: '«', raquo: '»',
  hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', bdquo: '„', middot: '·', copy: '©', reg: '®', trade: '™',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all
    }
    return NAMED[e.toLowerCase()] ?? all
  })
}

const clean = (s: string | undefined, max: number) => {
  const t = decodeEntities(String(s ?? '')).replace(/\s+/g, ' ').trim()
  return t ? (t.length > max ? `${t.slice(0, max - 1)}…` : t) : undefined
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return out
}

function decode(body: Buffer, type: string): string {
  let cs = /charset=["']?([\w-]+)/i.exec(type)?.[1]
  if (!cs) cs = /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 4096).toString('latin1'))?.[1]
  try {
    return new TextDecoder(cs || 'utf-8').decode(body)
  } catch {
    return body.toString('utf8')
  }
}

/** Лише https: сторінка чату не вантажить змішаний вміст, а CSP пускає картинки тільки з https. */
function httpsUrl(raw: string | undefined, base: string): string | undefined {
  if (!raw) return undefined
  try {
    const u = new URL(decodeEntities(raw.trim()), base)
    if (u.protocol === 'http:') u.protocol = 'https:'
    return u.protocol === 'https:' && u.href.length <= 2000 ? u.href : undefined
  } catch {
    return undefined
  }
}

function parsePage(html: string, finalUrl: string, url: string): LinkPreview {
  const head = html.split(/<\/head>/i)[0] ?? html
  const meta: Record<string, string> = {}
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0])
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase()
    if (key && a.content && !(key in meta)) meta[key] = a.content
  }
  let icon: string | undefined
  let touch: string | undefined
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0])
    const rel = (a.rel ?? '').toLowerCase()
    if (!a.href) continue
    if (rel.includes('apple-touch-icon')) touch ??= a.href
    else if (/\bicon\b/.test(rel)) icon ??= a.href
  }
  const host = new URL(finalUrl).hostname.replace(/^www\./, '')
  return {
    url,
    kind: 'link',
    title: clean(meta['og:title'] ?? meta['twitter:title'] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1], 200),
    description: clean(meta['og:description'] ?? meta['twitter:description'] ?? meta.description, 300),
    image: httpsUrl(meta['og:image:secure_url'] ?? meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image'] ?? meta['twitter:image:src'], finalUrl),
    siteName: clean(meta['og:site_name'], 60) ?? host,
    icon: httpsUrl(touch ?? icon ?? '/favicon.ico', finalUrl),
  }
}

// ---------- YouTube ----------

async function youtube(url: string, id: string): Promise<LinkPreview> {
  const base: LinkPreview = { url, kind: 'youtube', videoId: id, siteName: 'YouTube', image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }
  const api = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`
  const r = await fetchLimited(api, 'application/json', 64 * 1024)
  const d = JSON.parse(r.body.toString('utf8')) as { title?: string; author_name?: string }
  return { ...base, title: clean(d.title, 200), channel: clean(d.author_name, 80) }
}

// ---------- Кеш ----------

const OK_TTL = 7 * 86400_000
const FAIL_TTL = 3600_000
const inflight = new Map<string, Promise<LinkPreview>>()

/** Картка з кешу, без походу в мережу (для сторінки спільного доступу). */
export function cachedPreview(url: string): LinkPreview | null {
  const c = getLinkPreview(url)
  return c ? (JSON.parse(c.data) as LinkPreview) : null
}

export async function unfurl(url: string): Promise<LinkPreview> {
  const c = getLinkPreview(url)
  if (c) {
    const d = JSON.parse(c.data) as LinkPreview
    if (Date.now() - c.fetchedAt < (d.failed ? FAIL_TTL : OK_TTL)) return d
  }
  const running = inflight.get(url)
  if (running) return running
  const p = (async () => {
    const yt = youtubeId(url)
    let d: LinkPreview
    try {
      if (yt) d = await youtube(url, yt.id)
      else {
        const r = await fetchLimited(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 768 * 1024, '</head>')
        if (!/html|xml/i.test(r.type) && r.type) throw new Error('Не HTML')
        d = parsePage(decode(r.body, r.type), r.url, url)
      }
    } catch {
      // YouTube без oEmbed (приватне чи видалене відео) все одно має обкладинку.
      d = yt ? { url, kind: 'youtube', videoId: yt.id, siteName: 'YouTube', image: `https://i.ytimg.com/vi/${yt.id}/hqdefault.jpg`, failed: true } : { url, kind: 'link', failed: true }
    }
    saveLinkPreview(url, JSON.stringify(d))
    return d
  })().finally(() => inflight.delete(url))
  inflight.set(url, p)
  return p
}
