// The venue setup wizard (/api/ai/store-openings/wizard, migration 186's
// openings without Pepper): a draft from scratch with sensible areas, each
// step's settings saved and winning over Pepper's plan, creating it (hours,
// tables, booking rules, ordering with the wizard's menus, the web page's own
// look, menus for this venue only), starting like another venue, Pepper's
// optional description, refusals and other tenants.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { AREA_KEYS } = await import('../../shared/storeOpening.js')

const BASE = '/api/ai/store-openings'
let ids, owner, ware, menuA, menuB

const HOURS = {
  slot_interval_mins: 30,
  days: [
    { day: 1, open: true, sittings: [{ name: 'Lunch', opens_at: '12:00', closes_at: '14:30', max_covers: 30 }, { name: 'Dinner', opens_at: '17:00', closes_at: '21:30', max_covers: 50 }] },
    { day: 6, open: true, sittings: [{ name: '', opens_at: '11:00', closes_at: '22:00', max_covers: 60 }] },
    { day: 0, open: false, sittings: [] },
  ],
}
const TABLES = { sections: [{ name: 'Main room', tables: [{ label: '1', min_covers: 1, max_covers: 2 }, { label: '2', min_covers: 1, max_covers: 4 }] }, { name: 'Terrace', tables: [{ label: 'T1', min_covers: 2, max_covers: 6 }] }] }
const KIT = {
  name: 'Ember', about: 'Warm.', source: 'ai',
  colors: { background: '#1a1210', surface: '#241a17', text: '#f5ebe0', muted: '#c8b6a6', border: '#3a2d28', primary: '#e85d24', primary_text: '#ffffff', accent: '#f2b632', accent_text: '#1a1210' },
  fonts: { heading: 'Montserrat', body: 'Inter', script: 'Caveat', display: '' }, shape: 'square', heading_case: 'upper',
}

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  ware = (await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))).id
  menuA = (await ok(owner.post('/api/menus', { name: 'Dinner', slug: 'dinner' }))).id
  menuB = (await ok(as(B.owner, ids.b).post('/api/menus', { name: 'Theirs', slug: 'theirs' }))).id
  await ok(owner.post('/api/website/brand-defaults', { brand_name: 'Zqx Group' }))
})
test.after(async () => { await claude.close(); await closeApp() })

