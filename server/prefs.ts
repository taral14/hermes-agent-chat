// Налаштування чату, спільні для всіх пристроїв: режим і модель нових чатів, особисті інструкції, автоназви.
import type { ChatMode, ChatPrefs, ModelChoice } from '../src/shared.ts'
import { getSetting, setSetting } from './db.ts'
import { CHAT_INSTRUCTIONS } from './media.ts'

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
