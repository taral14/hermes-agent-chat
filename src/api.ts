import type {
  Attachment,
  Chat,
  ChatList,
  ChatMode,
  ChatPrefs,
  Job,
  JobChatInfo,
  JobRun,
  LinkPreview,
  Message,
  ModelChoice,
  ModelOptions,
  SettingsInfo,
  ShareInfo,
  ShareListItem,
  SharedChat,
  StorageInfo,
} from './shared.ts'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login') window.dispatchEvent(new Event('chat:unauthorized'))
    throw new ApiError(res.status, data.error ?? `Помилка ${res.status}`)
  }
  return data as T
}

export const api = {
  me: () => req<{ username: string }>('GET', '/api/me'),
  login: (username: string, password: string) => req('POST', '/api/login', { username, password }),
  logout: () => req('POST', '/api/logout'),
  chats: () => req<Chat[]>('GET', '/api/chats'),
  chat: (id: string) => req<{ chat: Chat; messages: Message[] }>('GET', `/api/chats/${id}`),
  patchChat: (id: string, patch: { title?: string; pinned?: boolean; model?: ModelChoice; mode?: ChatMode; listId?: string | null }) =>
    req<Chat>('PATCH', `/api/chats/${id}`, patch),
  deleteChat: (id: string) => req('DELETE', `/api/chats/${id}`),
  send: (body: { chatId?: string; text: string; attachments: string[]; model?: ModelChoice; mode?: ChatMode; listId?: string }) =>
    req<{ chat: Chat; messages: Message[] }>('POST', '/api/messages', body),
  stop: (messageId: string) => req('POST', `/api/messages/${messageId}/stop`),
  steer: (messageId: string, text: string) => req('POST', `/api/messages/${messageId}/steer`, { text }),
  approval: (messageId: string, promptId: string, generation: number, value: string) =>
    req('POST', `/api/messages/${messageId}/approval`, { promptId, generation, value }),
  clarify: (messageId: string, promptId: string, generation: number, value: string) =>
    req('POST', `/api/messages/${messageId}/clarify`, { promptId, generation, value }),
  models: () => req<ModelOptions>('GET', '/api/models'),
  retry: (messageId: string) => req<{ chat: Chat; messages: Message[] }>('POST', `/api/messages/${messageId}/retry`),
  edit: (messageId: string, text: string) => req<{ chat: Chat; messages: Message[] }>('POST', `/api/messages/${messageId}/edit`, { text }),
  branch: (messageId: string) => req<{ chatId: string }>('POST', `/api/messages/${messageId}/branch`),
  commands: () => req<CommandInfo[]>('GET', '/api/commands'),
  control: (chatId: string, command: string) => req<{ output: string }>('POST', `/api/chats/${chatId}/control`, { command }),
  lists: () => req<ChatList[]>('GET', '/api/lists'),
  createList: (name: string) => req<ChatList>('POST', '/api/lists', { name }),
  renameList: (id: string, name: string) => req<ChatList[]>('PATCH', `/api/lists/${id}`, { name }),
  deleteList: (id: string) => req('DELETE', `/api/lists/${id}`),
  jobs: () => req<Job[]>('GET', '/api/jobs'),
  jobChats: () => req<JobChatInfo[]>('GET', '/api/jobs/chats'),
  job: (id: string) => req<Job>('GET', `/api/jobs/${id}`),
  createJob: (body: JobInput) => req<Job>('POST', '/api/jobs', body),
  updateJob: (id: string, body: Partial<JobInput> & { enabled?: boolean }) => req<Job>('PATCH', `/api/jobs/${id}`, body),
  deleteJob: (id: string) => req('DELETE', `/api/jobs/${id}`),
  jobAction: (id: string, action: 'pause' | 'resume' | 'run') => req<Job>('POST', `/api/jobs/${id}/${action}`),
  jobRuns: (id: string) => req<JobRun[]>('GET', `/api/jobs/${id}/runs`),
  runOutput: (sessionId: string) => req<{ output: string }>('GET', `/api/jobs/runs/${sessionId}`),
  settings: () => req<SettingsInfo>('GET', '/api/settings'),
  patchSettings: (patch: Partial<ChatPrefs>) => req<ChatPrefs>('PATCH', '/api/settings', patch),
  shares: () => req<ShareListItem[]>('GET', '/api/shares'),
  storage: () => req<StorageInfo>('GET', '/api/storage'),
  clearLinkCache: () => req<StorageInfo>('DELETE', '/api/storage/link-cache'),
  deleteAllChats: () => req<{ deleted: number }>('POST', '/api/chats/delete-all', { confirm: 'видалити' }),
  share: (chatId: string) => req<{ share: ShareInfo | null }>('GET', `/api/chats/${chatId}/share`),
  createShare: (chatId: string) => req<{ share: ShareInfo }>('POST', `/api/chats/${chatId}/share`),
  deleteShare: (chatId: string) => req<{ share: null }>('DELETE', `/api/chats/${chatId}/share`),
  publicShare: async (token: string): Promise<SharedChat> => {
    const res = await fetch(`/api/public/share/${token}`)
    const data = (await res.json().catch(() => ({}))) as SharedChat & { error?: string }
    if (!res.ok) throw new ApiError(res.status, data.error ?? `Помилка ${res.status}`)
    return data
  },
  async upload(file: File): Promise<Attachment> {
    const res = await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
      body: file,
      credentials: 'same-origin',
    })
    const data = (await res.json().catch(() => ({}))) as Attachment & { error?: string }
    if (!res.ok) throw new ApiError(res.status, data.error ?? `Помилка ${res.status}`)
    return data
  },
}

export type CommandInfo = { name: string; description: string; hint?: string; skill?: boolean }

export type JobInput = { name: string; prompt: string; schedule: string; deliver: string; repeat?: number | null }

let filesBase = '/api/uploads'
/** Сторінка спільного чату: файли беруться через токен посилання, без входу. */
export function setPublicFiles(token: string) {
  filesBase = `/api/public/share/${token}/file`
}
export const isPublicView = () => filesBase !== '/api/uploads'
export const uploadUrl = (id: string) => `${filesBase}/${id}`

const previews = new Map<string, Promise<LinkPreview>>()
/** Картка посилання (кеш на сторінку: однакові посилання питаємо раз). */
export function unfurl(url: string): Promise<LinkPreview> {
  let p = previews.get(url)
  if (!p) {
    p = req<LinkPreview>('GET', `/api/unfurl?url=${encodeURIComponent(url)}`).catch(() => ({ url, kind: 'link' as const, failed: true }))
    previews.set(url, p)
  }
  return p
}
