import type { Attachment, Chat, Message, ModelChoice, ModelOptions } from './shared.ts'

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
  patchChat: (id: string, patch: { title?: string; pinned?: boolean; model?: ModelChoice }) =>
    req<Chat>('PATCH', `/api/chats/${id}`, patch),
  deleteChat: (id: string) => req('DELETE', `/api/chats/${id}`),
  send: (body: { chatId?: string; text: string; attachments: string[]; model?: ModelChoice }) =>
    req<{ chat: Chat; messages: Message[] }>('POST', '/api/messages', body),
  stop: (messageId: string) => req('POST', `/api/messages/${messageId}/stop`),
  steer: (messageId: string, text: string) => req('POST', `/api/messages/${messageId}/steer`, { text }),
  approval: (messageId: string, promptId: string, generation: number, value: string) =>
    req('POST', `/api/messages/${messageId}/approval`, { promptId, generation, value }),
  clarify: (messageId: string, promptId: string, generation: number, value: string) =>
    req('POST', `/api/messages/${messageId}/clarify`, { promptId, generation, value }),
  models: () => req<ModelOptions>('GET', '/api/models'),
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

export const uploadUrl = (id: string) => `/api/uploads/${id}`
