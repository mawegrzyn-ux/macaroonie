// An order flow prompt's look per channel (ask.look, shared/pos/orderFlows.js
// normalisePromptLook() / promptStyle()): saved tidied through PUT
// /api/pos/order-flows/:id (a look that is the channel's standard one isn't
// stored, pictures only on our own site or https, colours a theme colour or
// a code); each channel gets only its own look (a till's settings.flows, a
// kiosk's, the online page's); a till's config carries the brand colours
// (a location's own Brand & theme when it has one) and the pictures of the
// dishes its prompts offer; the designer's catalogue sends the themes, the
// kiosk designs most used first. Never another group's.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { linkDevice } from './support/devices.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { menuSaveBody } from '../src/routes/menus.js'
import { promptLookDefault } from '../../shared/pos/orderFlows.js'
import { configImages } from '../../shared/kiosk.js'
import { themeColours, BRAND_DEFAULTS } from '../src/services/themeColours.js'

let ids, owner, viewer, other, V, V2, menuId
let till, till2, kiosk, lemonade, cola, shake, flow, bold

async function device(d, method, url) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: { authorization: `Device ${d.device_id}.${d.secret}`, [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET },
  })
  assert.equal(res.statusCode, 200, res.body)
  return res.json()
}
const guest = as(null, null)
const flowBody = (f, changes = {}) => ({
  name: f.name, on: f.on, kind: f.kind, trigger: f.trigger, apps: f.apps,
  venue_ids: f.venue_ids, till_ids: f.till_ids, kiosk_ids: f.kiosk_ids,
  match: f.match, ask: f.ask, adds: f.adds, ...changes,
})
const putLook = (look, f = flow) => owner.put('/api/pos/order-flows/' + f.id, flowBody(f, { ask: { ...f.ask, look } }))
const flowIn = (config, id = flow.id) => (config.settings.flows || []).find(x => x.id === id)

