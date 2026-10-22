import { ApiError, request } from './http.ts'
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
  Extension,
  ExtensionResult,
  Plugin,
  PluginAuthFlow,
  PluginTest,
  SettingsInfo,
  ShareInfo,
  ShareListItem,
  SharedChat,
  Skill,
  StorageInfo,
} from './shared.ts'

/** Hermes перепідключить сервери зараз чи після відповіді, що зараз іде. */
export type PluginChange = { reload: 'now' | 'after-run' }

const req = <T>(method: string, path: string, body?: unknown) => request<T>(method, path, { body })

export const api = {
  me: () => req<{ username: string }>('GET', '/api/me'),
  login: (username: string, password: string) => req('POST', '/api/login', { username, password }),
  logout: () => req('POST', '/api/logout'),
  chats: () => req<Chat[]>('GET', '/api/chats'),
  chat: (id: string) => req<{ chat: Chat; messages: Message[] }>('GET', `/api/chats/${id}`),
  patchChat: (id: string, patch: { title?: string; pinned?: boolean; model?: ModelChoice; mode?: ChatMode; listId?: string | null; muted?: boolean }) =>
    req<Chat>('PATCH', `/api/chats/${id}`, patch),
  deleteChat: (id: string) => req('DELETE', `/api/chats/${id}`),
  markRead: (id: string) => req('POST', `/api/chats/${id}/read`),
  send: (body: { chatId?: string; text: string; attachments: string[]; model?: ModelChoice; mode?: ChatMode; listId?: string }) =>
    req<{ chat: Chat; messages: Message[] }>('POST', '/api/messages', body),
  stop: (messageId: string) => req('POST', `/api/messages/${messageId}/stop`),
  steer: (messageId: string, text: string) => req('POST', `/api/messages/${messageId}/steer`, { text }),
  btw: (messageId: string, text: string) => req('POST', `/api/messages/${messageId}/btw`, { text }),
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
  jobsMeta: () => req<{ timezone: string; configured: boolean }>('GET', '/api/jobs/meta'),
  job: (id: string) => req<Job>('GET', `/api/jobs/${id}`),
  createJob: (body: JobInput) => req<Job>('POST', '/api/jobs', body),
  updateJob: (id: string, body: Partial<JobInput> & { enabled?: boolean }) => req<Job>('PATCH', `/api/jobs/${id}`, body),
  deleteJob: (id: string) => req('DELETE', `/api/jobs/${id}`),
  jobAction: (id: string, action: 'pause' | 'resume' | 'run') => req<Job>('POST', `/api/jobs/${id}/${action}`),
  plugins: () => req<Plugin[]>('GET', '/api/plugins'),
  installPlugin: (name: string, env: Record<string, string> = {}) => req<PluginChange>('POST', `/api/plugins/${encodeURIComponent(name)}/install`, { env }),
  setPluginEnabled: (name: string, enabled: boolean) => req<PluginChange>('PUT', `/api/plugins/${encodeURIComponent(name)}/enabled`, { enabled }),
  removePlugin: (name: string) => req<PluginChange>('DELETE', `/api/plugins/${encodeURIComponent(name)}`),
  testPlugin: (name: string) => req<PluginTest>('POST', `/api/plugins/${encodeURIComponent(name)}/test`),
  startPluginAuth: (name: string) => req<PluginAuthFlow>('POST', `/api/plugins/${encodeURIComponent(name)}/auth`),
  pluginFlow: (id: string) => req<PluginAuthFlow>('GET', `/api/plugins/flows/${id}`),
  finishPluginFlow: (id: string, url: string) => req<PluginAuthFlow>('POST', `/api/plugins/flows/${id}/callback`, { url }),
  cancelPluginFlow: (id: string) => req('DELETE', `/api/plugins/flows/${id}`),
  translate: (texts: string[]) => req<{ translations: string[] }>('POST', '/api/translate', { texts }),
  extensions: () => req<Extension[]>('GET', '/api/extensions'),
  extension: (name: string) => req<Extension>('GET', `/api/extensions/${encodeURIComponent(name)}`),
  installExtension: (name: string) => req<ExtensionResult>('POST', `/api/extensions/${encodeURIComponent(name)}/install`),
  setExtensionEnabled: (name: string, enabled: boolean) => req<ExtensionResult>('PUT', `/api/extensions/${encodeURIComponent(name)}/enabled`, { enabled }),
  updateExtension: (name: string, accept = false) => req<ExtensionResult>('POST', `/api/extensions/${encodeURIComponent(name)}/update`, { accept }),
  configureExtension: (name: string, values: Record<string, unknown>) => req<Extension>('PUT', `/api/extensions/${encodeURIComponent(name)}/settings`, { values }),
  removeExtension: (name: string) => req('DELETE', `/api/extensions/${encodeURIComponent(name)}`),
  skills: () => req<Skill[]>('GET', '/api/skills'),
  searchSkills: (q: string) => req<{ results: Skill[]; timedOut: string[] }>('GET', `/api/skills/search?q=${encodeURIComponent(q)}`),
  skillText: (id: string, installed: boolean) => req<{ text: string }>('GET', `/api/skills/text?id=${encodeURIComponent(id)}&installed=${installed ? 1 : 0}`),
  installSkill: (id: string) => req('POST', '/api/skills/install', { id }),
  setSkillEnabled: (name: string, enabled: boolean) => req('PUT', '/api/skills/enabled', { name, enabled }),
  uninstallSkill: (name: string) => req('POST', '/api/skills/uninstall', { name }),
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
  publicShare: (token: string) => req<SharedChat>('GET', `/api/public/share/${token}`),
  upload: (file: File) =>
    request<Attachment>('POST', '/api/uploads', {
      raw: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
    }),
}

export { ApiError }

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
