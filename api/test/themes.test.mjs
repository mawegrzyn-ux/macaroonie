// The theme maker (POST /api/ai/themes): Pepper's themes from a picture and
// words against a stand-in Claude (support/fake-claude.mjs). What reaches
// Claude, every theme made readable on the way back, the picture checks,
// permissions per target, Pepper switched off, errors, usage, other tenants.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { contrast } = await import('../../shared/themeKit.js')

const URL = '/api/ai/themes'
// A 1 x 1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
let ids

const theme = (over = {}) => ({
  name: 'Sunlit market', about: 'Warm and bright.',
  colors: { background: '#fffaf0', surface: '#ffffff', text: '#2b1d14', muted: '#7a6a5c', border: '#eadfce', primary: '#c0392b', primary_text: '#ffffff', accent: '#f4b400', accent_text: '#2b1d14' },
  heading_font: 'Fraunces', body_font: 'Inter', script_font: 'Caveat', display_font: '', shape: 'soft', heading_case: 'normal',
  ...over,
})
const reply = (themes, notes = 'Took the red from the logo.') => () => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify({ notes, themes }) }],
  usage: { input_tokens: 3000, output_tokens: 700 },
})
const lastBody = () => claude.requests[claude.requests.length - 1].body
const requestOf = body => {
  const text = body.messages[0].content.find(b => b.type === 'text').text
  return JSON.parse(text.slice(text.indexOf('{')))
}

test.before(async () => {
  ids = await resetAndSeed()
  await sql`
    INSERT INTO tenant_site (tenant_id, brand_name, tagline) VALUES (${ids.a}, 'Zqx Thai', 'Street food')
    ON CONFLICT (tenant_id) DO UPDATE SET brand_name = EXCLUDED.brand_name, tagline = EXCLUDED.tagline
  `
})
test.after(async () => { await claude.close(); await closeApp() })

test('a picture and words: Claude gets the picture, the measured colours and the brand; themes come back readable', async () => {
  claude.script.push(reply([
    theme(),
    // Hard to read on purpose: grey text on grey, white on yellow, a font not on the list.
    theme({ name: 'Dark night', colors: { background: '#777777', surface: '#808080', text: '#888888', muted: '#777777', border: '#999999', primary: '#ffe600', primary_text: '#ffffff', accent: '#00ff00', accent_text: '#ffffff' }, heading_font: 'Comic Sans', display_font: 'Oswald', shape: 'round', heading_case: 'upper' }),
    theme({ name: 'Third' }),
  ]))
  const before = await sql`SELECT coalesce(sum(requests), 0)::int AS n FROM ai_usage WHERE tenant_id = ${ids.a}`
  const res = await as(A.owner, ids.a).post(URL, {
    target: 'website', prompt: 'Warm, family-run, a bit retro',
    image: { media_type: 'image/png', data: PNG },
    palette: [{ hex: '#c0392b', share: 0.6 }, { hex: '#ffffff', share: 0.4 }],
  })
  assert.equal(res.status, 200, res.body)
  assert.equal(res.json.kits.length, 3)
  assert.equal(res.json.notes, 'Took the red from the logo.')

  const body = lastBody()
  const image = body.messages[0].content.find(b => b.type === 'image')
  assert.equal(image.source.media_type, 'image/png')
  assert.equal(image.source.data, PNG)
  const req = requestOf(body)
  assert.equal(req.count, 3)
  assert.match(req.designing_for, /website/)
  assert.equal(req.request, 'Warm, family-run, a bit retro')
  assert.deepEqual(req.measured_colours, [{ hex: '#c0392b', share: 0.6 }, { hex: '#ffffff', share: 0.4 }])
  assert.deepEqual(req.brand, { name: 'Zqx Thai', tagline: 'Street food' })
  assert.equal(body.output_config.format.type, 'json_schema')
  assert.ok(body.output_config.format.schema.properties.themes)

  const [first, dark] = res.json.kits
  assert.equal(first.name, 'Sunlit market')
  assert.equal(first.source, 'ai')
  assert.equal(first.colors.primary, '#c0392b', 'readable colours are kept as given')
  assert.equal(first.fonts.heading, 'Fraunces')
  const c = dark.colors
  assert.ok(contrast(c.text, c.background) >= 4.5, 'text made readable')
  assert.ok(contrast(c.text, c.surface) >= 4.5, 'text on cards made readable')
  assert.ok(contrast(c.primary_text, c.primary) >= 4.5, 'button words made readable')
  assert.ok(contrast(c.accent_text, c.accent) >= 4.5, 'accent words made readable')
  assert.notEqual(dark.fonts.heading, 'Comic Sans', 'a font not on the list is replaced')
  assert.equal(dark.fonts.display, 'Oswald')
  assert.equal(dark.shape, 'round')
  assert.equal(dark.heading_case, 'upper')

  const after = await sql`SELECT coalesce(sum(requests), 0)::int AS n FROM ai_usage WHERE tenant_id = ${ids.a}`
  assert.equal(after[0].n, before[0].n + 1, 'counted towards the allowance')
})

