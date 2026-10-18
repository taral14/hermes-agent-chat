// Типи, спільні для сервера й клієнта. Без імпортів: файл читає і Node (type stripping), і Vite.

export type MessageStatus = 'queued' | 'running' | 'stopping' | 'done' | 'error' | 'cancelled' | 'interrupted'

export type Attachment = {
  id: string
  name: string
  mime: string
  size: number
  /** Великий файл лишився на сервері (не скопійовано); віддається за шляхом через тимчасове посилання. */
  ref?: boolean
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
  /** Hermes надіслав це повідомлення сам: результат задачі за розкладом або send_message. */
  | { type: 'delivered'; source: 'cron' | 'hermes'; job?: string; jobId?: string }

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
  /** Список, до якого користувач додав чат. */
  listId?: string | null
  /** Задачі за розкладом, що доставляють результати в цей чат (deliver=webchat:<чат>). */
  jobs?: ChatJob[]
}

/** Задача за розкладом, прив'язана до чату. */
export type ChatJob = { id: string; name: string; enabled: boolean; schedule: string; nextRunAt: string | null }

/** Список чатів (як проєкти в ChatGPT). */
export type ChatList = { id: string; name: string; color: string; position: number }

export type ModelOptions = {
  current: { provider: string; model: string }
  /** Зусилля за замовчуванням у налаштуваннях Hermes (agent.reasoning_effort). */
  defaultEffort: string
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
  /** Чат, куди задача доставляє результати (deliver=webchat…); рахує чат-сервер. */
  chatId?: string | null
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
  | { type: 'lists'; lists: ChatList[] }
  /** Hermes змінив нотатки в базі знань. */
  | { type: 'kb'; paths: string[] }

// ---------- Налаштування ----------

/** Налаштування чату, спільні для всіх пристроїв (лежать на сервері). */
export type ChatPrefs = {
  /** Режим нових чатів. */
  defaultMode: ChatMode
  /** Модель і зусилля нових чатів; null — як у налаштуваннях Hermes. */
  defaultModel: ModelChoice
  /** Особисті інструкції: додаються до кожного запиту з чату. */
  instructions: string
  /** Hermes сам дає назви чатам; інакше назва — початок першого повідомлення. */
  autoTitles: boolean
}

export type SettingsInfo = {
  prefs: ChatPrefs
  about: { version: string; startedAt: number; hermes: boolean; vault: boolean; panelUrl: string }
}

export type StorageInfo = { files: number; bytes: number; macFiles: number; linkCache: number; dbBytes: number }

export type ShareListItem = { chatId: string; title: string; url: string; updatedAt: number }

// ---------- Посилання і спільний доступ ----------

/** Картка посилання: заголовок, опис і картинка зі сторінки (Open Graph), для YouTube — з oEmbed. */
export type LinkPreview = {
  url: string
  kind: 'link' | 'youtube'
  title?: string
  description?: string
  image?: string
  siteName?: string
  icon?: string
  videoId?: string
  channel?: string
  /** Сторінку не вдалося прочитати: показуємо просту картку з доменом. */
  failed?: boolean
}

export type SharedMessage = Pick<Message, 'id' | 'role' | 'text' | 'attachments' | 'createdAt' | 'model'>

/** Чат, яким поділились: знімок лише для перегляду. */
export type SharedChat = { title: string; sharedAt: number; messages: SharedMessage[]; previews: Record<string, LinkPreview> }

/** Стан посилання на чат для власника. */
export type ShareInfo = { token: string; url: string; upto: number; createdAt: number; updatedAt: number; count: number; newer: number }

// ---------- База знань ----------

export type KbNote = { path: string; title: string; folder: string; mtime: number; size: number; tags: string[] }

export type KbNoteFull = KbNote & {
  body: string
  frontmatter: Record<string, unknown> | null
  /** [[ціль]] → шлях нотатки або null, якщо такої ще немає. */
  links: Record<string, string | null>
  backlinks: { path: string; title: string; folder: string; snippet: string }[]
}