// What the owner sends (untidy), and what is kept.
const SENT = {
  till: {
    header: { style: 'band', align: 'center', image_url: 'javascript:alert(1)' },
    colours: { header: 'primary', cards: '#ABCDEF', title: 'pink', window: 'url(x)' },
    background: { image_url: '/uploads/zql back.jpg', shade: 200 },
    dishes: 'rows', pictures: true, extra: 1,
  },
  // The kiosks' standard look: nothing to keep.
  kiosk: { header: { style: 'plain', align: 'center' }, background: { shade: 40 }, dishes: 'cards', pictures: true },
  online: { header: { style: 'picture', image_url: '/uploads/zql-top.jpg' }, dishes: 'cards', colours: { button: 'accent' } },
}
const noColours = { window: null, header: null, title: null, text: null, cards: null, button: null }
const TILL = {
  header: { style: 'band', align: 'center', image_url: null },
  background: { image_url: null, shade: 90 },
  dishes: 'rows', pictures: true,
  colours: { ...noColours, header: 'primary', cards: '#abcdef' },
}
const ONLINE = {
  header: { style: 'picture', align: 'left', image_url: '/uploads/zql-top.jpg' },
  background: { image_url: null, shade: 40 },
  dishes: 'cards', pictures: true,
  colours: { ...noColours, button: 'accent' },
}
const KIOSK = {
  header: { style: 'picture', align: 'center', image_url: 'https://cdn.example.com/zql-kiosk.jpg' },
  background: { image_url: '/uploads/zql-kiosk-back.jpg', shade: 60 },
  dishes: 'rows', pictures: false,
  colours: { ...noColours, window: 'surface', text: 'text' },
}

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  await fillTenant(B.owner, ids.b, { mark: 'Yyl', slug: 'yyl' })
  owner = as(A.owner, ids.a)
  viewer = as(A.viewer, ids.a)
  other = as(B.owner, ids.b)
  V = filled.ids.venue
  V2 = filled.ids.venue2
  menuId = filled.ids.menu
  // Drinks: a lemonade and a shake with pictures, a cola without one.
  const tree = await ok(owner.get('/api/menus/' + menuId))
  const body = menuSaveBody(tree)
  body.sections.push({ title: 'Zql Drinks', items: [
    { name: 'Zql Lemonade', price_pence: 300, is_orderable: true, image_url: '/uploads/zql-lemonade.jpg' },
    { name: 'Zql Cola', price_pence: 250, is_orderable: true },
    { name: 'Zql Shake', price_pence: 450, is_orderable: true, image_url: '/uploads/zql-shake.jpg' },
  ] })
  await ok(owner.patch('/api/menus/' + menuId, body), 'menu')
  await ok(owner.post(`/api/menus/${menuId}/publish`, {}), 'publish')
  const menu = await ok(owner.get('/api/menus/' + menuId))
  const named = n => menu.sections.flatMap(s => s.items).find(i => i.name === n)
  lemonade = named('Zql Lemonade')
  cola = named('Zql Cola')
  shake = named('Zql Shake')
  assert.ok(lemonade && cola && shake, 'the drinks')
  // The brand, and Hertford (V2) with a Brand & theme of its own.
  await ok(owner.patch('/api/website/tenant-site', { theme: { colors: { primary: '#1d4ed8', background: '#fffdf7', text: '#111111' } } }), 'brand')
  await ok(owner.post('/api/website/config', { venue_id: V2 }), 'website config at Hertford')
  await ok(owner.patch(`/api/website/config?venue_id=${V2}`, { use_brand_override: true, theme: { colors: { primary: '#0f766e' } } }), 'own brand')
  const setup = await ok(owner.get(`/api/pos/venues/${V}/setup`))
  const stream = setup.revenue_streams.find(r => r.is_active)
  till = await linkDevice(owner, V, { kind: 'terminal', name: 'Zql Till' })
  till2 = await linkDevice(owner, V2, { kind: 'terminal', name: 'Zql Hertford till' })
  // A kiosk design of its own for the new kiosk; the fixtures' kiosk keeps the first design.
  bold = await ok(owner.post('/api/pos/kiosk-designs', { name: 'Zql Bold', settings: { brand: { colors: { primary: '#7c3aed' } } } }), 'design')
  kiosk = await linkDevice(owner, V, { kind: 'kiosk', name: 'Zql Kiosk', settings: { revenue_stream_id: stream.id, design_id: bold.id } })
  await linkDevice(owner, V, { kind: 'kiosk', name: 'Zql Kiosk 2', settings: { revenue_stream_id: stream.id, design_id: bold.id } })
  // No design of its own: it uses the group's first design.
  await linkDevice(owner, V, { kind: 'kiosk', name: 'Zql Kiosk 3', settings: { revenue_stream_id: stream.id } })
  const made = await ok(owner.post('/api/pos/order-flows', { name: 'Zql Drink', kind: 'ask' }))
  flow = await ok(owner.put('/api/pos/order-flows/' + made.id, flowBody(made, {
    on: true, apps: ['till', 'kiosk', 'online'], trigger: 'dish_added',
    ask: { ...made.ask, title: 'Zql A drink?', item_ids: [lemonade.id, cola.id], pick: 'one' },
  })), 'flow')
})
after(closeApp)

test('a look is kept per channel, tidied; the standard look is not kept', async () => {
  const saved = await ok(putLook(SENT), 'look')
  assert.deepEqual(saved.ask.look, { till: TILL, kiosk: null, online: ONLINE })
  const again = await ok(owner.get('/api/pos/order-flows/' + flow.id))
  assert.deepEqual(again.ask.look, { till: TILL, kiosk: null, online: ONLINE })
  // Every channel back to its standard look: no look at all.
  const plain = await ok(putLook({ till: promptLookDefault('till'), kiosk: promptLookDefault('kiosk'), online: null }))
  assert.equal(plain.ask.look, undefined)
  assert.equal((await ok(owner.get('/api/pos/order-flows/' + flow.id))).ask.look, undefined)
  // A viewer can't change it.
  const refused = await viewer.put('/api/pos/order-flows/' + flow.id, flowBody(flow, { ask: { ...flow.ask, look: SENT } }))
  assert.equal(refused.status, 403)
  flow = await ok(putLook({ ...SENT, kiosk: KIOSK }))
  assert.deepEqual(flow.ask.look, { till: TILL, kiosk: KIOSK, online: ONLINE })
})

test('each channel gets only its own look', async () => {
  const t = await device(till, 'GET', '/pos-api/config')
  assert.deepEqual(flowIn(t).ask.look, { till: TILL })
  const k = await device(kiosk, 'GET', '/pos-api/config')
  assert.deepEqual(flowIn(k).ask.look, { kiosk: KIOSK })
  // The kiosk keeps its prompt's pictures for offline use, not the website's.
  const pics = configImages(k, 'https://kiosk.test')
  assert.ok(pics.includes('https://kiosk.test/uploads/zql-kiosk-back.jpg'), 'the kiosk background picture is saved')
  assert.ok(!pics.includes('https://kiosk.test/uploads/zql-top.jpg'), 'the online header picture is not')
  const page = await ok(guest.get(`/order-api/venues/${V}`))
  const online = page.flows.list.find(x => x.id === flow.id)
  assert.deepEqual(online.ask.look, { online: ONLINE })
})

