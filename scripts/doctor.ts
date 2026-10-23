// Перевірка налаштування: npm run doctor. Нічого не змінює, лише каже, що готово, а що ні й як виправити.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  CONFIG_FILE,
  HERMES_AGENT_DIR,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_URL,
  IS_MAC,
  PORT,
  PUBLIC_HOST,
  PUBLIC_URL,
  ROOT,
  ROUTER_URL,
  VAULT_PATH,
  hermesPath,
} from '../server/config.ts'

const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, 'data')
/** Найстаріша версія Hermes Agent, з якою чат перевірено. */
const HERMES_TESTED = '0.22'
const [TESTED_MAJOR, TESTED_MINOR] = HERMES_TESTED.split('.').map(Number) as [number, number]
let problems = 0
const ok = (m: string) => console.log(`  ✓ ${m}`)
const warn = (m: string, fix?: string) => console.log(`  ⚠ ${m}${fix ? `\n      → ${fix}` : ''}`)
const fail = (m: string, fix: string) => {
  problems++
  console.log(`  ✗ ${m}\n      → ${fix}`)
}
const section = (t: string) => console.log(`\n${t}`)

section('Чат')
const [major, minor] = process.versions.node.split('.').map(Number) as [number, number]
if (major > 22 || (major === 22 && minor >= 18)) ok(`Node ${process.versions.node}`)
else fail(`Node ${process.versions.node}`, 'потрібен Node 22.18 або новіший (сервер — TypeScript без збирання)')
if (existsSync(join(ROOT, 'node_modules'))) ok('залежності встановлено')
else fail('немає node_modules', 'npm ci')
if (existsSync(join(ROOT, 'dist', 'index.html'))) ok('інтерфейс зібрано')
else fail('інтерфейс не зібрано', 'npm run build')
const cfgFile = CONFIG_FILE
if (!existsSync(cfgFile)) fail(`немає ${cfgFile} (логін і пароль)`, 'npm run setup')
else {
  const c = parseYaml(readFileSync(cfgFile, 'utf8')) as { username?: string; password?: string } | null
  if (!c?.username || !c?.password) fail('у config.yaml немає username чи password', 'задай обидва поля')
  else if (String(c.password).length < 12) warn('пароль коротший за 12 символів', 'краще довгий випадковий; після входу додай ключ доступу (Face ID) і вимкни пароль')
  else ok(`вхід: ${c.username}`)
}
if (existsSync(join(ROOT, '.env'))) ok('.env знайдено')
else warn('немає .env — працюють значення за замовчуванням', 'cp .env.example .env і заповни PUBLIC_HOST')
console.log(`    адреса: ${PUBLIC_URL} (сервер слухає порт ${PORT})`)
if (PUBLIC_HOST === 'localhost') warn('PUBLIC_HOST = localhost: чат відкриється лише на цьому комп’ютері', 'для телефона потрібен домен з HTTPS (Cloudflare Tunnel, Caddy тощо) і PUBLIC_HOST у .env')
if (ROUTER_URL) console.log(`    роутер: ${ROUTER_URL}`)

