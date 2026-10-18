// Задачі за розкладом Hermes (cron): проксі до /api/jobs і історія запусків із сесій `cron_<id>_*`.
import type { Job, JobRun } from '../src/shared.ts'
import { HermesError, call } from './hermes.ts'

export async function listJobs(): Promise<Job[]> {
  const r = await call<{ jobs: Job[] }>('GET', '/api/jobs?include_disabled=true')
  return r.jobs
}

export async function getJob(id: string): Promise<Job> {
  const r = await call<{ job: Job }>('GET', `/api/jobs/${encodeURIComponent(id)}`)
  return r.job
}

const FIELDS = ['name', 'schedule', 'prompt', 'deliver', 'repeat', 'enabled'] as const

function pick(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const k of FIELDS) if (body[k] !== undefined) out[k] = body[k]
  return out
}

export async function createJob(body: Record<string, unknown>): Promise<Job> {
  const r = await call<{ job: Job }>('POST', '/api/jobs', pick(body))
  return r.job
}

export async function updateJob(id: string, body: Record<string, unknown>): Promise<Job> {
  const r = await call<{ job: Job }>('PATCH', `/api/jobs/${encodeURIComponent(id)}`, pick(body))
  return r.job
}

export async function deleteJob(id: string) {
  await call('DELETE', `/api/jobs/${encodeURIComponent(id)}`)
}

export async function jobAction(id: string, action: 'pause' | 'resume' | 'run'): Promise<Job | null> {
  const r = await call<{ job?: Job }>('POST', `/api/jobs/${encodeURIComponent(id)}/${action}`, {})
  return r?.job ?? null
}

type SessionRow = {
  id: string
  title?: string | null
  started_at: number
  ended_at: number | null
  end_reason: string | null
  message_count: number
  tool_call_count: number
}

/** Останні запуски задачі. Hermes зберігає кожен як сесію з id `cron_<job>_<дата>`. */
export async function jobRuns(id: string, limit = 15): Promise<JobRun[]> {
  const prefix = `cron_${id}_`
  const runs: JobRun[] = []
  for (let offset = 0; offset < 1000 && runs.length < limit; offset += 200) {
    const r = await call<{ data: SessionRow[]; has_more?: boolean }>('GET', `/api/sessions?source=cron&limit=200&offset=${offset}`)
    for (const s of r.data) {
      if (!s.id.startsWith(prefix)) continue
      runs.push({
        sessionId: s.id,
        title: s.title ?? '',
        startedAt: s.started_at * 1000,
        endedAt: s.ended_at ? s.ended_at * 1000 : null,
        endReason: s.end_reason,
        messages: s.message_count,
        tools: s.tool_call_count,
      })
      if (runs.length >= limit) break
    }
    if (!r.has_more) break
  }
  return runs
}

/** Результат запуску — остання відповідь агента в його сесії. */
export async function runOutput(sessionId: string): Promise<string> {
  if (!/^cron_[\w-]+$/.test(sessionId)) throw new HermesError(400, 'Некоректний запуск')
  const r = await call<{ data: { role: string; content: unknown }[] }>(
    'GET',
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?inline_images=false`,
  )
  for (let i = r.data.length - 1; i >= 0; i--) {
    const m = r.data[i]!
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) return m.content
  }
  return ''
}
