// Задачі за розкладом (cron Hermes) і чати, у які вони пишуть.
import type { Job, JobChatInfo, Part } from '../../src/shared.ts'
import { deleteChat, getChat, listMessages } from '../db.ts'
import { emitChat } from '../events.ts'
import { HermesError } from '../hermes.ts'
import { type Ctx, HttpError, readJson, send } from '../http.ts'
import { newJobChat } from '../inbox.ts'
import { chatForJob, linkedChats, refreshJobLinks } from '../jobLinks.ts'
import { createJob, deleteJob, getJob, jobAction, jobRuns, listJobs, runOutput, updateJob } from '../jobs.ts'

/** Чати, у які пишуть задачі, з останнім результатом. */
function jobChats(): JobChatInfo[] {
  const out: JobChatInfo[] = []
  for (const id of linkedChats()) {
    const chat = getChat(id)
    if (!chat) continue
    const m = listMessages(id).findLast((x) => x.role === 'assistant' && (x.text.trim() || x.attachments.length))
    const d = m?.parts.find((p) => p.type === 'delivered') as Extract<Part, { type: 'delivered' }> | undefined
    const text = (m?.text ?? '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!?\[([^\]]*)]\([^)]*\)/g, '$1')
      .replace(/[*_`#>|~]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220)
    out.push({
      id,
      title: chat.title || 'Без назви',
      updatedAt: chat.updatedAt,
      last: m ? { text: text || `Файли: ${m.attachments.map((a) => a.name).join(', ')}`, at: m.createdAt, ...(d?.job ? { job: d.job } : {}) } : null,
    })
  }
  return out.sort((a, b) => (b.last?.at ?? b.updatedAt) - (a.last?.at ?? a.updatedAt))
}

type JobBody = { deliver?: unknown; name?: unknown }

/**
 * deliver «webchat:new» — створити задачі окремий чат і писати в нього. Чат з'являється лише тоді,
 * коли Hermes прийняв задачу: якщо відмовив, порожній чат прибираємо.
 */
async function withNewChat<T>(body: JobBody, name: () => Promise<string>, save: (body: JobBody) => Promise<T>): Promise<T> {
  const targets = typeof body.deliver === 'string' ? body.deliver.split(',').map((t) => t.trim()) : []
  if (!targets.includes('webchat:new')) return save(body)
  const id = newJobChat(typeof body.name === 'string' && body.name.trim() ? body.name : await name())
  try {
    const r = await save({ ...body, deliver: targets.map((t) => (t === 'webchat:new' ? `webchat:${id}` : t)).join(',') })
    emitChat(id)
    return r
  } catch (err) {
    deleteChat(id)
    throw err
  }
}

const withChat = (job: Job) => ({ ...job, chatId: chatForJob(job.id) })

/** Після зміни задачі: перечитати, куди пишуть задачі, і оновити зачеплені чати у вкладках. */
async function relink() {
  for (const id of await refreshJobLinks()) emitChat(id)
}

export async function jobRoutes({ req, res, path, method }: Ctx): Promise<boolean> {
  if (!path.startsWith('/api/jobs')) return false
  try {
    if (path === '/api/jobs' && method === 'GET') return send(res, 200, (await listJobs()).map(withChat))
    if (path === '/api/jobs/chats' && method === 'GET') {
      await refreshJobLinks()
      return send(res, 200, jobChats())
    }
    if (path === '/api/jobs' && method === 'POST') {
      const job = await withNewChat(await readJson<JobBody>(req), async () => 'Задача', createJob)
      // Зв'язок задачі з чатом має бути вже у відповіді.
      await relink()
      return send(res, 200, withChat(job))
    }
    const run = path.match(/^\/api\/jobs\/runs\/([\w-]+)$/)
    if (run && method === 'GET') return send(res, 200, { output: await runOutput(run[1]!) })
    const j = path.match(/^\/api\/jobs\/([\w-]+)(?:\/(runs|pause|resume|run))?$/)
    if (!j) return false
    const id = j[1]!
    const sub = j[2]
    if (!sub && method === 'GET') return send(res, 200, withChat(await getJob(id)))
    if (!sub && method === 'PATCH') {
      const body = await readJson<JobBody>(req)
      const job = await withNewChat(body, async () => (await getJob(id)).name, (b) => updateJob(id, b))
      await relink()
      return send(res, 200, withChat(job))
    }
    if (!sub && method === 'DELETE') {
      await deleteJob(id)
      await relink()
      return send(res, 200, { ok: true })
    }
    if (sub === 'runs' && method === 'GET') return send(res, 200, await jobRuns(id))
    if (sub && sub !== 'runs' && method === 'POST') {
      const job = (await jobAction(id, sub as 'pause' | 'resume' | 'run')) ?? (await getJob(id))
      await relink()
      return send(res, 200, withChat(job))
    }
    return false
  } catch (err) {
    if (err instanceof HermesError) throw new HttpError(err.status >= 400 && err.status < 500 ? err.status : 502, err.message)
    throw err
  }
}
