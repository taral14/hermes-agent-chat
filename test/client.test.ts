import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { emit, on } from '../src/bus.ts'
import { linkifyNotes } from '../src/kb.ts'
import { looksEnglish } from '../src/lang.ts'
import { cardedUrls, dropCardedUrls } from '../src/links.ts'
import { matches, pluginTitle } from '../src/plugins.ts'
import { chatUrl, jobsUrl, kbUrl, parseRoute, pluginsUrl } from '../src/router.ts'
import type { KbNote, Plugin } from '../src/shared.ts'

describe('маршрути', () => {
  test('адреса ↔ маршрут', () => {
    assert.deepEqual(parseRoute('/'), { kind: 'chat', id: null })
    assert.deepEqual(parseRoute('/c/abc_123'), { kind: 'chat', id: 'abc_123' })
    assert.deepEqual(parseRoute('/jobs'), { kind: 'jobs', jobs: { kind: 'list' } })
    assert.deepEqual(parseRoute('/jobs/new'), { kind: 'jobs', jobs: { kind: 'new' } })
    assert.deepEqual(parseRoute('/kb/graph', '?focus=A%2FB.md'), { kind: 'kb', kb: { kind: 'graph', focus: 'A/B.md' } })
    assert.deepEqual(parseRoute('/kb/n/%D0%9F%D0%B0%D0%BF%D0%BA%D0%B0/Note.md'), { kind: 'kb', kb: { kind: 'note', path: 'Папка/Note.md' } })
    assert.deepEqual(parseRoute('/plugins'), { kind: 'plugins', tab: 'services', id: null })
    assert.deepEqual(parseRoute('/plugins/wordpress-com'), { kind: 'plugins', tab: 'services', id: 'wordpress-com' })
    assert.deepEqual(parseRoute('/plugins/skills'), { kind: 'plugins', tab: 'skills', id: null })
    assert.deepEqual(parseRoute('/plugins/extensions/web%2Ffirecrawl'), { kind: 'plugins', tab: 'extensions', id: 'web/firecrawl' })
  })
  test('маршрут → адреса', () => {
    assert.equal(chatUrl(null), '/')
    assert.equal(jobsUrl({ kind: 'job', id: 'x1' }), '/jobs/x1')
    assert.equal(kbUrl({ kind: 'note', path: 'Папка/Note.md' }), '/kb/n/%D0%9F%D0%B0%D0%BF%D0%BA%D0%B0/Note.md')
    assert.equal(pluginsUrl('services', 'hugging_face'), '/plugins/hugging_face')
    assert.equal(pluginsUrl('skills', 'official/research/arxiv'), '/plugins/skills/official%2Fresearch%2Farxiv')
    assert.equal(pluginsUrl('extensions'), '/plugins/extensions')
  })
})

describe('плагіни', () => {
  test('назва для людини', () => {
    assert.equal(pluginTitle('notion'), 'Notion')
    assert.equal(pluginTitle('n8n-official'), 'n8n')
    assert.equal(pluginTitle('local-youtube-stt'), 'Local youtube stt')
  })
  test('кнопку «Перекласти» мають лише англійські тексти', () => {
    assert.ok(looksEnglish('Pages and databases from your Notion workspace.'))
    assert.ok(!looksEnglish('Озвучення українською (HolosTTS).'))
    assert.ok(!looksEnglish('MCP 2.0'))
  })
  test('пошук за назвою, описом і доменом', () => {
    const p = { name: 'hugging_face', description: 'Models and datasets', host: 'huggingface.co' } as Plugin
    assert.ok(matches(p, 'hugging face'))
    assert.ok(matches(p, 'DATASETS'))
    assert.ok(matches(p, 'huggingface.co'))
    assert.ok(!matches(p, 'notion'))
  })
})

describe('шина подій', () => {
  test('emit каже, чи хтось обробив', () => {
    assert.equal(emit('job', 'x'), false)
    let got = ''
    const off = on('job', (id) => (got = id))
    assert.equal(emit('job', 'abc'), true)
    assert.equal(got, 'abc')
    off()
    assert.equal(emit('job', 'x'), false)
  })
})

