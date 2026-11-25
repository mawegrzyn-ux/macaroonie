// The kiosk designer demo's data (macaroonie.com/try/kiosk): an invented
// group, Harbour & Co, with one venue and its menu, made through the real API
// on a test database and written as the designer's setup and the kiosk's
// config to admin/src/demo/kiosk/demoData.json. The demo answers the
// designer's routes from it and sends the config to the kiosk app (no API).
//
// Run it again after changing the menu below (or anything the kiosk's config
// carries changes shape):
//
//   eval "$(scripts/test-env.sh demo)"
//   cd api && node --import ./test/support/register.mjs test/tools/kiosk-demo-data.mjs
//
// It empties that test database (resetAndSeed). Pictures are written as
// /demo-img/<name>.svg: the demo swaps that for its built-in pictures
// (admin/src/demo/kiosk/pictures.js).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID as u } from 'node:crypto'
import { as, ok, closeApp, getApp, sql } from '../support/app.mjs'
import { resetAndSeed, A } from '../support/seed.mjs'
import { menuSaveBody } from '../../src/routes/menus.js'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../../src/middleware/auth.js'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../admin/src/demo/kiosk/demoData.json')
const pic = name => '/demo-img/' + name + '.svg'

const ids = await resetAndSeed()
const owner = as(A.owner, ids.a)
await sql`UPDATE tenants SET name = 'Harbour & Co' WHERE id = ${ids.a}`
const venue = await ok(owner.post('/api/venues', { name: 'Harbour & Co Quayside', slug: 'quayside', timezone: 'Europe/London' }), 'venue')

// Option groups.
const G = {}
async function group(key, body) {
  G[key] = await ok(owner.post('/api/menus/variant-groups', body), 'group ' + key)
}
await group('extras', { name: 'Add extras', price_mode: 'extra', min_select: 0, max_select: 4, options: [
  { label: 'Extra cheese', price_pence: 100 }, { label: 'Smoked bacon', price_pence: 150 },
  { label: 'Jalapenos', price_pence: 60 }, { label: 'Avocado', price_pence: 120 }, { label: 'Fried egg', price_pence: 100 },
] })
await group('sauce', { name: 'Sauce', price_mode: 'extra', min_select: 0, max_select: 2, options: [
  { label: 'Ketchup', price_pence: 0 }, { label: 'Mayo', price_pence: 0 },
  { label: 'Harbour sauce', price_pence: 0 }, { label: 'Chipotle mayo', price_pence: 40 },
] })
await group('size', { name: 'Size', price_mode: 'extra', min_select: 1, max_select: 1, options: [
  { label: 'Regular', price_pence: 0 }, { label: 'Large', price_pence: 100 },
] })
await group('drinkSize', { name: 'Drink size', display_name: 'Size', price_mode: 'extra', min_select: 1, max_select: 1, options: [
  { label: 'Regular', price_pence: 0 }, { label: 'Large', price_pence: 60 },
] })
await group('pieces', { name: 'Nugget pieces', display_name: 'How many?', price_mode: 'extra', min_select: 1, max_select: 1, options: [
  { label: '6 pieces', price_pence: 0 }, { label: '9 pieces', price_pence: 200 }, { label: '12 pieces', price_pence: 400 },
] })
await group('shake', { name: 'Shake flavour', display_name: 'Flavour', price_mode: 'extra', min_select: 1, max_select: 1, kiosk_display: 'wheel', options: [
  { label: 'Vanilla', price_pence: 0 }, { label: 'Chocolate', price_pence: 0 },
  { label: 'Strawberry', price_pence: 0 }, { label: 'Salted caramel', price_pence: 30 },
] })
await group('coffee', { name: 'Coffee', display_name: 'How do you take it?', price_mode: 'extra', min_select: 1, max_select: 1, options: [
  { label: 'Flat white', price_pence: 0 }, { label: 'Latte', price_pence: 0 },
  { label: 'Americano', price_pence: 0 }, { label: 'Oat milk', price_pence: 40 },
] })
await group('scoops', { name: 'Ice cream scoops', display_name: 'Pick your scoops', price_mode: 'extra', min_select: 1, max_select: 2, options: [
  { label: 'Vanilla', price_pence: 0 }, { label: 'Chocolate', price_pence: 0 },
  { label: 'Strawberry', price_pence: 0 }, { label: 'Mint choc chip', price_pence: 0 },
] })
await group('spice', { name: 'Heat', price_mode: 'extra', min_select: 1, max_select: 1, kiosk_display: 'slider', scale_low: 'Mild', scale_high: 'Hot', options: [
  { label: 'Mild', price_pence: 0, level: 1 }, { label: 'Medium', price_pence: 0, level: 2 }, { label: 'Hot', price_pence: 0, level: 3 },
] })
const vg = (...keys) => keys.map(k => ({ group_id: G[k].id }))

