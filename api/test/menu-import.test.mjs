// A menu from a photo or PDF (/api/ai/menus/read and /import) against a
// stand-in Claude (support/fake-claude.mjs): what reaches Claude (the files,
// the group's own tags and option groups), what comes back cleaned, the file
// and permission checks, and the menu made from the checked sections (a
// draft, allergens matched to the group's tags, option groups found, made or
// kept apart), other tenants.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n').toString('base64')
let ids, venueA, venueB

const MENU = {
  name: 'Dinner', tagline: 'Street food from Bangkok', service_times: 'Tue-Sat 5-10pm', notes: 'The dessert prices were hard to read.',
  sections: [
    {
      title: 'Starters', subtitle: '',
      dishes: [
        { name: 'Chicken satay', description: 'Grilled skewers, peanut sauce', price: '£7.50', calories: '420', allergens: [{ name: 'Peanuts', level: 'contains' }, { name: 'Wheat', level: 'may_contain' }], dietary: [], options: [] },
        { name: 'Spring rolls', description: '', price: '6', calories: '', allergens: [], dietary: ['Vegan'], options: [{ group: 'Dips', mode: 'extra', choices: [{ name: 'Sweet chilli', price: '0.50' }] }] },
      ],
    },
    {
      title: 'Curries', subtitle: 'With jasmine rice',
      dishes: [
        { name: 'Green curry', description: 'Coconut, Thai basil', price: '12.95', calories: '', allergens: [{ name: 'Celery', level: 'contains' }], dietary: [], options: [{ group: 'Protein', mode: 'base', choices: [{ name: 'Chicken', price: '12.95' }, { name: 'Prawn', price: '14.50' }] }] },
        { name: 'Massaman', description: '', price: '', calories: '', allergens: [], dietary: [], options: [{ group: 'Size', mode: 'base', choices: [{ name: 'Small', price: '9' }, { name: 'Large', price: '13' }] }] },
        { name: 'Jungle curry', description: '', price: '', calories: '', allergens: [], dietary: [], options: [{ group: 'Size', mode: 'base', choices: [{ name: 'Small', price: '9' }, { name: 'Medium', price: '11' }] }] },
        { name: '  ', description: '', price: '1', calories: '', allergens: [], dietary: [], options: [] },
      ],
    },
  ],
}
const reply = menu => () => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(menu) }],
  usage: { input_tokens: 9000, output_tokens: 2500 },
})
const lastBody = () => claude.requests[claude.requests.length - 1].body

