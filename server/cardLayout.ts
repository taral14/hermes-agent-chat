// Якою показати картинку картки посилання. Великою вона корисна, лише коли це фото саме цієї сторінки
// (стаття, новина, відео). Брендова заставка сайту, логотип чи згенерована картка з тим самим заголовком
// нічого не додають — тоді картинки немає. Обкладинки, постери й квадратні фото товарів не ріжемо
// під широкий формат, а ставимо мініатюрою збоку.

export type CardLayout = 'large' | 'thumb' | null

export type CardFacts = {
  /** Адреса сторінки після перенаправлень. */
  url: string
  image?: string
  width?: number
  height?: number
  /** og:type */
  type?: string
  /** twitter:card */
  card?: string
}

/** Слова, з якими картинка одна на весь сайт: logo.png, og-image.png, social-share.jpg… */
const GENERIC = /(?:^|[/_.-])(?:logo|favicon|og|og-?image|opengraph|social|share|placeholder)(?=[/_.\-\d]|$)/i
/** «default» — лише в назві файлу: у CDN він буває й папкою для всіх картинок (/dims4/default/…). */
const GENERIC_FILE = /(?:^|[_.-])default(?=[_.\-\d]|$)/i

function genericPath(path: string): boolean {
  return GENERIC.test(path) || GENERIC_FILE.test(path.split('/').pop() ?? '')
}

export function isGenericImage(image: string): boolean {
  try {
    const u = new URL(image)
    if (u.hostname === 'opengraph.githubassets.com' || genericPath(decodeURIComponent(u.pathname))) return true
    // Ресайзер із адресою оригіналу в параметрі (?url=https://…/logo.jpg).
    for (const v of u.searchParams.values()) if (/^https?:\/\//.test(v) && genericPath(new URL(v).pathname)) return true
    return false
  } catch {
    return true
  }
}

/** Головна сторінка сайту: її картинка — завжди заставка бренду. */
function isHome(url: string): boolean {
  try {
    const u = new URL(url)
    return (u.pathname === '/' || u.pathname === '') && !u.search
  } catch {
    return false
  }
}

export function cardLayout(f: CardFacts): CardLayout {
  if (!f.image || isGenericImage(f.image) || isHome(f.url)) return null
  // Розмір важить більше за twitter:card: CMS часто ставлять «summary» усім сторінкам підряд.
  if (f.width && f.height) return f.width >= 400 && f.height >= 200 && f.width / f.height >= 1.3 ? 'large' : 'thumb'
  return f.card === 'summary_large_image' || /^(article|video)/i.test(f.type ?? '') ? 'large' : 'thumb'
}

/** Розмір картинки за її початком: PNG, GIF, WebP, JPEG. Не вийшло — null. */
export function imageSize(b: Buffer): { width: number; height: number } | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  if (b.length >= 10 && b.toString('latin1', 0, 4) === 'GIF8') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
  if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const kind = b.toString('latin1', 12, 16)
    if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
    if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
    if (kind === 'VP8L') {
      const v = b.readUInt32LE(21)
      return { width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) }
    }
    return null
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1]!
      if (marker === 0xff) {
        i++
        continue
      }
      // SOF0…SOF15, крім DHT (C4), JPG (C8) і DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) }
      }
      i += 2 + b.readUInt16BE(i + 2)
    }
  }
  return null
}