// Dietary tags the menu uses besides the allergens.
for (const t of [{ label: 'Vegetarian', code: 'vegetarian', glyph: 'V' }, { label: 'Vegan', code: 'vegan', glyph: 'Ve' }]) {
  await owner.post('/api/menus/dietary', { ...t, kind: 'dietary' })
}

const menu = await ok(owner.post('/api/menus', { name: 'Harbour & Co', slug: 'harbour-menu' }), 'menu')
const D = {}
const dish = (key, name, price, image, more = {}) => {
  D[key] = u()
  return { id: D[key], name, price_pence: price, is_orderable: true, image_url: pic(image), ...more }
}
const S = { burgers: u(), chicken: u(), sides: u(), fresh: u(), drinks: u(), desserts: u(), deals: u() }
const sections = [
  { id: S.burgers, title: 'Burgers', subtitle: 'Smashed to order on a toasted brioche bun', image_url: pic('burger'), items: [
    dish('harbour', 'Harbour Burger', 895, 'burger', { description: 'Beef patty, lettuce, tomato, red onion and our Harbour sauce.', calories: 640, is_featured: true,
      dietary: ['gluten', 'milk', 'eggs', 'mustard', 'sesame'], allergen_levels: { sesame: 'may_contain' }, variant_groups: vg('extras', 'sauce') }),
    dish('cheese', 'Cheeseburger', 945, 'cheeseburger', { description: 'Beef patty, melted cheddar, pickles, ketchup and mustard.', calories: 720,
      dietary: ['gluten', 'milk', 'eggs', 'mustard'], variant_groups: vg('extras', 'sauce') }),
    dish('double', 'Double Smash', 1195, 'cheeseburger', { description: 'Two smashed patties, double cheddar, crispy onions.', calories: 980,
      dietary: ['gluten', 'milk', 'eggs', 'mustard'], variant_groups: vg('extras', 'sauce') }),
    dish('bean', 'Smoky Bean Burger', 875, 'burger', { description: 'Black bean and sweetcorn patty, chipotle mayo, slaw.', calories: 590,
      dietary: ['gluten', 'eggs', 'vegetarian', 'celery'], variant_groups: vg('extras', 'sauce') }),
  ] },
  { id: S.chicken, title: 'Chicken', subtitle: 'Buttermilk fried, never frozen', image_url: pic('chicken-burger'), items: [
    dish('chickenBurger', 'Crispy Chicken Burger', 925, 'chicken-burger', { description: 'Buttermilk fried thigh, slaw and pickles. Pick your heat.', calories: 690, is_featured: true,
      dietary: ['gluten', 'milk', 'eggs', 'mustard'], variant_groups: vg('spice', 'extras') }),
    dish('nuggets', 'Chicken Nuggets', 595, 'nuggets', { description: 'Golden nuggets with a dip of your choice.', calories: 420,
      dietary: ['gluten', 'celery'], variant_groups: vg('pieces', 'sauce') }),
    dish('chickenWrap', 'Chicken Wrap', 795, 'wrap', { description: 'Grilled chicken, crunchy lettuce, tomato and garlic mayo.', calories: 520,
      dietary: ['gluten', 'eggs', 'milk'], variant_groups: vg('spice') }),
  ] },
  { id: S.sides, title: 'Sides', subtitle: 'Hot and crispy', image_url: pic('fries'), items: [
    dish('fries', 'Fries', 325, 'fries', { description: 'Skin-on fries with sea salt.', calories: 330, dietary: ['vegan', 'vegetarian'], variant_groups: vg('size', 'sauce') }),
    dish('sweet', 'Sweet Potato Fries', 375, 'sweet-potato-fries', { description: 'With a pinch of smoked paprika.', calories: 360, dietary: ['vegan', 'vegetarian'], variant_groups: vg('size', 'sauce') }),
    dish('rings', 'Onion Rings', 375, 'onion-rings', { description: 'Beer-battered, crisp and golden.', calories: 380, dietary: ['gluten', 'vegetarian'], variant_groups: vg('sauce') }),
    dish('sideSalad', 'Side Salad', 350, 'salad', { description: 'Leaves, cucumber, cherry tomatoes, lemon dressing.', calories: 90, dietary: ['vegan', 'vegetarian', 'mustard'] }),
  ] },
  { id: S.fresh, title: 'Salads & wraps', subtitle: 'Something lighter', image_url: pic('salad'), items: [
    dish('harbourSalad', 'Harbour Salad', 895, 'salad', { description: 'Leaves, quinoa, avocado, pickled red onion and seeds.', calories: 410,
      dietary: ['vegan', 'vegetarian', 'sesame', 'mustard'] }),
    dish('chickenSalad', 'Grilled Chicken Salad', 995, 'salad', { description: 'Harbour salad topped with grilled chicken.', calories: 520, dietary: ['mustard', 'sesame'] }),
    dish('falafel', 'Falafel Wrap', 775, 'wrap', { description: 'Falafel, hummus, pickled cabbage and chilli sauce.', calories: 560,
      dietary: ['gluten', 'sesame', 'vegan', 'vegetarian'] }),
  ] },
  { id: S.drinks, title: 'Drinks', subtitle: 'Shakes, coffee and cold ones', image_url: pic('milkshake'), items: [
    dish('cola', 'Cola', 250, 'cola', { description: 'Ice cold.', calories: 140, dietary: ['vegan'], variant_groups: vg('drinkSize') }),
    dish('lemonade', 'Cloudy Lemonade', 275, 'lemonade', { description: 'Pressed lemons and a little mint.', calories: 110, dietary: ['vegan'], variant_groups: vg('drinkSize') }),
    dish('shake', 'Thick Milkshake', 425, 'milkshake', { description: 'Made with real ice cream. Spin for a flavour.', calories: 560, is_featured: true,
      dietary: ['milk', 'vegetarian'], variant_groups: vg('shake') }),
    dish('coffee', 'Coffee', 260, 'coffee', { description: 'Freshly ground, roasted down the road.', calories: 120, dietary: ['milk'], allergen_levels: { milk: 'removable' }, variant_groups: vg('coffee') }),
  ] },
  { id: S.desserts, title: 'Desserts', subtitle: 'Save room', image_url: pic('ice-cream'), items: [
    dish('brownie', 'Chocolate Brownie', 395, 'brownie', { description: 'Warm, gooey and very chocolatey.', calories: 450, dietary: ['gluten', 'milk', 'eggs', 'vegetarian', 'nuts'], allergen_levels: { nuts: 'may_contain' } }),
    dish('iceCream', 'Ice Cream', 350, 'ice-cream', { description: 'Two scoops in a cup or a cone.', calories: 280, dietary: ['milk', 'vegetarian'], variant_groups: vg('scoops') }),
    dish('sundae', 'Brownie Sundae', 525, 'ice-cream', { description: 'Warm brownie, vanilla ice cream and chocolate sauce.', calories: 690, dietary: ['gluten', 'milk', 'eggs', 'vegetarian', 'nuts'], allergen_levels: { nuts: 'may_contain' } }),
  ] },
]
const full = await ok(owner.get(`/api/menus/${menu.id}`), 'menu load')
await ok(owner.patch(`/api/menus/${menu.id}`, { ...full, sections }), 'menu tree')

