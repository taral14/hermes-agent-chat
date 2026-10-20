// Плагіни — MCP-сервери Hermes: каталог optional-mcps і те, що вже стоїть у config.yaml.
// Каталог, перемикання й вхід — HTTP-маршрути gateway (/api/mcp/…), стан і встановлення — його RPC.
//
// Вхід OAuth живе в пам'яті процесу gateway, тож і повертатися браузер має туди. Gateway слухає
// лише loopback, тому сервіс повертає браузер на адресу чату (/api/plugins/oauth/<name>), а чат
// передає code і state у gateway через міст. Так вхід завершується і з телефона.
import type { Plugin, PluginAuthFlow, PluginStatus, PluginTest } from '../src/shared.ts'
import { PUBLIC_URL } from './config.ts'
import { emit } from './events.ts'
import { gateway } from './gateway.ts'
import { api, seg } from './hermesApi.ts'
import { HttpError } from './http.ts'
import { activeRunCount } from './live.ts'

type CatalogEntry = {
  name: string
  description: string
  source?: string | null
  transport: string
  auth_type: string
  url?: string | null
  required_env?: { name: string; prompt?: string; required?: boolean }[]
  suggest?: { hosts?: string[]; examples?: string[] }
}

type ServerRow = {
  name: string
  transport?: string
  url?: string | null
  auth?: string | null
  oauth_tokens_present?: boolean
  enabled?: boolean
  source?: string
  plugin?: string | null
}

type StatusRow = { name: string; status?: string; tools?: number }

type FlowSnapshot = { flow_id: string; server_name: string; status: PluginAuthFlow['status']; authorization_url?: string | null; error?: string | null }


/** Домен сервісу: mcp.notion.com → notion.com. Шлях і запит (там бувають токени) не віддаємо. */
function brandHost(url: string | null | undefined, hosts?: string[]): string | null {
  if (hosts?.[0]) return hosts[0]
  try {
    const parts = new URL(url ?? '').hostname.split('.')
    return parts.length > 2 ? parts.slice(-2).join('.') : parts.join('.') || null
  } catch {
    return null
  }
}

function status(row: StatusRow | undefined, server: ServerRow): PluginStatus {
  if (server.enabled === false) return 'disabled'
  const s = row?.status
  if (server.auth === 'oauth' && !server.oauth_tokens_present && s !== 'connected') return 'needs_auth'
  if (s === 'connected' || s === 'connecting' || s === 'failed' || s === 'disabled') return s
  return 'idle'
}

const authKind = (a: string | null | undefined): Plugin['auth'] => (a === 'oauth' ? 'oauth' : a === 'none' || !a ? 'none' : 'key')

export async function listPlugins(): Promise<Plugin[]> {
  const [catalog, servers, live] = await Promise.all([
    api<{ entries: CatalogEntry[] }>('GET', '/api/mcp/catalog'),
    gateway.rpc<{ servers: ServerRow[] }>('mcp.servers.list'),
    // Стан — із пам'яті gateway; якщо його нема, плагіни однаково показуємо.
    gateway.rpc<{ servers: StatusRow[] }>('mcp.servers.status').catch(() => ({ servers: [] as StatusRow[] })),
  ])
  const byStatus = new Map(live.servers.map((s) => [s.name, s]))
  const installed = new Map(servers.servers.map((s) => [s.name, s]))
  const out: Plugin[] = catalog.entries.map((e) => {
    const s = installed.get(e.name)
    installed.delete(e.name)
    return {
      name: e.name,
      description: e.description,
      catalog: true,
      installed: Boolean(s),
      enabled: s ? s.enabled !== false : false,
      auth: authKind(s?.auth ?? e.auth_type),
      transport: e.transport === 'stdio' ? 'stdio' : 'http',
      host: brandHost(e.url ?? e.source, e.suggest?.hosts),
      docs: e.source ?? null,
      env: (e.required_env ?? []).map((v) => ({ name: v.name, prompt: v.prompt || v.name, required: v.required !== false })),
      examples: e.suggest?.examples ?? [],
      status: s ? status(byStatus.get(e.name), s) : null,
      tools: byStatus.get(e.name)?.tools ?? null,
      fromPlugin: s?.plugin ?? null,
    }
  })
  // Свої сервери з config.yaml (і ті, що принесли плагіни Hermes).
  for (const s of installed.values()) {
    const stdio = s.transport === 'stdio'
    out.push({
      name: s.name,
      description: '',
      catalog: false,
      installed: true,
      enabled: s.enabled !== false,
      auth: authKind(s.auth),
      transport: stdio ? 'stdio' : 'http',
      host: stdio ? null : brandHost(s.url),
      docs: null,
      env: [],
      examples: [],
      status: status(byStatus.get(s.name), s),
      tools: byStatus.get(s.name)?.tools ?? null,
      fromPlugin: s.plugin ?? null,
    })
  }
  return out
}