test("a till's config: the brand colours and the offered dishes' pictures", async () => {
  const t = await device(till, 'GET', '/pos-api/config')
  assert.equal(t.theme_colors.primary, '#1d4ed8')
  assert.equal(t.theme_colors.background, '#fffdf7')
  assert.equal(t.theme_colors.text, '#111111')
  assert.match(t.theme_colors.surface, /^#[0-9a-f]{6}$/, 'the rest from the defaults')
  const me = await ok(owner.get('/api/me'))
  assert.deepEqual(t.theme_colors, me.site_theme, 'the same colours the admin shows')
  // Hertford's own Brand & theme.
  const t2 = await device(till2, 'GET', '/pos-api/config')
  assert.equal(t2.theme_colors.primary, '#0f766e')
  // Pictures only for the dishes a till prompt offers.
  assert.equal(t.items[lemonade.id].image_url, '/uploads/zql-lemonade.jpg')
  assert.equal(t.items[cola.id].image_url, null)
  assert.equal(t.items[shake.id].image_url, undefined, 'a dish no till prompt offers has no picture on the till')
  // Not on tills: the till leaves the pictures out (it still knows the flow, as every flow, for its rules).
  const notTills = await ok(owner.put('/api/pos/order-flows/' + flow.id, flowBody(flow, { apps: ['kiosk', 'online'] })))
  const t3 = await device(till, 'GET', '/pos-api/config')
  assert.equal(t3.items[lemonade.id].image_url, undefined)
  flow = await ok(owner.put('/api/pos/order-flows/' + flow.id, flowBody(notTills, { apps: ['till', 'kiosk', 'online'] })))
})

test('brand colours: a code of three digits is read as six; anything else falls back', () => {
  const c = themeColours({ colors: { primary: '#0AF', accent: 'red', text: ' #111111 ', muted: '#12345' } }, null, '#ABCDEF')
  assert.equal(c.primary, '#00aaff', '#0AF is #00aaff')
  assert.equal(c.accent, '#abcdef', 'not a code: the old secondary colour column')
  assert.equal(c.text, '#111111')
  assert.equal(c.muted, BRAND_DEFAULTS.muted, 'five digits: the default')
  assert.equal(c.background, BRAND_DEFAULTS.background)
})

test("the designer's catalogue: the brand, the kiosk designs most used first, dish pictures", async () => {
  const cat = await ok(owner.get('/api/pos/order-flows/catalog'))
  assert.equal((await viewer.get('/api/pos/order-flows/catalog')).status, 403, 'no Store tech, no catalogue')
  assert.equal(cat.themes.brand.primary, '#1d4ed8')
  const [first, ...rest] = cat.themes.kiosk
  assert.equal(first.id, bold.id)
  assert.equal(first.name, 'Zql Bold')
  assert.equal(first.used_by, 2)
  assert.equal(first.colours.primary, '#7c3aed')
  // The fixtures' design: the first one, used by the kiosk with none of its own.
  const firstMade = rest.find(d => d.name === 'Zqx Kiosk')
  assert.ok(firstMade, JSON.stringify(cat.themes.kiosk.map(d => d.name)))
  assert.equal(firstMade.used_by, 1)
  assert.ok(rest.every(d => d.used_by <= first.used_by))
  assert.deepEqual(Object.keys(first.colours).sort(), ['accent', 'background', 'muted', 'primary', 'surface', 'text'])
  const items = cat.menus.flatMap(m => m.sections.flatMap(s => s.items))
  assert.equal(items.find(i => i.id === lemonade.id).image_url, '/uploads/zql-lemonade.jpg')
  assert.equal(items.find(i => i.id === cola.id).image_url, null)
  // Another group sees its own, never these.
  const theirs = await ok(other.get('/api/pos/order-flows/catalog'))
  assert.ok(!theirs.themes.kiosk.some(d => d.id === bold.id || d.name === 'Zql Bold'))
  assert.notEqual(theirs.themes.brand.primary, '#1d4ed8')
  const peek = await other.get('/api/pos/order-flows/' + flow.id)
  assert.equal(peek.status, 404)
})