// The meal deals, once the dishes exist.
const body = menuSaveBody(await ok(owner.get(`/api/menus/${menu.id}`), 'menu reload'))
const pick = (key, extra = {}) => ({ id: u(), type: 'item', item_id: D[key], ...extra })
body.sections.push({ id: S.deals, title: 'Meal deals', subtitle: 'A main, a side and a drink', image_url: pic('combo-meal'), items: [
  { id: u(), name: 'Burger Meal', kind: 'combo', price_pence: 1250, is_orderable: true, image_url: pic('combo-meal'), is_featured: true,
    description: 'Any burger with a side and a drink. Save up to 2.50.', combo: { mode: 'manual', steps: [
      { id: u(), name: 'Your burger', min: 1, max: 1, options: [pick('harbour'), pick('cheese'), pick('chickenBurger'), pick('bean'), pick('double', { price_pence: 200 })] },
      { id: u(), name: 'Your side', min: 1, max: 1, options: [pick('fries'), pick('sweet', { price_pence: 50 }), pick('rings', { price_pence: 50 }), pick('sideSalad')] },
      { id: u(), name: 'Your drink', min: 1, max: 1, options: [pick('cola'), pick('lemonade'), pick('shake', { price_pence: 150 })] },
    ] } },
  { id: u(), name: 'Little Sailor Meal', kind: 'combo', price_pence: 650, is_orderable: true, image_url: pic('nuggets'),
    description: 'Six nuggets, small fries, a drink and a scoop of ice cream.', combo: { mode: 'manual', steps: [
      { id: u(), name: 'Main', min: 1, max: 1, options: [pick('nuggets')] },
      { id: u(), name: 'Side', min: 1, max: 1, options: [pick('fries'), pick('sideSalad')] },
      { id: u(), name: 'Drink', min: 1, max: 1, options: [pick('lemonade'), pick('cola')] },
    ] } },
] })
await ok(owner.patch(`/api/menus/${menu.id}`, body), 'meal deals')
await ok(owner.post(`/api/menus/${menu.id}/publish`, {}), 'publish')

