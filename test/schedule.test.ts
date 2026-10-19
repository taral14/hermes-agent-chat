import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { describeDraft, draftValid, fromDraft, plural, toDraft } from '../src/schedule.ts'

describe('plural', () => {
  test('українські форми', () => {
    assert.equal(plural(1, 'дія', 'дії', 'дій'), 'дія')
    assert.equal(plural(3, 'дія', 'дії', 'дій'), 'дії')
    assert.equal(plural(5, 'дія', 'дії', 'дій'), 'дій')
    assert.equal(plural(11, 'дія', 'дії', 'дій'), 'дій')
    assert.equal(plural(21, 'дія', 'дії', 'дій'), 'дія')
    assert.equal(plural(22, 'дія', 'дії', 'дій'), 'дії')
    assert.equal(plural(112, 'дія', 'дії', 'дій'), 'дій')
  })
})

describe('розклад ↔ чернетка', () => {
  const cron = (expr: string) => toDraft({ kind: 'cron', expr, display: expr })

  test('щодня, будні, дні тижня', () => {
    assert.deepEqual(cron('0 9 * * *'), { mode: 'daily', time: '09:00' })
    assert.deepEqual(cron('30 7 * * 1-5'), { mode: 'weekdays', time: '07:30' })
    // cron: 0 і 7 — неділя; у чернетці 0 — понеділок, 6 — неділя
    assert.deepEqual(cron('0 20 * * 0'), { mode: 'days', time: '20:00', days: [6] })
    assert.deepEqual(cron('0 20 * * 7'), { mode: 'days', time: '20:00', days: [6] })
  })

  test('туди й назад без змін', () => {
    for (const expr of ['0 9 * * *', '30 7 * * 1-5', '0 20 * * 1,3,5', '5 0 * * 0']) {
      const back = fromDraft(cron(expr))
      assert.deepEqual(cron(back), cron(expr), expr)
    }
  })

  test('складний cron лишається виразом', () => {
    assert.deepEqual(cron('15 8,12 * * *'), { mode: 'cron', expr: '15 8,12 * * *' })
  })

  test('інтервали', () => {
    assert.deepEqual(toDraft({ kind: 'interval', minutes: 120, display: '' }), { mode: 'interval', every: 2, unit: 'h' })
    assert.deepEqual(toDraft({ kind: 'interval', minutes: 2880, display: '' }), { mode: 'interval', every: 2, unit: 'd' })
    assert.equal(fromDraft({ mode: 'interval', every: 90, unit: 'm' }), 'every 90m')
  })

  test('одноразова задача має зсув поясу', () => {
    assert.match(fromDraft({ mode: 'once', at: '2030-03-01T09:00' }), /^2030-03-01T09:00:00[+-]\d{2}:\d{2}$/)
  })

  test('перевірка чернетки', () => {
    assert.equal(draftValid({ mode: 'days', time: '09:00', days: [] }), 'Обери хоча б один день')
    assert.equal(draftValid({ mode: 'once', at: '2000-01-01T09:00' }), 'Обери час у майбутньому')
    assert.equal(draftValid({ mode: 'cron', expr: '* *' }), 'Cron-вираз має 5 полів')
    assert.equal(draftValid({ mode: 'daily', time: '09:00' }), null)
  })

  test('опис людською мовою', () => {
    assert.equal(describeDraft({ mode: 'daily', time: '09:00' }), 'Щодня о 09:00')
    assert.equal(describeDraft({ mode: 'days', time: '08:00', days: [5, 6] }), 'На вихідних о 08:00')
  })
})
