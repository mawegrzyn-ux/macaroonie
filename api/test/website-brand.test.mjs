// Saving the group's Brand identity and Brand & theme once a location has
// website settings. Both saves used to blank the template on every
// location's website_config, a NOT NULL column, so they failed with a 500,
// and they stripped colours and fonts from locations with their own brand.
import test from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, PLATFORM } from './support/seed.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'

/** One file (plus fields) as multipart/form-data, sent as the owner of ids.a. */
async function upload(url, { name, type, data, fields = {} }) {
  const boundary = '----test' + Math.random().toString(16).slice(2)
  const parts = []
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n`
    + (type ? `Content-Type: ${type}\r\n` : '') + '\r\n'))
  parts.push(data, Buffer.from(`\r\n--${boundary}--\r\n`))
  const app = await getApp()
  const res = await app.inject({
    method: 'POST', url, payload: Buffer.concat(parts),
    headers: {
      authorization: 'Bearer test:' + A.owner, 'x-tenant-id': ids.a,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
    },
  })
  let json = null
  try { json = res.json() } catch { json = null }
  return { status: res.statusCode, json }
}

/** A small .ico holding one 32 x 32 picture (the picture bytes don't matter here). */
function icoFile() {
  const pic = Buffer.alloc(40, 7)
  const head = Buffer.alloc(22)
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4)
  head[6] = 32; head[7] = 32; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12)
  head.writeUInt32LE(pic.length, 14); head.writeUInt32LE(22, 18)
  return Buffer.concat([head, pic])
}

let ids, owner, ware, hertford

const OWN_THEME = {
  colors: { primary: '#123456', background: '#fefefe' },
  typography: { heading_font: 'Fraunces', body_font: 'Inter' },
}

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  ware = await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))
  hertford = await ok(owner.post('/api/venues', { name: 'Hertford', slug: 'hertford', timezone: 'Europe/London' }))
  await ok(owner.post('/api/website/config', { venue_id: ware.id }))
  await ok(owner.post('/api/website/config', { venue_id: hertford.id }))
  // Hertford has its own Brand & theme.
  await ok(owner.patch(`/api/website/config?venue_id=${hertford.id}`, {
    use_brand_override: true, template_key: 'modern', font_family: 'Fraunces', theme: OWN_THEME,
  }))
})
test.after(closeApp)

test('Brand identity saves with the template and font', async () => {
  const saved = await ok(owner.patch('/api/website/brand-defaults', {
    brand_name: null, site_name: 'Thai House', tagline: 'Delicious', logo_url: '/uploads/logo.png',
    favicon_url: null, primary_colour: '#630812', secondary_colour: null,
    font_family: 'Space Grotesk', template_key: 'modern', og_image_url: null,
  }), 'brand identity save')
  assert.equal(saved.template_key, 'modern')
  assert.equal(saved.font_family, 'Space Grotesk')
})

test('Brand & theme saves with the template', async () => {
  const saved = await ok(owner.patch('/api/website/tenant-site', {
    template_key: 'classic',
    theme: { colors: { primary: '#aa0000', background: '#ffffff' }, typography: { heading_font: 'Space Grotesk', body_font: 'Inter' } },
  }), 'theme save')
  assert.equal(saved.template_key, 'classic')
  assert.equal(saved.theme.colors.primary, '#aa0000')
})

test('Brand & theme saves the theme alone', async () => {
  const saved = await ok(owner.patch('/api/website/tenant-site', {
    theme: { colors: { primary: '#bb0000', background: '#ffffff' } },
  }), 'theme only save')
  assert.equal(saved.theme.colors.primary, '#bb0000')
})

test('a platform admin saves a group they are not a member of', async () => {
  const pa = as(PLATFORM, ids.a)
  await ok(pa.patch('/api/website/brand-defaults', { site_name: 'From the platform', template_key: 'classic' }), 'platform save')
})

test("a location's own brand is untouched by the group's saves", async () => {
  const [h] = await sql`SELECT template_key, font_family, theme FROM website_config WHERE venue_id = ${hertford.id}`
  assert.equal(h.template_key, 'modern')
  assert.equal(h.font_family, 'Fraunces')
  assert.deepEqual(h.theme.colors, OWN_THEME.colors)
  assert.deepEqual(h.theme.typography, OWN_THEME.typography)
})

test('a favicon can be an .ico file, whatever type the browser gives it', async () => {
  for (const type of ['image/x-icon', 'image/vnd.microsoft.icon', 'application/octet-stream']) {
    const r = await upload('/api/website/upload', { name: 'favicon.ico', type, data: icoFile(), fields: { kind: 'images', scope: 'website' } })
    assert.equal(r.status, 201, `website upload as ${type}: ${JSON.stringify(r.json)}`)
    assert.equal(r.json.mimetype, 'image/x-icon')
    assert.match(r.json.url, /\.ico$/)
    assert.ok(r.json.media_item_id, 'shows in the Media library')
  }
  const saved = await ok(owner.patch('/api/website/brand-defaults', { favicon_url: '/uploads/x/images/favicon.ico' }))
  assert.equal(saved.favicon_url, '/uploads/x/images/favicon.ico')
})

test('an .ico in the Media library gets its size from the file', async () => {
  const r = await upload('/api/media/items/upload', { name: 'favicon.ico', type: 'image/x-icon', data: icoFile() })
  assert.equal(r.status, 201, JSON.stringify(r.json))
  assert.equal(r.json.mimetype, 'image/x-icon')
  assert.equal(r.json.width, 32)
  assert.equal(r.json.height, 32)
})

test('files that only claim to be .ico, and other types, are refused', async () => {
  const fake = await upload('/api/website/upload', { name: 'favicon.ico', type: 'image/x-icon', data: Buffer.from('<script>alert(1)</script> padding padding') })
  assert.equal(fake.status, 422)
  assert.match(fake.json.error, /isn't an \.ico/)
  const fakeMedia = await upload('/api/media/items/upload', { name: 'x.ico', type: 'application/octet-stream', data: Buffer.from('not an icon at all, just words here') })
  assert.equal(fakeMedia.status, 422)
  const avif = await upload('/api/website/upload', { name: 'logo.avif', type: 'image/avif', data: Buffer.from('avif') })
  assert.equal(avif.status, 422)
  assert.match(avif.json.error, /JPG, PNG, WebP, SVG, GIF or ICO/)
  // A file with no useful type and no .ico name isn't taken as an icon.
  const bin = await upload('/api/website/upload', { name: 'logo.bin', type: 'application/octet-stream', data: icoFile() })
  assert.equal(bin.status, 422)
})