async function findPlugin(name: string): Promise<Plugin> {
  const p = (await listPlugins()).find((x) => x.name === name)
  if (!p) throw new HttpError(404, 'Такого плагіна немає')
  return p
}

function editable(p: Plugin) {
  if (p.fromPlugin) throw new HttpError(409, `Цей сервер додав плагін Hermes «${p.fromPlugin}», змінюй його там`)
}

// ---------- Перепідключення ----------

/**
 * Hermes бере нові MCP-сервери лише після reload.mcp. Він перебудовує інструменти всіх сесій,
 * тож чекаємо, поки в чаті не йде відповідь, і зливаємо кілька змін поспіль в одне перепідключення.
 */
let reloadTimer: NodeJS.Timeout | null = null
const RELOAD_DEBOUNCE = 1500
const RELOAD_MAX_WAIT = 10 * 60_000

function queueReload(): 'now' | 'after-run' {
  if (reloadTimer) clearTimeout(reloadTimer)
  const started = Date.now()
  const tick = () => {
    if (activeRunCount() > 0 && Date.now() - started < RELOAD_MAX_WAIT) {
      reloadTimer = setTimeout(tick, 5000)
      return
    }
    reloadTimer = null
    gateway
      .rpc('reload.mcp', { confirm: true }, 120_000)
      .catch((err: Error) => console.warn(`[plugins] reload.mcp: ${err.message}`))
      .finally(() => emit({ type: 'plugins' }))
  }
  reloadTimer = setTimeout(tick, RELOAD_DEBOUNCE)
  return activeRunCount() > 0 ? 'after-run' : 'now'
}

// ---------- Дії ----------

/** Куди сервіс поверне браузер після входу: публічна адреса чату. */
export const oauthReturnUrl = (name: string) => `${PUBLIC_URL}/api/plugins/oauth/${seg(name)}`

export async function installPlugin(name: string, env: Record<string, string>) {
  const p = await findPlugin(name)
  if (!p.catalog) throw new HttpError(400, 'Цього сервера немає в каталозі Hermes')
  if (p.installed) return { reload: queueReload() }
  if (p.env.length) {
    // Записи з власними полями (asana, n8n): Hermes сам розкладе значення між .env і config.yaml.
    for (const v of p.env) if (v.required && !env[v.name]?.trim()) throw new HttpError(400, `Заповни «${v.prompt}»`)
    const values = Object.fromEntries(p.env.filter((v) => env[v.name]?.trim()).map((v) => [v.name, env[v.name]!.trim()]))
    await api('POST', '/api/mcp/catalog/install', { name, env: values, enable: true }, 120_000)
    return { reload: queueReload() }
  }
  const config = await gateway.catalogConfig(name)
  const oauth = (config.oauth ?? {}) as Record<string, unknown>
  // Сервіс із прибитою loopback-адресою (redirect_port) лишаємо як є: там адресу вставляють вручну.
  if (p.auth === 'oauth' && !oauth.redirect_port) config.oauth = { ...oauth, redirect_uri: oauthReturnUrl(name) }
  try {
    await gateway.rpc('mcp.servers.add', { name, preset: name, config })
  } catch (err) {
    throw new HttpError(400, (err as Error).message)
  }
  return { reload: queueReload() }
}

export async function setPluginEnabled(name: string, enabled: boolean) {
  const p = await findPlugin(name)
  if (!p.installed) throw new HttpError(400, 'Плагін ще не встановлено')
  editable(p)
  await api('PUT', `/api/mcp/servers/${seg(name)}/enabled`, { enabled })
  return { reload: queueReload() }
}

/** Видалити можна лише плагін із каталогу: свій сервер із config.yaml звідси не губимо. */
export async function removePlugin(name: string) {
  const p = await findPlugin(name)
  if (!p.catalog) throw new HttpError(400, 'Свої сервери прибирай у config.yaml Hermes')
  editable(p)
  if (p.installed) await api('DELETE', `/api/mcp/servers/${seg(name)}`)
  return { reload: queueReload() }
}

