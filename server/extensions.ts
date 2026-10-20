// Розширення — code-плагіни Hermes: каталог plugin-catalog і те, що лежить у ~/.hermes/plugins.
// Каталог — HTTP-маршрут gateway (RPC його не віддає), керування — RPC plugins.manage.
import { basename } from 'node:path'
import type { Extension, ExtensionResult, ExtensionSetting } from '../src/shared.ts'
import { emit } from './events.ts'
import { gateway } from './gateway.ts'
import { api, rpcFailure } from './hermesApi.ts'
import { HttpError } from './http.ts'

type CatalogEntry = {
  name: string
  title?: string | null
  description?: string
  category?: string
  tier?: string
  maintainer?: string
  image?: string | null
  docs_url?: string | null
  platforms?: string[]
  capabilities?: { provides_tools?: string[]; provides_hooks?: string[]; provides_middleware?: string[]; requires_env?: string[] }
  known_issues?: string[] | string | null
}

type Row = {
  name: string
  key: string
  description: string
  source: string
  status: 'enabled' | 'disabled' | 'not enabled'
  portable: boolean
  install_dir: string
  has_desktop_half: boolean
  settings_schema: (Omit<ExtensionSetting, 'hasValue'> & { has_value?: boolean })[]
  servers?: { name: string; state: string; sentence: string }[]
  catalog_name?: string
  update_available?: boolean
}

/** Каталог важить ~2 МБ і щоразу збирається з диска й мережі: тримаємо копію 10 хвилин. */
const CATALOG_TTL = 10 * 60_000
let catalog: { at: number; entries: CatalogEntry[] } | null = null

async function loadCatalog(): Promise<CatalogEntry[]> {
  if (catalog && Date.now() - catalog.at < CATALOG_TTL) return catalog.entries
  const r = await api<{ entries: CatalogEntry[]; removed?: { name: string }[] }>('GET', '/api/dashboard/plugins/catalog', undefined, 60_000)
  const removed = new Set((r.removed ?? []).map((x) => x.name))
  const os = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'
  const entries = r.entries.filter((e) => {
    if (removed.has(e.name)) return false
    if (e.platforms?.length && !e.platforms.includes(os)) return false
    // Лише інтерфейс десктопного застосунку: у чаті від нього нічого не зміниться.
    const c = e.capabilities ?? {}
    const nothing = !c.provides_tools?.length && !c.provides_hooks?.length && !c.provides_middleware?.length && !c.requires_env?.length
    return !(e.category === 'desktop' && nothing)
  })
  catalog = { at: Date.now(), entries }
  return entries
}

async function rows(): Promise<Row[]> {
  const r = await gateway.rpc<{ plugins: Row[] }>('plugins.manage', { action: 'list' }, 60_000)
  // Вбудовані плагіни Hermes (провайдери, платформи) — частина самого Hermes, не те, що людина ставить.
  return r.plugins.filter((p) => p.source !== 'bundled')
}

const issues = (v: CatalogEntry['known_issues']) => (Array.isArray(v) ? v : v ? [v] : [])

/** У списку — лише те, що видно в рядку (каталог великий); повний запис — для картки. */
function fromCatalog(e: CatalogEntry, row: Row | undefined, full: boolean): Extension {
  const description = e.description ?? ''
  return {
    name: e.name,
    title: e.title || e.name,
    description: full || description.length <= 160 ? description : `${description.slice(0, 157).trimEnd()}…`,
    category: e.category ?? 'general',
    tier: e.tier === 'official' || e.tier === 'verified' ? e.tier : 'community',
    maintainer: e.maintainer ?? '',
    image: e.image?.startsWith('https://') ? e.image : null,
    docs: full ? (e.docs_url ?? null) : null,
    requiresEnv: full ? (e.capabilities?.requires_env ?? []) : [],
    knownIssues: full ? issues(e.known_issues) : [],
    ...installedPart(row),
  }
}

function installedPart(row: Row | undefined) {
  return {
    installed: Boolean(row),
    status: row ? (row.status === 'not enabled' ? ('available' as const) : row.status) : null,
    key: row?.key ?? null,
    dir: row?.install_dir ? basename(row.install_dir) : null,
    updateAvailable: Boolean(row?.update_available),
    settings: (row?.settings_schema ?? []).map(({ has_value, ...f }) => ({ ...f, ...(f.type === 'secret' ? { hasValue: Boolean(has_value) } : {}) })),
    servers: row?.servers ?? [],
  }
}

/** Плагін не з каталогу: своя тека в ~/.hermes/plugins чи git-репозиторій. */
function fromRow(row: Row): Extension {
  return {
    name: row.name,
    title: row.name,
    description: row.description,
    category: row.portable ? 'tools' : 'general',
    tier: null,
    maintainer: '',
    image: null,
    docs: null,
    requiresEnv: [],
    knownIssues: [],
    ...installedPart(row),
  }
}

