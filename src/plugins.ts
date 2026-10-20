// Плагіни (MCP-сервери Hermes) у вигляді для людини: назви, добірки, іконки, стани.
import {
  type SimpleIcon,
  siAirtable,
  siAlgolia,
  siAlltrails,
  siAsana,
  siAtlassian,
  siBetterstack,
  siBuildkite,
  siCalendly,
  siCircleci,
  siClickup,
  siCloudflare,
  siCloudinary,
  siDatadog,
  siDropbox,
  siFigma,
  siGitlab,
  siGrafana,
  siHuggingface,
  siIndeed,
  siIntercom,
  siLinear,
  siMiro,
  siMixpanel,
  siN8n,
  siNeon,
  siNetlify,
  siNotion,
  siPaypal,
  siPostman,
  siPrisma,
  siRailway,
  siRobinhood,
  siSentry,
  siSquare,
  siStrava,
  siStripe,
  siSupabase,
  siTodoist,
  siTrivago,
  siUnrealengine,
  siVercel,
  siWebflow,
  siWolfram,
  siWordpress,
} from 'simple-icons'
import type { Plugin, PluginStatus } from './shared.ts'

/** Гліфи брендів із simple-icons (решта — іконка з сайту сервісу або літера). */
export const BRAND_ICONS: Record<string, SimpleIcon> = {
  airtable: siAirtable,
  algolia: siAlgolia,
  alltrails: siAlltrails,
  asana: siAsana,
  atlassian: siAtlassian,
  betterstack: siBetterstack,
  buildkite: siBuildkite,
  calendly: siCalendly,
  circleci: siCircleci,
  clickup: siClickup,
  cloudflare: siCloudflare,
  cloudinary: siCloudinary,
  datadog: siDatadog,
  dropbox: siDropbox,
  figma: siFigma,
  gitlab: siGitlab,
  grafana: siGrafana,
  hugging_face: siHuggingface,
  indeed: siIndeed,
  intercom: siIntercom,
  linear: siLinear,
  miro: siMiro,
  mixpanel: siMixpanel,
  'n8n-official': siN8n,
  neon: siNeon,
  netlify: siNetlify,
  notion: siNotion,
  paypal: siPaypal,
  postman: siPostman,
  'prisma-postgres': siPrisma,
  railway: siRailway,
  robinhood: siRobinhood,
  sentry: siSentry,
  square: siSquare,
  strava: siStrava,
  stripe: siStripe,
  supabase: siSupabase,
  todoist: siTodoist,
  trivago: siTrivago,
  'unreal-engine': siUnrealengine,
  vercel: siVercel,
  webflow: siWebflow,
  wolfram: siWolfram,
  'wordpress-com': siWordpress,
}

const TITLES: Record<string, string> = {
  'aws-knowledge': 'AWS Knowledge',
  betterstack: 'Better Stack',
  circleci: 'CircleCI',
  clickup: 'ClickUp',
  'comfy-cloud': 'Comfy Cloud',
  context7: 'Context7',
  deepwiki: 'DeepWiki',
  gitlab: 'GitLab',
  hugging_face: 'Hugging Face',
  'microsoft-learn': 'Microsoft Learn',
  monday: 'monday.com',
  motherduck: 'MotherDuck',
  'n8n-official': 'n8n',
  paypal: 'PayPal',
  'prisma-postgres': 'Prisma Postgres',
  'twelve-data': 'Twelve Data',
  'twilio-docs': 'Twilio Docs',
  'unreal-engine': 'Unreal Engine',
  'wordpress-com': 'WordPress.com',
}

/** notion → Notion, local-youtube-stt → Local youtube stt. */
export function pluginTitle(name: string) {
  if (TITLES[name]) return TITLES[name]
  const words = name.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Добірка «Популярні» — сервіси, якими найчастіше користуються щодня. */
export const POPULAR = ['notion', 'linear', 'figma', 'atlassian', 'todoist', 'dropbox', 'canva', 'miro', 'stripe', 'calendly']

export const STATUS_TEXT: Record<PluginStatus, string> = {
  connected: 'Працює',
  connecting: 'Підключається',
  failed: 'Не підключився',
  needs_auth: 'Потрібен вхід',
  disabled: 'Вимкнено',
  idle: 'Ще не запускався',
}

/** Підпис у списку: опис із каталогу або, для свого сервера, звідки він. */
export function pluginSubtitle(p: Plugin) {
  if (p.description) return p.description
  return p.transport === 'stdio' ? 'Свій сервер на цьому комп’ютері' : p.host ? `Свій сервер · ${p.host}` : 'Свій сервер'
}

/** Поле, яке не варто показувати відкритим текстом. */
export const isSecretField = (name: string) => /secret|token|key|password/i.test(name)

/** Пошук за назвою, описом і доменом. */
export function matches(p: Plugin, q: string) {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return [p.name, pluginTitle(p.name), p.description, p.host ?? ''].some((x) => x.toLowerCase().includes(s))
}
