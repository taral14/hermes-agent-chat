// Навички — скіли Hermes: встановлені (~/.hermes/skills), офіційний каталог і пошук в інших джерелах.
// Списки, вміст і перемикання — HTTP-маршрути gateway; встановлення — RPC skills.manage (одразу каже,
// чи пропустив сканер), видалення — фонова дія Hermes, яку дочікуємось тут.
import type { Skill } from '../src/shared.ts'
import { emit } from './events.ts'
import { gateway } from './gateway.ts'
import { api, rpcFailure, seg } from './hermesApi.ts'
import { HttpError } from './http.ts'

type Installed = { name: string; description: string; category: string | null; enabled: boolean; usage?: number; provenance?: string }
type HubItem = { name: string; description: string; source: string; identifier: string; trust_level?: string; category?: string; installed?: boolean }

const trust = (t: string | undefined): Skill['trust'] => (t === 'builtin' || t === 'trusted' || t === 'community' ? t : null)
const provenance = (p: string | undefined): Skill['provenance'] =>
  p === 'bundled' || p === 'hub' || p === 'agent' || p === 'external' ? p : null

function fromHub(h: HubItem, mine: Installed | undefined): Skill {
  return {
    id: h.identifier,
    name: h.name,
    description: h.description,
    category: h.category ?? '',
    installed: Boolean(mine),
    enabled: mine?.enabled ?? false,
    provenance: provenance(mine?.provenance),
    source: h.source,
    trust: trust(h.trust_level),
    usage: mine?.usage ?? 0,
  }
}

function fromInstalled(s: Installed): Skill {
  return {
    id: s.name,
    name: s.name,
    description: s.description,
    category: s.category ?? '',
    installed: true,
    enabled: s.enabled,
    provenance: provenance(s.provenance),
    source: null,
    trust: null,
    usage: s.usage ?? 0,
  }
}

/** Встановлені навички й офіційний каталог Hermes (лежить разом із Hermes, без мережі). */
export async function listSkills(): Promise<Skill[]> {
  const [installed, official] = await Promise.all([
    api<Installed[]>('GET', '/api/skills'),
    api<{ skills: HubItem[] }>('GET', '/api/skills/hub/official').catch(() => ({ skills: [] as HubItem[] })),
  ])
  const mine = new Map(installed.map((s) => [s.name, s]))
  const out = official.skills.map((h) => {
    const m = mine.get(h.name)
    mine.delete(h.name)
    return fromHub(h, m)
  })
  for (const s of mine.values()) out.push(fromInstalled(s))
  return out
}

/** Пошук в усіх джерелах каталогу навичок (мережа, до ~30 с). */
export async function searchSkills(q: string): Promise<{ results: Skill[]; timedOut: string[] }> {
  const r = await api<{ results: HubItem[]; timed_out?: string[]; installed?: Record<string, unknown> }>(
    'GET',
    `/api/skills/hub/search?q=${encodeURIComponent(q)}&source=all&limit=30`,
    undefined,
    45_000,
  )
  const installed = await api<Installed[]>('GET', '/api/skills')
  const mine = new Map(installed.map((s) => [s.name, s]))
  return { results: r.results.map((h) => fromHub(h, r.installed?.[h.identifier] ? mine.get(h.name) : undefined)), timedOut: r.timed_out ?? [] }
}

/** Текст SKILL.md без шапки YAML: встановленої — з диска, з каталогу — попередній перегляд. */
export async function skillText(id: string, installed: boolean): Promise<string> {
  const text = installed
    ? (await api<{ content: string }>('GET', `/api/skills/content?name=${encodeURIComponent(id)}`)).content
    : ((await api<{ skill_md?: string }>('GET', `/api/skills/hub/preview?identifier=${encodeURIComponent(id)}`, undefined, 45_000)).skill_md ?? '')
  return text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
}

/** Після змін: Hermes оновлює slash-команди, а наступний хід моделі вже бачить нову навичку. */
async function changed() {
  await gateway.rpc('skills.reload', {}, 30_000).catch(() => {})
  emit({ type: 'plugins' })
}

export async function installSkill(identifier: string) {
  try {
    await gateway.rpc('skills.manage', { action: 'install', query: identifier }, 180_000)
  } catch (err) {
    throw rpcFailure(err, 'Hermes не встановив навичку')
  } finally {
    await changed()
  }
}

export async function toggleSkill(name: string, enabled: boolean) {
  await api('PUT', '/api/skills/toggle', { name, enabled })
  await changed()
}

/** Видалити можна лише навичку з каталогу; Hermes робить це фоновою дією, тож чекаємо на її завершення. */
export async function uninstallSkill(name: string) {
  const installed = await api<Installed[]>('GET', '/api/skills')
  const s = installed.find((x) => x.name === name)
  if (!s) throw new HttpError(404, 'Такої навички немає')
  if (s.provenance !== 'hub') throw new HttpError(400, 'Видалити можна лише навичку з каталогу; цю можна вимкнути')
  const { name: action } = await api<{ name: string }>('POST', '/api/skills/hub/uninstall', { name })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000))
    const st = await api<{ running: boolean; exit_code: number | null; lines?: string[] }>('GET', `/api/actions/${seg(action)}/status?lines=6`)
    if (st.running) continue
    await changed()
    if (st.exit_code) throw new HttpError(400, (st.lines ?? []).join('\n').trim() || 'Hermes не видалив навичку')
    return
  }
  throw new HttpError(504, 'Hermes видаляє навичку надто довго; перевір за хвилину')
}