test('the picture is checked: its real type is used, other files and empty requests are refused', async () => {
  claude.script.push(reply([theme()]))
  const labelled = await ok(as(A.owner, ids.a).post(URL, { target: 'kiosk', image: { media_type: 'image/jpeg', data: PNG }, count: 1 }))
  assert.equal(labelled.kits.length, 1)
  const body = lastBody()
  assert.equal(body.messages[0].content[0].source.media_type, 'image/png', 'the bytes decide the type')
  assert.match(requestOf(body).request, /no words/)
  assert.match(requestOf(body).designing_for, /kiosk/)

  const sent = claude.requests.length
  const text = await as(A.owner, ids.a).post(URL, { target: 'website', image: { media_type: 'image/png', data: Buffer.from('just some words, not a picture').toString('base64') } })
  assert.equal(text.status, 422)
  assert.match(text.json.error, /picture/)
  const empty = await as(A.owner, ids.a).post(URL, { target: 'website', prompt: '   ' })
  assert.equal(empty.status, 422)
  const badTarget = await as(A.owner, ids.a).post(URL, { target: 'tablecloths', prompt: 'red' })
  assert.equal(badTarget.status, 400)
  assert.equal(claude.requests.length, sent, 'none of these reached Claude')
})

test('words only; the current theme and one they liked go along', async () => {
  claude.script.push(reply([theme(), theme({ name: 'Two' })]))
  const current = { name: 'Now', colors: { background: '#ffffff', text: '#111111', primary: '#225588' }, fonts: { heading: 'Inter', body: 'Inter' } }
  const like = { name: 'Liked', colors: { background: '#101010', text: '#f5f5f5', primary: '#e0a020' }, fonts: { heading: 'Oswald', body: 'Inter' } }
  const res = await ok(as(A.owner, ids.a).post(URL, { target: 'board', prompt: 'more like this', current, like, count: 2 }))
  assert.equal(res.kits.length, 2)
  const body = lastBody()
  assert.equal(body.messages[0].content.length, 1, 'no picture block')
  assert.match(body.messages[0].content[0].text, /^No picture this time/)
  const req = requestOf(body)
  assert.equal(req.count, 2)
  assert.equal(req.current.name, 'Now')
  assert.equal(req.like.name, 'Liked')
  assert.equal(req.like.colors.primary, '#e0a020')
  assert.match(req.designing_for, /menu screen/)

  // Only the number asked for comes back.
  claude.script.push(reply([theme(), theme(), theme()]))
  const one = await ok(as(A.owner, ids.a).post(URL, { target: 'print', prompt: 'classic bistro', count: 1 }))
  assert.equal(one.kits.length, 1)
  assert.match(requestOf(lastBody()).designing_for, /printed menu/)
})

test('who may make themes: Pepper and Manage on the page the theme is for', async () => {
  const sent = claude.requests.length
  // Operators view the website and screens by default, viewers neither.
  for (const [sub, target] of [[A.operator, 'website'], [A.operator, 'board'], [A.operator, 'kiosk'], [A.viewer, 'print'], [A.viewer, 'website']]) {
    const res = await as(sub, ids.a).post(URL, { target, prompt: 'bright' })
    assert.equal(res.status, 403, `${sub} ${target}: ${res.body}`)
  }
  assert.equal(claude.requests.length, sent)

  claude.script.push(reply([theme()]))
  const admin = await as(A.admin, ids.a).post(URL, { target: 'kiosk', prompt: 'bright', count: 1 })
  assert.equal(admin.status, 200, admin.body)

  // Pepper switched off for the group.
  await ok(as(A.owner, ids.a).patch('/api/ai/settings', { staff_enabled: false }))
  try {
    const off = await as(A.owner, ids.a).post(URL, { target: 'website', prompt: 'bright' })
    assert.equal(off.status, 403)
    assert.match(off.json.error, /switched off/)
  } finally {
    await ok(as(A.owner, ids.a).patch('/api/ai/settings', { staff_enabled: true }))
  }
})

test('errors: busy, refused, cut off, unreadable', async () => {
  claude.script.push(() => ({ status: 529, type: 'overloaded_error' }), () => ({ status: 529, type: 'overloaded_error' }), () => ({ status: 529, type: 'overloaded_error' }))
  const busy = await as(A.owner, ids.a).post(URL, { target: 'website', prompt: 'bright' })
  assert.equal(busy.status, 503)
  assert.match(busy.json.error, /busy/)

  claude.script.push(() => ({ stop_reason: 'refusal', content: [] }))
  const refused = await as(A.owner, ids.a).post(URL, { target: 'website', prompt: 'bright' })
  assert.equal(refused.status, 422)

  claude.script.push(() => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"notes":"' }] }))
  const cut = await as(A.owner, ids.a).post(URL, { target: 'website', prompt: 'bright' })
  assert.equal(cut.status, 502)

  claude.script.push(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here are some ideas!' }] }))
  const unreadable = await as(A.owner, ids.a).post(URL, { target: 'website', prompt: 'bright' })
  assert.equal(unreadable.status, 502)

  claude.script.push(() => ({ status: 400, type: 'invalid_request_error', message: 'Could not process image' }))
  const badPicture = await as(A.owner, ids.a).post(URL, { target: 'website', image: { media_type: 'image/png', data: PNG } })
  assert.equal(badPicture.status, 422)
  assert.match(badPicture.json.error, /picture/)
})

test('another group gets its own brand, never this one\'s', async () => {
  claude.script.push(reply([theme()]))
  await ok(as(B.owner, ids.b).post(URL, { target: 'website', prompt: 'bright', count: 1 }))
  const req = requestOf(lastBody())
  assert.notEqual(req.brand?.name, 'Zqx Thai')
  assert.ok(!JSON.stringify(req).includes('Street food'))
})