export async function testPlugin(name: string): Promise<PluginTest> {
  const r = await api<{ ok: boolean; tools?: { name: string; description?: string }[]; error?: string | null; oauth_needed?: boolean }>(
    'POST',
    `/api/mcp/servers/${seg(name)}/test`,
    undefined,
    90_000,
  )
  const needsAuth = Boolean(r.oauth_needed) || /oauth/i.test(r.error ?? '')
  return {
    ok: r.ok,
    tools: (r.tools ?? []).map((t) => ({ name: t.name, description: (t.description ?? '').split('\n')[0]!.slice(0, 240) })),
    error: r.ok ? null : needsAuth ? 'Потрібно увійти в сервіс' : (r.error ?? 'Не вдалося підключитися'),
    needsAuth,
  }
}

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/

function toFlow(s: FlowSnapshot): PluginAuthFlow {
  let loopback = false
  try {
    const back = new URL(s.authorization_url ?? '').searchParams.get('redirect_uri')
    if (back) loopback = LOOPBACK.test(new URL(back).hostname)
  } catch {
    /* адреси ще нема */
  }
  return { id: s.flow_id, name: s.server_name, status: s.status, url: s.authorization_url ?? null, error: s.error ?? null, loopback }
}

/** Почати вхід: Hermes готує сторінку сервісу; результат забираємо опитуванням pluginFlow. */
export async function startPluginAuth(name: string): Promise<PluginAuthFlow> {
  editable(await findPlugin(name))
  return toFlow(await api<FlowSnapshot>('POST', `/api/mcp/servers/${seg(name)}/auth`, undefined, 45_000))
}

/** Після успішного входу Hermes сам перепідключає сервер; нам лишається сказати вкладкам оновитись. */
export async function pluginFlow(id: string): Promise<PluginAuthFlow> {
  const flow = toFlow(await api<FlowSnapshot>('GET', `/api/mcp/oauth/flows/${seg(id)}`))
  if (flow.status === 'approved') emit({ type: 'plugins' })
  return flow
}

export async function cancelPluginFlow(id: string) {
  await api('DELETE', `/api/mcp/oauth/flows/${seg(id)}`)
}

/**
 * Сервіс повернув браузер на 127.0.0.1 іншого пристрою: людина вставляє ту адресу, а ми віддаємо
 * code і state у зворотну адресу Hermes. Hermes сам звіряє state з очікуваним.
 */
export async function finishPluginFlow(id: string, pasted: string): Promise<PluginAuthFlow> {
  let q: URLSearchParams
  try {
    q = new URL(pasted.trim()).searchParams
  } catch {
    throw new HttpError(400, 'Встав повну адресу сторінки, на яку перекинуло після входу')
  }
  if (!q.get('state') || !(q.get('code') || q.get('error'))) throw new HttpError(400, 'В адресі немає коду входу')
  const flow = toFlow(await api<FlowSnapshot>('GET', `/api/mcp/oauth/flows/${seg(id)}`))
  const params = new URLSearchParams()
  for (const k of ['code', 'state', 'error', 'iss']) {
    const v = q.get(k)
    if (v) params.set(k, v)
  }
  const r = await gateway.http('GET', `/api/mcp/oauth/callback/${seg(flow.name)}?${params}`)
  if (r.status === 404) throw new HttpError(410, 'Вхід застарів, почни заново')
  if (r.status >= 400) throw new HttpError(400, 'Hermes не прийняв цю адресу: вона невірна чи вже використана')
  return flow
}

/**
 * Сюди сервіс повертає браузер після входу. Маршрут публічний: на телефоні сторінка входу відкривається
 * в браузері без cookie чату. Безпечно, бо Hermes приймає лише state, який сам видав для цього входу.
 */
export async function oauthReturn(name: string, query: URLSearchParams): Promise<{ ok: boolean; text: string }> {
  const params = new URLSearchParams()
  for (const k of ['code', 'state', 'error', 'iss']) {
    const v = query.get(k)
    if (v) params.set(k, v.slice(0, 4096))
  }
  if (!params.get('state')) return { ok: false, text: 'В адресі немає даних входу.' }
  try {
    const r = await gateway.http('GET', `/api/mcp/oauth/callback/${seg(name)}?${params}`)
    if (r.status === 404) return { ok: false, text: 'Цей вхід уже застарів. Повернись у чат і почни заново.' }
    if (r.status >= 400) return { ok: false, text: params.get('error') ? 'Доступ не надано.' : 'Hermes не прийняв відповідь сервісу. Спробуй ще раз.' }
    return { ok: true, text: 'Hermes завершує підключення. Можна закрити цю вкладку й повернутися в чат: там видно, чи все вдалося.' }
  } catch {
    return { ok: false, text: 'Hermes зараз недоступний. Спробуй ще раз за хвилину.' }
  }
}
