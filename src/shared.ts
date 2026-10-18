// Типи, спільні для сервера й клієнта. Без імпортів: файл читає і Node (type stripping), і Vite.

export type MessageStatus = 'queued' | 'running' | 'stopping' | 'done' | 'error' | 'cancelled' | 'interrupted'

export type Attachment = {
  id: string
  name: string
  mime: string
  size: number
}

/** Одна подія з ходу виконання задачі Hermes, у порядку появи. */
export type Part =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool'
      id: string
      tool: string
      preview: string
      status: 'running' | 'done' | 'error'
      duration?: number
      result?: string
    }
  | {
      type: 'approval'
      promptId: string
      generation: number
      command: string
      description: string
      choices: string[]
      state: 'pending' | 'answered' | 'settled'
      choice?: string
    }
  | {
      type: 'clarify'
      promptId: string
      generation: number
      question: string
      choices: string[]
      multi: boolean
      state: 'pending' | 'answered' | 'settled'
      answer?: string
    }
  | { type: 'subagent'; id: string; goal: string; status: 'running' | 'done' | 'error'; summary?: string; duration?: number }
  | { type: 'steer'; text: string }

export type Usage = { input_tokens?: number; output_tokens?: number; total_tokens?: number }

export type Message = {
  id: string
  chatId: string
  role: 'user' | 'assistant'
  /** Текст користувача або фінальна відповідь Hermes. */
  text: string
  attachments: Attachment[]
  parts: Part[]
  status: MessageStatus
  error: string | null
  usage: Usage | null
  model: string | null
  createdAt: number
  finishedAt: number | null
}

export type ModelChoice = { provider: string; model: string; effort?: string } | null

export type Chat = {
  id: string
  title: string
  pinned: boolean
  model: ModelChoice
  createdAt: number
  updatedAt: number
  running: boolean
}

export type ModelOptions = {
  current: { provider: string; model: string }
  providers: { slug: string; name: string; models: string[]; reasoning: Record<string, boolean> }[]
}

/** Повідомлення серверної SSE-шини /api/events. */
export type ServerEvent =
  | { type: 'message'; message: Message }
  | { type: 'chat'; chat: Chat }
  | { type: 'chat-deleted'; chatId: string }
