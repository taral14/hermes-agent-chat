// Перший запуск: npm run setup. Створює config.yaml (логін і випадковий пароль) і .env з прикладу, якщо їх немає.
// Наявні файли не чіпає. Пароль показує один раз — збережи його в менеджері паролів.
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { CONFIG_FILE, ROOT } from '../server/config.ts'

const env = join(ROOT, '.env')
if (existsSync(env)) console.log('✓ .env уже є')
else {
  copyFileSync(join(ROOT, '.env.example'), env)
  console.log('✓ створено .env з .env.example — для доступу з телефона задай там PUBLIC_HOST')
}

if (existsSync(CONFIG_FILE)) console.log(`✓ ${CONFIG_FILE} уже є`)
else {
  const username = (process.argv[2] ?? userInfo().username).replace(/[^\w.-]/g, '') || 'me'
  const password = randomBytes(18).toString('base64url')
  writeFileSync(
    CONFIG_FILE,
    `# Вхід у чат. Не додавай у git.\nusername: ${username}\npassword: "${password}"\n# Аварійний вхід за паролем, якщо загубиш усі ключі доступу:\n# allow_password: true\n`,
    { mode: 0o600 },
  )
  console.log(`✓ створено ${CONFIG_FILE}`)
  console.log(`\n  Логін:  ${username}\n  Пароль: ${password}\n`)
  console.log('  Збережи пароль. Після першого входу додай ключ доступу (Face ID, Touch ID, YubiKey)')
  console.log('  у «Налаштування → Обліковий запис → Вхід і безпека» і вимкни вхід за паролем.')
}
console.log('\nДалі: npm run build && npm run doctor && npm start')
