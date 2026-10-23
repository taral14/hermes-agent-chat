// База знань: Obsidian-сховище Hermes.
import { createReadStream } from 'node:fs'
import { type Ctx, HttpError, SANDBOX_CSP, send, stream } from '../http.ts'
import { mimeOf } from '../media.ts'
import { VAULT_ENABLED, getNote, graph, listNotes, resolveLink, searchNotes, vaultFile, vaultInfo } from '../vault.ts'

export async function kbRoutes({ res, url, path }: Ctx): Promise<boolean> {
  if (path !== '/api/kb' && !path.startsWith('/api/kb/')) return false
  if (!VAULT_ENABLED) throw new HttpError(404, 'Базу знань не налаштовано: VAULT_PATH у .env чату')
  const q = (k: string) => url.searchParams.get(k) ?? ''
  if (path === '/api/kb') return send(res, 200, { ...(await vaultInfo()), list: await listNotes() })
  if (path === '/api/kb/note') {
    const note = await getNote(q('path'))
    if (!note) throw new HttpError(404, 'Нотатку не знайдено')
    return send(res, 200, note)
  }
  if (path === '/api/kb/search') return send(res, 200, await searchNotes(q('q')))
  if (path === '/api/kb/graph') return send(res, 200, await graph())
  if (path === '/api/kb/resolve') return send(res, 200, { path: resolveLink(q('target')) })
  if (path === '/api/kb/file') {
    const rel = q('path')
    const full = vaultFile(rel)
    if (!full) throw new HttpError(404, 'Файл не знайдено')
    const mime = rel.endsWith('.md') ? 'text/markdown; charset=utf-8' : mimeOf(rel)
    res.writeHead(200, {
      'Content-Type': mime.startsWith('text/') && !mime.includes('charset') ? `${mime}; charset=utf-8` : mime,
      'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': SANDBOX_CSP,
    })
    return stream(createReadStream(full), res)
  }
  return false
}
