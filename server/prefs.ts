// Налаштування чату, спільні для всіх пристроїв: режим і модель нових чатів, особисті інструкції, автоназви.
import type { ChatMode, ChatPrefs, ModelChoice } from '../src/shared.ts'
import { getSetting, setSetting } from './db.ts'
import { PUBLIC_HOST } from './config.ts'

/** Правила чату для Hermes: Markdown, файли через MEDIA:, нотатки Obsidian. Додаються до кожного запиту. */
const CHAT_INSTRUCTIONS = [
  `You are talking to the user through their private web chat (${PUBLIC_HOST}), which renders Markdown.`,
  'To deliver a file to the user (audio you synthesized, an image, video, PDF, document, archive, anything),',
  'put a line `MEDIA:/absolute/path/to/file` in your final answer, one line per file. The chat attaches the file',
  'to your message: audio and video get a player, images a preview, other files a download card.',
  'Do not paste the bare path or file contents instead, and do not explain how to open the file.',
  'Any size is fine (even many GB): large files are not copied, the user downloads the original by a temporary link,',
  'so never compress, split or move a file just to send it. Point MEDIA: at the file where it already is.',
  'Files the user attaches are saved on this computer and listed with absolute paths in their message.',
  'When you create or mention a note in the Obsidian vault, refer to it by its path from the vault root in backticks',
  '(e.g. `Gaming/Note name.md`) or as [[Note name]]: the chat turns it into a clickable note card.',
].join(' ')

const DEFAULTS: ChatPrefs = { defaultMode: 'auto', defaultModel: null, instructions: '', autoTitles: true }
const MODES: ChatMode[] = ['ask', 'auto', 'plan']

export function chatPrefs(): ChatPrefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(getSetting('chat_prefs') ?? '{}') as Partial<ChatPrefs>) }
  } catch {
    return DEFAULTS
  }
}

function cleanModel(v: unknown): ModelChoice {
  if (!v || typeof v !== 'object') return null
  const m = v as Record<string, unknown>
  const provider = typeof m.provider === 'string' ? m.provider.slice(0, 80) : ''
  const model = typeof m.model === 'string' ? m.model.slice(0, 160) : ''
  const effort = typeof m.effort === 'string' && /^[a-z]{2,10}$/.test(m.effort) ? m.effort : undefined
  return model || effort ? { provider, model, ...(effort ? { effort } : {}) } : null
}

export function updateChatPrefs(patch: Record<string, unknown>): ChatPrefs {
  const next = chatPrefs()
  if (MODES.includes(patch.defaultMode as ChatMode)) next.defaultMode = patch.defaultMode as ChatMode
  if ('defaultModel' in patch) next.defaultModel = cleanModel(patch.defaultModel)
  if (typeof patch.instructions === 'string') next.instructions = patch.instructions.trim().slice(0, 4000)
  if (typeof patch.autoTitles === 'boolean') next.autoTitles = patch.autoTitles
  setSetting('chat_prefs', JSON.stringify(next))
  return next
}

/** Інструкції для Hermes: правила чату плюс особисті побажання користувача. */
export function chatInstructions(): string {
  const own = chatPrefs().instructions
  return own ? `${CHAT_INSTRUCTIONS}\n\nОсобисті побажання користувача до відповідей у цьому чаті: ${own}` : CHAT_INSTRUCTIONS
}
