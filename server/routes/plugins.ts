// Плагіни: MCP-сервери Hermes (див. plugins.ts).
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