// Eat in and Take away on a Kiosk revenue stream (the order types every
// tenant starts with, the second renamed); a name asked for take away.
const types = await ok(owner.get('/api/order-types'), 'order types')
const eatIn = types.find(t => t.name === 'Eat in')
const takeAway = types.find(t => t.name === 'Take out')
await ok(owner.patch(`/api/order-types/${takeAway.id}`, { name: 'Take away' }), 'take away')
await ok(owner.post(`/api/pos/venues/${venue.id}/revenue-streams`, {
  name: 'Kiosk', menu_ids: [menu.id], courses: false,
  order_types: [
    { order_type_id: eatIn.id, enabled: true, ask_name: 'off', ask_tent: 'off' },
    { order_type_id: takeAway.id, enabled: true, ask_name: 'ask', ask_tent: 'off' },
  ],
}), 'stream')

// The design the demo starts from, saved so the kiosk config carries it.
const designs = await ok(owner.get('/api/pos/kiosk-designs'), 'designs')
const design = designs[0] || await ok(owner.post('/api/pos/kiosk-designs', { name: 'Harbour & Co kiosk' }), 'design')
const settings = {
  brand: {
    logo_url: pic('logo'), font_heading: 'Rubik', font_body: 'Nunito', heading_case: 'normal', radius: 18,
    colors: { background: '#f4f1ea', surface: '#ffffff', text: '#12263a', muted: '#5b6b7a', primary: '#0b5d7a', primary_text: '#ffffff', accent: '#f2b134', accent_text: '#12263a' },
  },
  start: { media: [{ type: 'image', url: pic('hero-harbour') }, { type: 'image', url: pic('hero-burger') }], layout: 'full' },
  menu: { home: true, banners: [{ image_url: pic('banner-meal') }, { image_url: pic('banner-shakes') }], featured: [] },
}
const savedDesign = await ok(owner.put(`/api/pos/kiosk-designs/${design.id}`, { name: 'Harbour & Co kiosk', settings }), 'design save')

// What the designer reads (Store tech's setup) and what the kiosk gets.
const setup = await ok(owner.get(`/api/pos/venues/${venue.id}/setup`), 'setup')
const link = await ok(owner.post(`/api/pos/kiosk-designs/${design.id}/preview`, { venue_id: venue.id }), 'preview link')
const app = await getApp()
const res = await app.inject({ method: 'GET', url: '/pos-api/kiosk-preview?token=' + encodeURIComponent(link.token), headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET } })
if (res.statusCode !== 200) throw new Error('kiosk config: ' + res.statusCode + ' ' + res.body.slice(0, 200))
const config = res.json()

const pickKeys = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]))
const out = {
  about: 'Made by api/test/tools/kiosk-demo-data.mjs: run it again rather than editing this by hand.',
  venue: { id: venue.id, name: venue.name },
  design: { id: savedDesign.id, name: savedDesign.name, settings: savedDesign.settings },
  setup: { ...pickKeys(setup, ['sections', 'items', 'menus', 'order_types', 'option_groups', 'revenue_streams']), devices: [] },
  config: { ...config, design: null, device: { ...config.device, name: 'Demo kiosk', short_code: 'DEMO' } },
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out) + '\n')
console.log('wrote', OUT, Math.round(fs.statSync(OUT).size / 1024) + ' KB', 'setup keys', Object.keys(setup).join(','))
await closeApp()
process.exit(0)