export async function listExtensions(): Promise<Extension[]> {
  const [entries, installed] = await Promise.all([loadCatalog(), rows()])
  const byName = new Map(installed.map((r) => [r.catalog_name || r.name, r]))
  const out = entries.map((e) => {
    const row = byName.get(e.name)
    byName.delete(e.name)
    return fromCatalog(e, row, false)
  })
  for (const r of byName.values()) out.push(fromRow(r))
  return out
}

export async function getExtension(name: string): Promise<Extension> {
  const [entries, installed] = await Promise.all([loadCatalog(), rows()])
  const row = installed.find((r) => (r.catalog_name || r.name) === name)
  const entry = entries.find((e) => e.name === name)
  if (entry) return fromCatalog(entry, row, true)
  if (row) return fromRow(row)
  throw new HttpError(404, 'Такого розширення немає')
}

function changed() {
  emit({ type: 'plugins' })
}

type Activation = { restart_required?: boolean; warnings?: string[]; missing_env?: string[] }
const result = (r: Activation): ExtensionResult => ({
  restartRequired: Boolean(r.restart_required),
  warnings: r.warnings ?? [],
  missingEnv: r.missing_env ?? [],
})

/** Встановлення: Hermes клонує репозиторій за закріпленим комітом, сканує код, ставить залежності й вмикає. */
export async function installExtension(name: string): Promise<ExtensionResult> {
  const entry = (await loadCatalog()).find((e) => e.name === name)
  if (!entry) throw new HttpError(404, 'Цього розширення немає в каталозі Hermes')
  try {
    const r = await gateway.rpc<Activation>('plugins.manage', { action: 'install', catalog_name: name, identifier: '', enable: true }, 600_000)
    return result(r)
  } catch (err) {
    throw rpcFailure(err, 'Hermes не зміг встановити розширення')
  } finally {
    changed()
  }
}

export async function toggleExtension(name: string, enable: boolean): Promise<ExtensionResult> {
  const ext = await getExtension(name)
  if (!ext.key) throw new HttpError(400, 'Розширення ще не встановлено')
  try {
    // enable обов'язково явний: без нього Hermes вимикає.
    return result(await gateway.rpc<Activation>('plugins.manage', { action: 'toggle', key: ext.key, enable }, 300_000))
  } catch (err) {
    throw rpcFailure(err, 'Hermes не зміг змінити розширення')
  } finally {
    changed()
  }
}

export async function removeExtension(name: string) {
  const ext = await getExtension(name)
  if (!ext.dir) throw new HttpError(400, 'Розширення ще не встановлено')
  try {
    await gateway.rpc('plugins.manage', { action: 'remove', name: ext.dir }, 120_000)
  } catch (err) {
    throw rpcFailure(err, 'Hermes не зміг видалити розширення')
  } finally {
    changed()
  }
}

/** Оновлення до нового коміту з каталогу; якщо воно додає можливостей, спершу питаємо згоди. */
export async function updateExtension(name: string, accept: boolean): Promise<ExtensionResult> {
  const ext = await getExtension(name)
  if (!ext.dir) throw new HttpError(400, 'Розширення ще не встановлено')
  try {
    const r = await gateway.rpc<Activation & { ok?: boolean; consent_required?: boolean; delta_lines?: string[] }>(
      'plugins.manage',
      { action: 'update', name: ext.dir, accept_capabilities: accept },
      600_000,
    )
    if (r.consent_required) return { ...result(r), consent: r.delta_lines ?? [] }
    return result(r)
  } catch (err) {
    throw rpcFailure(err, 'Hermes не зміг оновити розширення')
  } finally {
    changed()
  }
}

/**
 * Налаштування: звичайні поля — у config.yaml через Hermes, секрети й потрібні змінні — у ~/.hermes/.env.
 * У .env пишемо лише ті змінні, які оголосило саме це розширення.
 */
export async function configureExtension(name: string, values: Record<string, unknown>): Promise<Extension> {
  const ext = await getExtension(name)
  if (!ext.key) throw new HttpError(400, 'Розширення ще не встановлено')
  const fields = new Map(ext.settings.map((f) => [f.key, f]))
  const envNames = new Set([...ext.requiresEnv, ...ext.settings.flatMap((f) => (f.env ? [f.env] : []))])
  const plain: Record<string, unknown> = {}
  const env: [string, string][] = []
  for (const [k, v] of Object.entries(values)) {
    const f = fields.get(k)
    if (f?.type === 'secret' && f.env) {
      if (typeof v === 'string' && v.trim()) env.push([f.env, v.trim()])
    } else if (f) plain[k] = v
    else if (envNames.has(k) && typeof v === 'string' && v.trim()) env.push([k, v.trim()])
    else throw new HttpError(400, `Невідоме поле «${k}»`)
  }
  try {
    if (Object.keys(plain).length) await gateway.rpc('plugins.manage', { action: 'settings', key: ext.key, values: plain }, 60_000)
  } catch (err) {
    throw rpcFailure(err, 'Hermes не прийняв налаштування')
  }
  for (const [key, value] of env) await api('PUT', '/api/env', { key, value })
  changed()
  return getExtension(name)
}