test('from scratch: a draft without Pepper, the steps\' settings, then the venue made from them', async () => {
  const start = await owner.post(BASE + '/wizard', {})
  assert.equal(start.status, 201, start.body)
  const o = start.json
  assert.equal(o.status, 'draft')
  assert.equal(o.wizard, true)
  const mode = (v, k) => v.areas.find(a => a.key === k).mode
  for (const k of ['booking_rules', 'website', 'ordering', 'till', 'cash']) assert.equal(mode(o, k), 'new', k + ' starts set up new')
  assert.equal(mode(o, 'hours'), 'skip', 'hours wait for their step')

  const venue = await ok(owner.patch(BASE + '/' + o.id, {
    overrides: {
      venue: { name: 'Zqx Leeds', slug: 'leeds', timezone: 'Europe/London' },
      location: { address_line1: '1 Briggate', city: 'Leeds', postcode: 'LS1 6HD', phone: '0113 000 0000' },
    },
  }))
  assert.equal(venue.plan.venue.name, 'Zqx Leeds')

  const steps = await ok(owner.patch(BASE + '/' + o.id, {
    overrides: { modes: { hours: 'new', tables: 'new', devices: 'new' } },
    settings: {
      hours: HOURS, tables: TABLES, booking_rules: { slot_duration_mins: 120, min_covers: 2, max_covers: 10, book_until_days: 30, cutoff_before_mins: 30 },
      devices: { tills: 2, kitchen_screens: 1, kiosks: 0, menu_screens: 0 },
      menus: { ids: [menuA, menuB], made: [menuA], only_here: true },
      brand: { kit: KIT },
      ordering: { enabled: false },
    },
  }))
  assert.equal(steps.plan.hours.slot_interval_mins, 30)
  assert.equal(steps.plan.tables.sections.length, 2)
  assert.equal(steps.plan.booking_rules.slot_duration_mins, 120)
  assert.equal(steps.plan.brand.kit.name, 'Ember')
  assert.match(steps.areas.find(a => a.key === 'website').preview, /look of its own \("Ember"\)/)
  assert.match(steps.areas.find(a => a.key === 'ordering').preview, /with 2 menus/, 'the preview counts what was picked')
  assert.deepEqual(steps.problems, [])

  assert.equal((await owner.patch(BASE + '/' + o.id, { settings: { colours: {} } })).status, 400, 'an unknown setting')

  const made = await ok(owner.post(BASE + '/' + o.id + '/create', {}))
  assert.equal(made.status, 'created')
  const v = made.venue.id
  const days = await sql`SELECT day_of_week, is_open, slot_interval_mins FROM venue_schedule_templates WHERE venue_id = ${v} ORDER BY day_of_week`
  assert.deepEqual(days.filter(d => d.is_open).map(d => d.day_of_week), [1, 6])
  assert.equal(days[0].slot_interval_mins, 30)
  const sittings = await sql`SELECT s.name, s.opens_at::text, s.default_max_covers FROM venue_sittings s WHERE s.venue_id = ${v} ORDER BY s.opens_at`
  assert.equal(sittings.length, 3)
  assert.deepEqual(sittings.map(s => s.name), [null, 'Lunch', 'Dinner'], 'Saturday\'s sitting has no name')
  const tables = await sql`SELECT label FROM tables WHERE venue_id = ${v} AND NOT COALESCE(is_unallocated, false) ORDER BY sort_order`
  assert.deepEqual(tables.map(t => t.label), ['1', '2', 'T1'])
  const [rules] = await sql`SELECT slot_duration_mins, max_covers FROM booking_rules WHERE venue_id = ${v}`
  assert.deepEqual({ ...rules }, { slot_duration_mins: 120, max_covers: 10 })
  const [ordering] = await sql`SELECT is_enabled, menu_ids FROM ordering_settings WHERE venue_id = ${v}`
  assert.equal(ordering.is_enabled, false)
  assert.deepEqual(ordering.menu_ids, [menuA], 'only the tenant\'s own menu goes on its ordering')
  const [cfg] = await sql`SELECT use_brand_override, theme, address_line1, site_name FROM website_config WHERE venue_id = ${v}`
  assert.equal(cfg.use_brand_override, true)
  assert.equal(cfg.theme.typography.heading_font, 'Montserrat')
  assert.equal(cfg.address_line1, '1 Briggate')
  assert.equal(cfg.site_name, 'Zqx Group')
  const [menu] = await sql`SELECT venue_id FROM menus WHERE id = ${menuA}`
  assert.equal(menu.venue_id, v, 'a menu made in the wizard for this venue only')
  const [theirs] = await sql`SELECT venue_id FROM menus WHERE id = ${menuB}`
  assert.equal(theirs.venue_id, null, 'another tenant\'s menu is never touched')
  const devices = await sql`SELECT kind FROM pos_devices WHERE venue_id = ${v} ORDER BY kind`
  assert.deepEqual(devices.map(d => d.kind), ['kds', 'terminal', 'terminal'])
  assert.ok(made.followups.some(f => f.key === 'menus'), 'a to-do to check and publish the menu')
})

test('like another venue: areas copy unless a step sets them up here', async () => {
  const o = await ok(owner.post(BASE + '/wizard', { template_venue_id: ware }))
  assert.equal(o.template.name, 'Ware')
  for (const k of AREA_KEYS) {
    const a = o.areas.find(x => x.key === k)
    if (a.modes.includes('copy')) assert.equal(a.mode, 'copy', k)
  }
  const next = await ok(owner.patch(BASE + '/' + o.id, {
    overrides: { venue: { name: 'Zqx Hertford' }, modes: { hours: 'new' } }, settings: { hours: HOURS },
  }))
  assert.equal(next.areas.find(a => a.key === 'hours').mode, 'new')
  // Back to scratch: a mode taken back with null falls back to the default.
  const scratch = await ok(owner.patch(BASE + '/' + o.id, { overrides: { template_venue_id: null, modes: { till: 'new', hours: null } } }))
  assert.equal(scratch.template, null)
  assert.equal(scratch.areas.find(a => a.key === 'till').mode, 'new')
  assert.notEqual(scratch.areas.find(a => a.key === 'hours').mode, 'copy', 'nothing to copy from any more')
  await ok(owner.delete(BASE + '/' + o.id))
})

