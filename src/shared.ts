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
      /** Дозволено автоматично (налаштування «Дозволяти все»). */
      auto?: boolean
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
  /** Результат слеш-команди (/status, /usage тощо) або службова примітка Hermes. */
  | { type: 'notice'; text: string }

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
  /** Повідомлення має свій хід у Hermes: його можна повторити чи відгалузити. */
  turn?: boolean
}

export type ModelChoice = { provider: string; model: string; effort?: string } | null

/** Стан автоматизацій сесії Hermes: мета (/goal), петля (/loop), серцебиття (/heartbeat). */
export type ChatControl = {
  goal?: { title: string; status: string; turns_used?: number; max_turns?: number } | null
  loop?: Record<string, unknown> | null
  heartbeat?: Record<string, unknown> | null
} | null

/** Режим чату, як у Claude Code: питати дозволу, дозволяти все або лише складати план. */
export type ChatMode = 'ask' | 'auto' | 'plan'

export type Chat = {
  id: string
  title: string
  pinned: boolean
  model: ModelChoice
  createdAt: number
  updatedAt: number
  running: boolean
  /** Чат працює через рідний протокол Hermes (команди, повтор, редагування, відгалуження). */
  native?: boolean
  control?: ChatControl
  mode: ChatMode
}

export type ModelOptions = {
  current: { provider: string; model: string }
  providers: { slug: string; name: string; models: string[]; reasoning: Record<string, boolean> }[]
}

export type JobSchedule =
  | { kind: 'cron'; expr: string; display?: string }
  | { kind: 'interval'; minutes: number; display?: string }
  | { kind: 'once'; run_at: string; display?: string }

/** Задача за розкладом Hermes (cron). Поля як у /api/jobs Hermes. */
export type Job = {
  id: string
  name: string
  prompt: string
  schedule: JobSchedule
  schedule_display?: string
  enabled: boolean
  state: string
  paused_at: string | null
  next_run_at: string | null
  last_run_at: string | null
  last_status: string | null
  last_error: string | null
  last_delivery_error: string | null
  deliver: string
  origin: { platform?: string; chat_name?: string } | null
  repeat: { times: number | null; completed: number }
  no_agent?: boolean
  script?: string | null
  skills?: string[]
  created_at?: string
}

export type JobRun = {
  sessionId: string
  title: string
  startedAt: number
  endedAt: number | null
  endReason: string | null
  messages: number
  tools: number
}

/** Які сповіщення отримує пристрій. */
export type PushSettings = { replies: boolean; prompts: boolean; jobs: boolean }

/** Повідомлення серверної SSE-шини /api/events. */
export type ServerEvent =
  | { type: 'message'; message: Message }
  | { type: 'chat'; chat: Chat }
  | { type: 'chat-deleted'; chatId: string }