test.before(async () => {
  ids = await resetAndSeed()
  venueA = (await ok(as(A.owner, ids.a).post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London', currency: 'GBP' }))).id
  venueB = (await ok(as(B.owner, ids.b).post('/api/venues', { name: 'Elsewhere', slug: 'elsewhere', timezone: 'Europe/London' }))).id
  await ok(as(A.owner, ids.a).post('/api/menus/variant-groups', {
    name: 'Size', price_mode: 'base', options: [{ label: 'Small', price_pence: 900 }, { label: 'Large', price_pence: 1300 }],
  }))
})
test.after(async () => { await claude.close(); await closeApp() })

test('reading: the files and the group\'s own tags and groups reach Claude; the menu comes back cleaned', async () => {
  claude.script.push(reply(MENU))
  const res = await as(A.owner, ids.a).post('/api/ai/menus/read', {
    files: [{ name: 'page1.png', data: PNG }, { name: 'menu.pdf', data: PDF }], hint: 'Only the dinner pages', venue_id: venueA,
  })
  assert.equal(res.status, 200, res.body)
  const body = lastBody()
  const content = body.messages[0].content
  assert.equal(content[0].type, 'image')
  assert.equal(content[0].source.data, PNG)
  assert.equal(content[1].type, 'document')
  assert.equal(content[1].source.media_type, 'application/pdf')
  const sent = JSON.parse(content[2].text.slice(content[2].text.indexOf('{')))
  assert.equal(sent.request, 'Only the dinner pages')
  assert.equal(sent.currency, 'GBP')
  assert.ok(sent.existing_allergens.some(l => /peanut/i.test(l)), 'the group\'s allergens go with it')
  assert.deepEqual(sent.existing_option_groups, ['Size'])
  assert.equal(body.output_config.format.type, 'json_schema')

  const { menu, notes } = res.json
  assert.equal(notes, 'The dessert prices were hard to read.')
  assert.equal(menu.name, 'Dinner')
  assert.equal(menu.sections.length, 2)
  const [satay, rolls] = menu.sections[0].dishes
  assert.equal(satay.price, 7.5, '£7.50 read as a number')
  assert.equal(satay.calories, 420)
  assert.deepEqual(satay.allergens, [{ name: 'Peanuts', level: 'contains' }, { name: 'Wheat', level: 'may_contain' }])
  assert.equal(rolls.price, 6)
  assert.deepEqual(rolls.options, [{ group: 'Dips', mode: 'extra', choices: [{ name: 'Sweet chilli', price: 0.5 }] }])
  const curries = menu.sections[1]
  assert.equal(curries.subtitle, 'With jasmine rice')
  assert.equal(curries.dishes.length, 3, 'a dish with no name is left out')
  assert.equal(curries.dishes[0].price, undefined, 'a dish priced by its options has no price of its own')
})

test('reading refuses what it can\'t use', async () => {
  const owner = as(A.owner, ids.a)
  const text = Buffer.from('Pad thai 12.00').toString('base64')
  assert.equal((await owner.post('/api/ai/menus/read', { files: [{ name: 'menu.txt', data: text }] })).status, 422, 'not a photo or PDF')
  assert.equal((await owner.post('/api/ai/menus/read', { files: [] })).status, 400, 'no files')
  assert.equal((await owner.post('/api/ai/menus/read', { files: [{ data: PNG }], venue_id: venueB })).status, 404, 'another tenant\'s venue')
  assert.equal((await as(A.viewer, ids.a).post('/api/ai/menus/read', { files: [{ data: PNG }] })).status, 403, 'a viewer can\'t make menus')

  claude.script.push(reply({ ...MENU, sections: [{ title: 'Empty', subtitle: '', dishes: [] }] }))
  const none = await owner.post('/api/ai/menus/read', { files: [{ data: PNG }] })
  assert.equal(none.status, 422)
  assert.match(none.json.error, /couldn't find any dishes/)

  claude.script.push(() => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"name":"Din' }] }))
  const long = await owner.post('/api/ai/menus/read', { files: [{ data: PNG }] })
  assert.equal(long.status, 422)
  assert.match(long.json.error, /too long/)

  await ok(owner.patch('/api/ai/settings', { staff_enabled: false }))
  try {
    const off = await owner.post('/api/ai/menus/read', { files: [{ data: PNG }] })
    assert.equal(off.status, 403)
    assert.match(off.json.error, /switched off/)
  } finally {
    await ok(owner.patch('/api/ai/settings', { staff_enabled: true }))
  }
})

test('making the menu: a draft with prices, allergens and option groups, nothing live', async () => {
  claude.script.push(reply(MENU))
  const read = await ok(as(A.owner, ids.a).post('/api/ai/menus/read', { files: [{ data: PNG }] }))
  const made = await ok(as(A.owner, ids.a).post('/api/ai/menus/import', {
    name: read.menu.name, venue_id: venueA, tagline: read.menu.tagline, service_times: read.menu.service_times, sections: read.menu.sections,
  }))
  assert.equal(made.dishes, 5)
  assert.equal(made.sections, 2)
  assert.equal(made.venue, 'Ware')
  assert.ok(made.new_option_groups.includes('Protein') && made.new_option_groups.includes('Dips'))
  assert.ok(made.new_option_groups.some(g => /^Size \(/.test(g)), 'a dish whose sizes the group lacks gets a group of its own')

  const menu = await ok(as(A.owner, ids.a).get('/api/menus/' + made.menu_id))
  assert.equal(menu.name, 'Dinner')
  assert.equal(menu.venue_id, venueA)
  assert.equal(menu.tagline, 'Street food from Bangkok')
  const items = menu.sections.flatMap(s => s.items)
  const satay = items.find(i => i.name === 'Chicken satay')
  assert.equal(satay.price_pence, 750)
  assert.equal(satay.calories, 420)
  const tags = await ok(as(A.owner, ids.a).get('/api/menus/dietary/all'))
  const code = key => tags.find(t => t.standard_key === key).code
  assert.ok(satay.dietary.includes(code('peanuts')))
  assert.ok(satay.dietary.includes(code('gluten')), 'wheat matched to gluten')
  assert.equal(satay.allergen_levels[code('gluten')], 'may_contain')
  assert.ok(items.find(i => i.name === 'Green curry').dietary.includes(code('celery')))
  const massaman = items.find(i => i.name === 'Massaman')
  const size = (await ok(as(A.owner, ids.a).get('/api/menus/variant-groups'))).find(g => g.name === 'Size')
  assert.equal(massaman.variant_groups[0].group_id, size.id, 'an existing group with every choice is used')
  assert.equal((await as(A.owner, ids.a).get('/api/menus/' + made.menu_id + '?version=live')).status, 404, 'a draft, not live')

  const again = await as(A.owner, ids.a).post('/api/ai/menus/import', { name: 'Dinner', venue_id: venueA, sections: read.menu.sections })
  assert.equal(again.status, 409, 'same name at the same venue')
  assert.equal((await as(B.owner, ids.b).get('/api/menus/' + made.menu_id)).status, 404, 'another tenant can\'t see it')
  const other = await as(A.owner, ids.a).post('/api/ai/menus/import', { name: 'Lunch', venue_id: venueB, sections: read.menu.sections })
  assert.ok(other.status >= 400 && other.status < 500, 'another tenant\'s venue is refused')
  assert.equal((await as(A.operator, ids.a).post('/api/ai/menus/import', { name: 'Brunch', sections: read.menu.sections })).status, 403, 'operators view menus only')
})