test('Pepper fills in what the person hasn\'t set; their own settings stay', async () => {
  const o = await ok(owner.post(BASE + '/wizard', {}))
  await ok(owner.patch(BASE + '/' + o.id, { overrides: { venue: { name: 'Zqx Bath' }, modes: { hours: 'new' } }, settings: { hours: HOURS } }))
  claude.script.push(() => ({
    stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 700 },
    content: [{ type: 'text', text: JSON.stringify({
      title: 'Bath', summary: 'A small café in Bath.', ready: true, questions: [],
      brief: { headline: 'Bath café', summary: 'Small and simple.', highlights: [], assumptions: [], risks: [], followups: [] },
      plan: {
        venue: { name: 'Pepper name', slug: 'bath', timezone: 'Europe/London', currency: 'GBP' },
        location: { address_line1: '2 Milsom St', address_line2: '', city: 'Bath', postcode: 'BA1 1BZ', country: '', phone: '', email: '' },
        opening_date: '', template_venue_id: '', areas: [{ key: 'devices', mode: 'new', note: '', deep_dive: false }],
        hours: { slot_interval_mins: 15, days: [{ day: 3, open: true, sittings: [{ name: '', opens_at: '09:00', closes_at: '16:00', max_covers: 20 }] }] },
        tables: { sections: [] },
        booking_rules: { slot_duration_mins: 60, min_covers: 1, max_covers: 6, book_until_days: 30, cutoff_before_mins: 60 },
        ordering_enabled: false, till: { receipt_name: '', streams: [] },
        devices: { tills: 1, kitchen_screens: 0, kiosks: 2, menu_screens: 0 },
        food_safety: { equipment: [], check_times: [], hold_stations: [], hold_check_times: [], cooking_sessions: [] },
        checklists: [], pars_percent: 100, staff: [], email_from_name: '',
      },
    }) }],
  }))
  const res = await owner.post(BASE + '/' + o.id + '/describe', { input: 'A small café in Bath with two kiosks and one till.' })
  assert.equal(res.status, 200, res.body)
  const after = res.json
  assert.equal(after.plan.venue.name, 'Zqx Bath', 'the name the person typed stays')
  assert.equal(after.plan.hours.slot_interval_mins, 30, 'their hours stay')
  assert.equal(after.plan.location.city, 'Bath', 'Pepper fills in what was empty')
  assert.equal(after.plan.devices.kiosks, 2)
  assert.equal(after.brief.headline, 'Bath café')
  await ok(owner.delete(BASE + '/' + o.id))
})

test('refusals: people without Venues manage, another tenant, a created venue', async () => {
  assert.equal((await as(A.viewer, ids.a).post(BASE + '/wizard', {})).status, 403)
  assert.equal((await as(A.operator, ids.a).post(BASE + '/wizard', {})).status, 403)
  const o = await ok(owner.post(BASE + '/wizard', {}))
  assert.equal((await as(B.owner, ids.b).get(BASE + '/' + o.id)).status, 404)
  assert.equal((await as(B.owner, ids.b).patch(BASE + '/' + o.id, { settings: { hours: HOURS } })).status, 404)
  assert.equal((await as(B.owner, ids.b).post(BASE + '/wizard', { template_venue_id: ware })).status, 404, 'another tenant\'s venue to copy')
  const wrong = await owner.post(BASE + '/' + o.id + '/create', {})
  assert.ok(wrong.status === 200 || wrong.status === 422, 'a nameless draft is made as "New location" or refused, never a 500')
})
