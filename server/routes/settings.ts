// Налаштування, сховище, експорт, моделі й команди Hermes, картки посилань.
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SettingsInfo, StorageInfo } from '../../src/shared.ts'
import { HERMES_PANEL_URL, ROOT } from '../config.ts'
import { DATA_DIR, clearLinkPreviews, countLinkPreviews, listChats, listMessages, listUploads } from '../db.ts'
import { gateway } from '../gateway.ts'
import { modelOptions } from '../hermes.ts'
import { type Ctx, HttpError, readJson, send } from '../http.ts'
import { commandCatalog } from '../native.ts'
import { chatPrefs, updateChatPrefs } from '../prefs.ts'
import { setPresence } from '../push.ts'
import { translate } from '../translate.ts'
import { unfurl } from '../unfurl.ts'
import { vaultInfo } from '../vault.ts'

const STARTED_AT = Date.now()

/** Версія для «Про застосунок»: з package.json, а в git-копії ще й коміт. */
export const VERSION = (() => {
  let version = 'невідома'
  try {
    version = String((JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? version)
  } catch {
    /* немає package.json */
  }
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return sha ? `${version} (${sha})` : version
  } catch {
    return version
  }
})()

function storageInfo(): StorageInfo {
  let files = 0
  let bytes = 0
  let macFiles = 0
  for (const u of listUploads()) {
    if (u.ref) {
      macFiles++
      continue
    }
    files++
    bytes += u.size
  }
  let dbBytes = 0
  for (const f of ['chat.db', 'chat.db-wal']) {
    try {
      dbBytes += statSync(join(DATA_DIR, f)).size
    } catch {
      /* немає файлу */
    }
  }
  return { files, bytes, macFiles, linkCache: countLinkPreviews(), dbBytes }
}

/** Усі чати одним Markdown-файлом: заголовки, хто що сказав, назви файлів. */
function exportMarkdown(): string {
  const fmt = new Intl.DateTimeFormat('uk', { dateStyle: 'long', timeStyle: 'short' })
  const out = [`# Чати з Hermes`, '', `Експорт від ${fmt.format(Date.now())}.`, '']
  for (const chat of listChats()) {
    out.push('---', '', `## ${chat.title || 'Без назви'}`, '', `_${fmt.format(chat.createdAt)}_`, '')
    for (const m of listMessages(chat.id)) {
      if (!m.text.trim() && !m.attachments.length) continue
      out.push(`### ${m.role === 'user' ? 'Я' : 'Hermes'} · ${fmt.format(m.createdAt)}`, '')
      if (m.text.trim()) out.push(m.text.trim(), '')
      for (const a of m.attachments) out.push(`📎 ${a.name} (${Math.max(1, Math.round(a.size / 1024))} КБ)`)
      if (m.attachments.length) out.push('')
    }
  }
  return out.join('\n')
}

export async function settingsRoutes({ req, res, url, path, method }: Ctx): Promise<boolean> {
  // Картка посилання з повідомлення: заголовок, опис, картинка. Сервер читає сторінку сам (див. unfurl.ts).
  if (path === '/api/unfurl' && method === 'GET') {
    const target = url.searchParams.get('url') ?? ''
    if (!/^https?:\/\//i.test(target) || target.length > 2000) throw new HttpError(400, 'Некоректне посилання')
    return send(res, 200, await unfurl(target), { 'Cache-Control': 'private, max-age=3600' })
  }
  // Переклад описів (каталоги Hermes англійською) допоміжною моделлю Hermes; див. translate.ts.
  if (path === '/api/translate' && method === 'POST') {
    const { texts } = await readJson<{ texts?: unknown }>(req)
    if (!Array.isArray(texts) || !texts.length || !texts.every((t) => typeof t === 'string')) throw new HttpError(400, 'Потрібно texts')
    return send(res, 200, { translations: await translate(texts as string[]) })
  }
  if (path === '/api/presence' && method === 'POST') {
    const b = await readJson<{ clientId?: string; visible?: boolean; chatId?: string | null }>(req)
    if (typeof b.clientId === 'string' && b.clientId.length < 80) setPresence(b.clientId, Boolean(b.visible), b.chatId ?? null)
    return send(res, 200, { ok: true })
  }
  if (path === '/api/models') {
    try {
      return send(res, 200, await modelOptions())
    } catch (err) {
      throw new HttpError(502, (err as Error).message)
    }
  }
  if (path === '/api/commands') {
    try {
      return send(res, 200, await commandCatalog())
    } catch (err) {
      throw new HttpError(503, (err as Error).message)
    }
  }
  if (path === '/api/settings' && method === 'GET') {
    const info: SettingsInfo = {
      prefs: chatPrefs(),
      about: { version: VERSION, startedAt: STARTED_AT, hermes: await gateway.check(), vault: (await vaultInfo()).available, panelUrl: HERMES_PANEL_URL },
    }
    return send(res, 200, info)
  }
  if (path === '/api/settings' && method === 'PATCH') return send(res, 200, updateChatPrefs(await readJson<Record<string, unknown>>(req)))
  if (path === '/api/storage' && method === 'GET') return send(res, 200, storageInfo())
  if (path === '/api/storage/link-cache' && method === 'DELETE') {
    clearLinkPreviews()
    return send(res, 200, storageInfo())
  }
  if (path === '/api/export' && method === 'GET') {
    const name = `hermes-chats-${new Date().toISOString().slice(0, 10)}.md`
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(exportMarkdown())
    return true
  }
  return false
}