describe('згадки нотаток у відповіді', () => {
  const note = (path: string, title = path.split('/').pop()!.replace(/\.md$/, '')) => ({ path, title }) as KbNote
  const notes = [note('Gaming/Kirby.md'), note('AI/Agents/Harness.md'), note('Inbox.md')]

  test('шлях, [[назва]] і `код` стають посиланнями', () => {
    const out = linkifyNotes('Див. Gaming/Kirby.md, [[Harness]] і `AI/Agents/Harness.md`.', notes, 'Vault')
    assert.match(out, /\[Kirby\]\(kbnote:Gaming%2FKirby\.md\)/)
    assert.match(out, /\[Harness\]\(kbnote:AI%2FAgents%2FHarness\.md\)/)
    assert.equal(out.match(/kbnote:/g)?.length, 3)
  })
  test('повний шлях до сховища з пробілами', () => {
    const out = linkifyNotes('Записав у ~/Library/Mobile Documents/Vault/Gaming/Kirby.md', notes, 'Vault')
    assert.match(out, /\[Kirby\]\(kbnote:Gaming%2FKirby\.md\)$/)
  })
  test('блоки коду й наявні посилання не чіпаємо', () => {
    const text = '```\nGaming/Kirby.md\n```\n[тут](https://x.dev/Gaming/Kirby.md)'
    assert.equal(linkifyNotes(text, notes, 'Vault'), text)
  })
  test('неоднозначна назва лишається текстом', () => {
    assert.equal(linkifyNotes('[[Kirby]]', [...notes, note('Other/Kirby.md')], 'Vault'), '[[Kirby]]')
  })
})

describe('посилання, що стали картками', () => {
  const imdb = 'https://www.imdb.com/title/tt49058294/'
  test('у кінці рядка — прибираємо, картка його показує', () => {
    assert.equal(dropCardedUrls(`Це короткометражка: ${imdb}`, [imdb]), 'Це короткометражка:')
    assert.equal(dropCardedUrls(`Дивись ${imdb}.`, [imdb]), 'Дивись')
    assert.equal(dropCardedUrls(`Перший абзац.\n\n${imdb}\n\nДругий.`, [imdb]), 'Перший абзац.\n\nДругий.')
    assert.equal(dropCardedUrls(imdb, [imdb]), '')
  })
  test('посеред речення, у коді, у списку й без картки — лишаємо', () => {
    assert.equal(dropCardedUrls(`Ось ${imdb} і ще текст`, [imdb]), `Ось ${imdb} і ще текст`)
    assert.equal(dropCardedUrls(`- ${imdb}`, [imdb]), `- ${imdb}`)
    assert.equal(dropCardedUrls(`\`\`\`\ncurl ${imdb}\n\`\`\``, [imdb]), `\`\`\`\ncurl ${imdb}\n\`\`\``)
    assert.equal(dropCardedUrls(`Дивись ${imdb}`, []), `Дивись ${imdb}`)
    assert.equal(dropCardedUrls(`Дивись [IMDb](${imdb})`, [imdb]), `Дивись [IMDb](${imdb})`)
  })
  test('три й більше посилань у відповіді — «Джерела», а не картки', () => {
    assert.deepEqual(cardedUrls(`a https://a.com/1 b https://b.com/2`), ['https://a.com/1', 'https://b.com/2'])
    assert.deepEqual(cardedUrls(`https://a.com/1 https://b.com/2 https://c.com/3`), [])
  })
})

test('кілька посилань із картками в кінці рядка прибираємо всі', () => {
  assert.equal(dropCardedUrls('А ці дві: https://a.com/1 https://b.com/2', ['https://a.com/1', 'https://b.com/2']), 'А ці дві:')
  assert.equal(dropCardedUrls('Ось https://a.com/1 https://b.com/2', ['https://b.com/2']), 'Ось https://a.com/1')
})
