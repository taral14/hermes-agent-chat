import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

// db.ts відкриває базу в DATA_DIR під час імпорту: лише тимчасова тека, ніколи не справжні дані.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chat-test-'))
const media = await import('../server/media.ts')
const { importFile } = media
const { getUpload, UPLOAD_DIR } = await import('../server/db.ts')

describe('файли від Hermes', () => {
  test('копія в сховище йде у фоні, а доти файл віддається з оригіналу', async () => {
    const src = join(mkdtempSync(join(tmpdir(), 'hermes-out-')), 'report.md')
    writeFileSync(src, '# Звіт\n')
    const a = importFile(src)
    assert.equal(a.name, 'report.md')
    assert.equal(a.ref, undefined)
    assert.equal(getUpload(a.id)!.path, src)
    for (let i = 0; i < 50 && getUpload(a.id)!.path === src; i++) await new Promise((r) => setTimeout(r, 10))
    const copied = getUpload(a.id)!.path
    assert.ok(copied.startsWith(UPLOAD_DIR), copied)
    assert.equal(readFileSync(copied, 'utf8'), '# Звіт\n')
  })
})

describe('шляхи у відповіді Hermes', () => {
  const { extractMedia } = media
  // Чат повертає справжній шлях (на macOS /var — посилання на /private/var).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hermes-files-')))
  const zip = join(dir, 'cards.zip')
  const note = join(dir, 'SKILL.md')
  writeFileSync(zip, 'PK')
  writeFileSync(note, '# skill')

  test('шлях у кінці речення стає вкладенням', () => {
    const r = extractMedia(`Архів готовий: ${zip}`)
    assert.deepEqual(r.paths, [zip])
    assert.equal(r.text, 'Архів готовий:')
  })
  test('у лапках коду й з крапкою наприкінці теж', () => {
    assert.deepEqual(extractMedia(`Зберіг у \`${zip}\`.`).paths, [zip])
  })
  test('текстовий файл наприкінці речення — звіт про роботу, не вкладення', () => {
    const r = extractMedia(`Оновив ${note}`)
    assert.deepEqual(r.paths, [])
    assert.equal(r.text, `Оновив ${note}`)
  })
  test('неіснуючий файл лишається текстом', () => {
    assert.deepEqual(extractMedia(`Готово: ${join(dir, 'nope.zip')}`).paths, [])
  })
})