section(`Hermes (${HERMES_HOME})`)
if (!existsSync(HERMES_HOME)) fail('теки Hermes немає', 'встанови Hermes Agent або вкажи HERMES_HOME у .env')
else {
  ok('тека Hermes є')
  let key = ''
  try {
    key = /^API_SERVER_KEY=["']?([^"'\n]+)/m.exec(readFileSync(hermesPath('.env'), 'utf8'))?.[1] ?? ''
  } catch {
    /* немає .env */
  }
  if (key) ok('API_SERVER_KEY є в .env Hermes')
  else fail('у .env Hermes немає API_SERVER_KEY', 'увімкни API-сервер Hermes і задай API_SERVER_KEY (див. документацію Hermes)')
  try {
    const r = await fetch(`${HERMES_URL}/health`, { signal: AbortSignal.timeout(4000) })
    if (r.ok) ok(`API-сервер відповідає (${HERMES_URL})`)
    else fail(`API-сервер відповів ${r.status}`, 'перевір, що gateway Hermes запущено з API-сервером')
  } catch {
    fail(`API-сервер не відповідає (${HERMES_URL})`, 'запусти gateway Hermes: hermes gateway start')
  }
  if (existsSync(hermesPath('gateway.sock'))) ok('gateway.sock є (рідний протокол)')
  else fail('немає gateway.sock', 'gateway Hermes не запущено: hermes gateway start')
  if (!existsSync(HERMES_PYTHON)) fail(`немає Python Hermes: ${HERMES_PYTHON}`, 'задай HERMES_PYTHON або HERMES_AGENT_DIR у .env')
  else {
    try {
      execFileSync(HERMES_PYTHON, ['-c', 'import hermes_cli.gateway_client'], {
        env: { ...process.env, PYTHONPATH: HERMES_AGENT_DIR, HERMES_HOME },
        stdio: 'ignore',
        timeout: 20_000,
      })
      ok('міст до gateway імпортується')
    } catch {
      fail('Python Hermes не імпортує hermes_cli.gateway_client', 'онови Hermes Agent або перевір HERMES_AGENT_DIR')
    }
  }

  // Чат говорить внутрішнім протоколом gateway Hermes; перевірено з цією версією.
  let version = ''
  try {
    version = execFileSync('git', ['describe', '--tags'], { cwd: HERMES_AGENT_DIR, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    /* не git-копія */
  }
  const [vMajor = 0, vMinor = 0] = (/^v?(\d+)\.(\d+)/.exec(version)?.slice(1) ?? []).map(Number)
  if (!version) warn('версію Hermes не визначено', `чат перевірено з Hermes ${HERMES_TESTED}; з іншими версіями протокол gateway може відрізнятись`)
  else if (vMajor > TESTED_MAJOR || (vMajor === TESTED_MAJOR && vMinor >= TESTED_MINOR)) ok(`Hermes ${version}`)
  else fail(`Hermes ${version} старіший за ${HERMES_TESTED}`, 'онови Hermes Agent: hermes update')

  let tz = process.env.HERMES_TIMEZONE ?? ''
  try {
    tz ||= String((parseYaml(readFileSync(hermesPath('config.yaml'), 'utf8')) as { timezone?: unknown } | null)?.timezone ?? '')
  } catch {
    /* немає config.yaml */
  }
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (tz.trim()) ok(`часовий пояс розкладу: ${tz}`)
  else warn('у Hermes не задано часовий пояс: після переходу на літній чи зимовий час перший запуск задачі може зсунутись на годину', `додай timezone: ${local} у ${hermesPath('config.yaml')}`)
}

section('Hermes пише в чат (плагін webchat, необов’язково)')
const pluginCfg = hermesPath('plugins', 'webchat', 'config.json')
if (!existsSync(pluginCfg)) warn('плагін не встановлено: результати задач за розкладом не приходитимуть у чат', 'npm run setup:hermes')
else {
  const mine = join(DATA_DIR, '.hermes-hook-token')
  let cfg: { url?: string; token_file?: string } = {}
  try {
    cfg = JSON.parse(readFileSync(pluginCfg, 'utf8')) as typeof cfg
  } catch {
    /* зіпсований файл — нижче скажемо перевстановити */
  }
  if (!existsSync(mine)) warn('чат ще не запускався, ключа для плагіна немає', 'npm start, потім npm run setup:hermes')
  else if (!cfg.token_file || !existsSync(cfg.token_file) || readFileSync(cfg.token_file, 'utf8').trim() !== readFileSync(mine, 'utf8').trim())
    warn('плагін налаштовано на інший чат або без ключа', 'npm run setup:hermes')
  else ok(`плагін налаштовано на ${cfg.url}`)
}

section('База знань (Obsidian, необов’язково)')
if (!VAULT_PATH) console.log('    вимкнена: щоб увімкнути, задай VAULT_PATH у .env чату (шлях до сховища Obsidian)')
else {
  console.log(`    сховище: ${VAULT_PATH}`)
  let mirror = ''
  try {
    mirror = String((JSON.parse(readFileSync(join(DATA_DIR, 'vault', '.mirror.json'), 'utf8')) as { source?: unknown }).source ?? '')
  } catch {
    /* дзеркала немає */
  }
  if (mirror && resolve(mirror) === VAULT_PATH) ok('копія сховища для чату оновлюється (дзеркало)')
  else if (IS_MAC && VAULT_PATH.includes('/Library/Mobile Documents/')) warn('сховище в iCloud: служба чату туди не має доступу', 'npm run setup:vault-mirror (копія для чату)')
  else if (existsSync(VAULT_PATH)) ok('тека сховища є')
  else fail('теки сховища немає', 'перевір VAULT_PATH у .env чату')
}

console.log(problems ? `\nПроблем: ${problems}. Виправ позначене ✗ і запусти ще раз.` : '\nУсе готово. Запуск: npm start')
process.exit(problems ? 1 : 0)
