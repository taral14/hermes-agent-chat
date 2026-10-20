// Плагіни: MCP-сервери (plugins.ts), розширення (extensions.ts) і навички (skills.ts) Hermes.
import {
  configureExtension,
  getExtension,
  installExtension,
  listExtensions,
  removeExtension,
  toggleExtension,
  updateExtension,
} from '../extensions.ts'
import { type Ctx, escHtml, HttpError, PAGE_HEADERS, readJson, send } from '../http.ts'
import {
  cancelPluginFlow,
  finishPluginFlow,
  installPlugin,
  listPlugins,
  oauthReturn,
  pluginFlow,
  removePlugin,
  setPluginEnabled,
  startPluginAuth,
  testPlugin,
} from '../plugins.ts'
import { installSkill, listSkills, searchSkills, skillText, toggleSkill, uninstallSkill } from '../skills.ts'

/** Публічна сторінка, куди сервіс повертає браузер після входу (див. oauthReturn). */
export async function pluginReturnRoute({ res, url, path, method }: Ctx): Promise<boolean> {
  const m = path.match(/^\/api\/plugins\/oauth\/([\w.-]+)$/)
  if (!m || method !== 'GET') return false
  const r = await oauthReturn(m[1]!, url.searchParams)
  const html = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hermes</title><style>body{font:17px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0 16px;background:#fff;color:#0d0d0d}
@media (prefers-color-scheme:dark){body{background:#212121;color:#ececec}}main{max-width:420px;text-align:center}a{color:inherit}</style></head>
<body><main><h1>${r.ok ? 'Вхід отримано' : 'Не вдалося'}</h1><p>${escHtml(r.text)}</p><p><a href="/plugins">До плагінів</a></p></main></body></html>`
  res.writeHead(r.ok ? 200 : 400, { ...PAGE_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  res.end(html)
  return true
}

export async function pluginRoutes({ req, res, path, method }: Ctx): Promise<boolean> {
  if (path !== '/api/plugins' && !path.startsWith('/api/plugins/')) return false
  if (path === '/api/plugins' && method === 'GET') return send(res, 200, await listPlugins())

  const f = path.match(/^\/api\/plugins\/flows\/([\w-]+)(\/callback)?$/)
  if (f) {
    const id = f[1]!
    if (f[2] && method === 'POST') {
      const { url } = await readJson<{ url?: unknown }>(req)
      if (typeof url !== 'string') throw new HttpError(400, 'Потрібна адреса')
      return send(res, 200, await finishPluginFlow(id, url))
    }
    if (!f[2] && method === 'GET') return send(res, 200, await pluginFlow(id))
    if (!f[2] && method === 'DELETE') {
      await cancelPluginFlow(id)
      return send(res, 200, { ok: true })
    }
    return false
  }

  const m = path.match(/^\/api\/plugins\/([\w.-]+)\/(install|enabled|test|auth)$/) ?? path.match(/^\/api\/plugins\/([\w.-]+)()$/)
  if (!m) return false
  const name = m[1]!
  switch (`${method} ${m[2]}`) {
    case 'POST install': {
      const { env } = await readJson<{ env?: unknown }>(req)
      const values: Record<string, string> = {}
      if (env && typeof env === 'object') for (const [k, v] of Object.entries(env)) if (typeof v === 'string') values[k] = v
      return send(res, 200, await installPlugin(name, values))
    }
    case 'PUT enabled': {
      const { enabled } = await readJson<{ enabled?: unknown }>(req)
      if (typeof enabled !== 'boolean') throw new HttpError(400, 'Потрібно enabled: true чи false')
      return send(res, 200, await setPluginEnabled(name, enabled))
    }
    case 'POST test':
      return send(res, 200, await testPlugin(name))
    case 'POST auth':
      return send(res, 200, await startPluginAuth(name))
    case 'DELETE ':
      return send(res, 200, await removePlugin(name))
  }
  return false
}

const text = (v: unknown, what: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `Потрібно ${what}`)
  return v.trim()
}

export async function extensionRoutes({ req, res, path, method }: Ctx): Promise<boolean> {
  if (path !== '/api/extensions' && !path.startsWith('/api/extensions/')) return false
  if (path === '/api/extensions' && method === 'GET') return send(res, 200, await listExtensions())
  const m = path.match(/^\/api\/extensions\/([\w.-]+)(?:\/(install|enabled|update|settings))?$/)
  if (!m) return false
  const name = m[1]!
  switch (`${method} ${m[2] ?? ''}`) {
    case 'GET ':
      return send(res, 200, await getExtension(name))
    case 'POST install':
      return send(res, 200, await installExtension(name))
    case 'PUT enabled': {
      const { enabled } = await readJson<{ enabled?: unknown }>(req)
      if (typeof enabled !== 'boolean') throw new HttpError(400, 'Потрібно enabled: true чи false')
      return send(res, 200, await toggleExtension(name, enabled))
    }
    case 'POST update': {
      const { accept } = await readJson<{ accept?: unknown }>(req)
      return send(res, 200, await updateExtension(name, accept === true))
    }
    case 'PUT settings': {
      const { values } = await readJson<{ values?: unknown }>(req)
      if (!values || typeof values !== 'object') throw new HttpError(400, 'Потрібно values')
      return send(res, 200, await configureExtension(name, values as Record<string, unknown>))
    }
    case 'DELETE ':
      await removeExtension(name)
      return send(res, 200, { ok: true })
  }
  return false
}

export async function skillRoutes({ req, res, url, path, method }: Ctx): Promise<boolean> {
  if (path !== '/api/skills' && !path.startsWith('/api/skills/')) return false
  if (path === '/api/skills' && method === 'GET') return send(res, 200, await listSkills())
  if (path === '/api/skills/search' && method === 'GET') return send(res, 200, await searchSkills(text(url.searchParams.get('q'), 'запит')))
  if (path === '/api/skills/text' && method === 'GET')
    return send(res, 200, { text: await skillText(text(url.searchParams.get('id'), 'id'), url.searchParams.get('installed') === '1') })
  if (path === '/api/skills/install' && method === 'POST') {
    await installSkill(text((await readJson<{ id?: unknown }>(req)).id, 'id'))
    return send(res, 200, { ok: true })
  }
  if (path === '/api/skills/enabled' && method === 'PUT') {
    const { name, enabled } = await readJson<{ name?: unknown; enabled?: unknown }>(req)
    if (typeof enabled !== 'boolean') throw new HttpError(400, 'Потрібно enabled: true чи false')
    await toggleSkill(text(name, 'назва'), enabled)
    return send(res, 200, { ok: true })
  }
  if (path === '/api/skills/uninstall' && method === 'POST') {
    await uninstallSkill(text((await readJson<{ name?: unknown }>(req)).name, 'назва'))
    return send(res, 200, { ok: true })
  }
  return false
}
