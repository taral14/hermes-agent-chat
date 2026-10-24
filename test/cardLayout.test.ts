import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cardLayout, imageSize, isGenericImage } from '../server/cardLayout.ts'

describe('картинка картки посилання', () => {
  it('заставки сайту не показуємо', () => {
    for (const image of [
      'https://example.com/img/og-image.png',
      'https://example.com/static/social-share.jpg',
      'https://example.com/assets/logo.png',
      'https://example.com/craft_og.png',
      'https://example.com/images/blog-thumbnail-default.png',
      'https://opengraph.githubassets.com/abc/owner/repo',
      'https://cdn.example.com/resize/?url=https%3A%2F%2Fexample.com%2Fsite-logo.jpg',
    ])
      assert.equal(isGenericImage(image), true, image)
    for (const image of [
      'https://example.com/uploads/2026/10/review-header.jpg',
      'https://cdn.example.com/dims4/default/abc/photo.jpg',
      'https://example.com/blog/hero.webp',
    ])
      assert.equal(isGenericImage(image), false, image)
  })

  it('головна сторінка — без картинки', () => {
    assert.equal(cardLayout({ url: 'https://example.com/', image: 'https://example.com/hero.jpg', width: 1200, height: 630 }), null)
  })

  it('широке фото статті — велике, обкладинка чи квадрат — мініатюрою', () => {
    const page = 'https://example.com/news/1'
    assert.equal(cardLayout({ url: page, image: 'https://example.com/a.jpg', width: 1200, height: 630, card: 'summary' }), 'large')
    assert.equal(cardLayout({ url: page, image: 'https://example.com/a.jpg', width: 1000, height: 1250 }), 'thumb')
    assert.equal(cardLayout({ url: page, image: 'https://example.com/a.jpg', width: 1200, height: 1200 }), 'thumb')
    assert.equal(cardLayout({ url: page, image: 'https://example.com/a.jpg', width: 250, height: 140 }), 'thumb')
  })

  it('без розміру — за типом сторінки', () => {
    const page = 'https://example.com/news/1'
    assert.equal(cardLayout({ url: page, image: 'https://example.com/a.jpg', type: 'article' }), 'large')
    assert.equal(cardLayout({ url: page, image: 'https://example.com/a.jpg', card: 'summary_large_image' }), 'large')
    assert.equal(cardLayout({ url: page, image: 'https://example.com/a.jpg', type: 'website' }), 'thumb')
  })

  it('розмір картинки за її початком', () => {
    const png = Buffer.alloc(24)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(1200, 16)
    png.writeUInt32BE(630, 20)
    assert.deepEqual(imageSize(png), { width: 1200, height: 630 })
    const gif = Buffer.from('GIF89a\x40\x01\xf0\x00', 'latin1')
    assert.deepEqual(imageSize(gif), { width: 320, height: 240 })
    // JPEG: SOI, APP0 довжиною 16, SOF0 з висотою 600 і шириною 800.
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03])])
    assert.deepEqual(imageSize(jpg), { width: 800, height: 600 })
    assert.equal(imageSize(Buffer.from('<html>')), null)
  })
})
