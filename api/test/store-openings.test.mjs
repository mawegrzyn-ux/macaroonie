// Opening a new location with Pepper (migration 186): the steps against a
// stand-in Claude (support/fake-claude.mjs), the plan checks, creating the
// location by copying a filled-in one (support/fixtures.mjs) and by setting
// it up new, permissions, and other tenants.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startFakeClaude } from './support/fake-claude.mjs'

const claude = await startFakeClaude()
const { as, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { fillTenant } = await import('./support/fixtures.mjs')
const { AREA_KEYS, MAX_ROUNDS } = await import('../../shared/storeOpening.js')

const BASE = '/api/ai/store-openings'
let ids, owner, ware, hertford, venueB

/** A whole answer in the shape the schema asks for, with these changes. */
function answer(over = {}) {
  const plan = {
    venue: { name: '', slug: '', timezone: 'Europe/London', currency: 'GBP' },
    location: { address_line1: '', address_line2: '', city: '', postcode: '', country: '', phone: '', email: '' },
    opening_date: '', template_venue_id: '',
    areas: [],
    hours: { slot_interval_mins: 15, days: [] },
    tables: { sections: [] },
    booking_rules: { slot_duration_mins: 90, min_covers: 1, max_covers: 8, book_until_days: 60, cutoff_before_mins: 60 },
    ordering_enabled: false,
    till: { receipt_name: '', streams: [] },
    devices: { tills: 0, kitchen_screens: 0, kiosks: 0, menu_screens: 0 },
    food_safety: { equipment: [], check_times: [], hold_stations: [], hold_check_times: [], cooking_sessions: [] },
    checklists: [], pars_percent: 100, staff: [], email_from_name: '',
    ...(over.plan || {}),
  }
  return {
    title: 'Leeds', summary: 'A new store in Leeds.', ready: false, questions: [],
    brief: { headline: '', summary: '', highlights: [], assumptions: [], risks: [], followups: [] },
    ...over, plan,
  }
}
const reply = obj => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 4000, output_tokens: 900 } })
const lastRequest = () => claude.requests[claude.requests.length - 1].body
const stepOf = body => JSON.parse(body.messages[0].content[1].text.replace(/^This step:\n/, ''))
const contextOf = body => JSON.parse(body.messages[0].content[0].text.replace(/^The group \(context\):\n/, ''))
const copyAll = () => AREA_KEYS.map(key => ({ key, mode: key === 'staff' ? 'new' : 'copy', note: 'Like Ware.', deep_dive: key === 'tables' }))

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  const filled = await fillTenant(A.owner, ids.a)
  ware = filled.ids.venue
  hertford = filled.ids.venue2
  assert.ok(ware && hertford, 'fixtures made the venues')
  venueB = await ok(as(B.owner, ids.b).post('/api/venues', { name: 'Elsewhere', slug: 'elsewhere', timezone: 'Europe/London' }))
})
test.after(async () => { await claude.close(); await closeApp() })

let opening

test('scope: Pepper reads the group, copies from a similar location and asks what matters', async () => {
  claude.script.push(reply(answer({
    title: 'Leeds city centre',
    plan: { venue: { name: 'Zqx Leeds', slug: 'zqx-leeds', timezone: 'Europe/London', currency: 'GBP' }, template_venue_id: ware, areas: copyAll(),
      location: { address_line1: '1 Briggate', address_line2: '', city: 'Leeds', postcode: 'LS1 6HD', country: 'United Kingdom', phone: '', email: '' },
      staff: [{ name: 'Ann Lee', role: 'Zqx Chef', pay_type: 'hourly', rate: 12.5 }] },
    questions: [
      { id: 'q1', area: 'tables', text: 'Same tables as Ware?', why: 'Leeds is bigger.', kind: 'choice', options: [{ value: 'same', label: 'Same as Ware' }, { value: 'bigger', label: 'More tables' }], suggested: 'bigger' },
      { id: 'q2', area: 'basics', text: 'When does it open?', why: '', kind: 'date', options: [], suggested: '' },
      { id: 'q3', area: 'basics', text: 'Pick one', why: '', kind: 'choice', options: [], suggested: '' },
    ],
  })))
  const res = await owner.post(BASE, { input: 'Zqx Leeds, a city centre store like Ware but bigger, opening in December.' })
  assert.equal(res.status, 201, res.body)
  opening = res.json
  assert.equal(opening.status, 'questions')
  assert.equal(opening.title, 'Leeds city centre')
  assert.equal(opening.template.name, 'Zqx Ware')
  assert.deepEqual(opening.questions.map(q => q.id), ['r1-q1', 'r1-q2', 'r1-q3'])
  assert.equal(opening.questions[2].kind, 'text', 'a choice without options becomes a text question')
  const tables = opening.areas.find(a => a.key === 'tables')
  assert.equal(tables.mode, 'copy')
  assert.ok(tables.deep_dive)
  assert.match(tables.preview, /Copied from Zqx Ware: 3 tables in 1 room/)
  assert.match(opening.areas.find(a => a.key === 'staff').preview, /Ann Lee/)
  assert.equal(opening.plan.venue.slug_final, 'zqx-leeds')

  const body = lastRequest()
  assert.equal(body.output_config.format.type, 'json_schema')
  assert.ok(body.stream, 'streamed')
  assert.match(body.system[0].text, /open a new location/)
  const ctx = contextOf(body)
  assert.deepEqual(ctx.locations.map(l => l.name).sort(), ['Zqx Hertford', 'Zqx Ware'])
  assert.ok(!JSON.stringify(ctx).includes('Elsewhere'), 'another tenant\'s location is never in the context')
  assert.match(ctx.locations.find(l => l.name === 'Zqx Ware').setup.tables, /3 tables/)
  const step = stepOf(body)
  assert.equal(step.step, 'scope')
  assert.equal(step.round, 1)
  assert.ok(step.can_set_up.includes('cash'), 'an owner can set up every area')

  const [usage] = await sql`SELECT sum(requests)::int AS n FROM ai_usage WHERE tenant_id = ${ids.a}`
  assert.ok(usage.n >= 1, 'counted towards the allowance')
})

test('answers: the next round gets them, and a ready answer brings the brief', async () => {
  claude.script.push(reply(answer({
    ready: true, title: 'Leeds city centre',
    plan: { venue: { name: 'Zqx Leeds', slug: 'zqx-leeds', timezone: 'Europe/London', currency: 'GBP' }, template_venue_id: ware, areas: copyAll(), opening_date: '2026-12-01',
      staff: [{ name: 'Ann Lee', role: 'Zqx Chef', pay_type: 'hourly', rate: 12.5 }], pars_percent: 150 },
    brief: { headline: 'Zqx Leeds opens 1 December', summary: 'A bigger Ware.', highlights: ['Copied from Ware'], assumptions: ['Pars at 150%'], risks: ['Tight timeline'], followups: ['Order a card terminal'] },
  })))
  const res = await owner.post(`${BASE}/${opening.id}/answers`, { answers: { 'r1-q1': 'bigger', 'r1-q2': '2026-12-01', 'r1-q3': '' } })
  assert.equal(res.status, 200, res.body)
  opening = res.json
  assert.equal(opening.status, 'ready')
  assert.deepEqual(opening.questions, [])
  assert.equal(opening.brief.headline, 'Zqx Leeds opens 1 December')
  assert.equal(opening.plan.opening_date, '2026-12-01')
  assert.match(opening.areas.find(a => a.key === 'purchasing').preview, /150%/)
  const step = stepOf(lastRequest())
  assert.equal(step.round, 2)
  const sent = step.conversation.at(-1)
  assert.deepEqual(sent.answers, { 'r1-q1': 'bigger', 'r1-q2': '2026-12-01', 'r1-q3': '' })
  assert.equal(step.conversation[0].questions.length, 3, 'the questions the answers are for go too')
  assert.ok(step.current_plan.template_venue_id, 'Pepper sees its plan as checked')
  assert.equal(opening.history.length, 2)
})

test('the person\'s own choices win over Pepper\'s and stay through later steps', async () => {
  const res = await owner.patch(`${BASE}/${opening.id}`, {
    title: 'Leeds flagship',
    overrides: { venue: { name: 'Zqx Leeds Briggate', slug: 'zqx-ware' }, modes: { emails: 'skip', deliveroo: 'skip' }, opening_date: '2026-12-05' },
  })
  assert.equal(res.status, 200, res.body)
  opening = res.json
  assert.equal(opening.title, 'Leeds flagship')
  assert.equal(opening.plan.venue.name, 'Zqx Leeds Briggate')
  assert.equal(opening.plan.venue.slug_final, 'zqx-ware-2', 'a web address already used gets a number')
  assert.equal(opening.areas.find(a => a.key === 'emails').mode, 'skip')
  assert.ok(opening.areas.find(a => a.key === 'emails').chosen)
  assert.equal(opening.plan.opening_date, '2026-12-05')
  // Bad input is refused.
  assert.equal((await owner.patch(`${BASE}/${opening.id}`, { overrides: { modes: { tables: 'teleport' } } })).status, 400)
  assert.equal((await owner.patch(`${BASE}/${opening.id}`, { overrides: { venue: { slug: 'Not A Slug' } } })).status, 400)
  assert.equal((await owner.patch(`${BASE}/${opening.id}`, { overrides: { template_venue_id: venueB.id } })).status, 404, 'another tenant\'s location can\'t be copied')

  // A deep dive on tables: Pepper asks more; the person's choices go with the step and stay.
  claude.script.push(reply(answer({
    plan: { venue: { name: 'Something else', slug: 'other', timezone: 'Europe/London', currency: 'GBP' }, template_venue_id: ware, areas: copyAll() },
    questions: [{ id: 'size', area: 'tables', text: 'How many tables?', why: '', kind: 'number', options: [], suggested: '30' }],
  })))
  const dive = await owner.post(`${BASE}/${opening.id}/deep-dive`, { area: 'tables' })
  assert.equal(dive.status, 200, dive.body)
  assert.equal(dive.json.status, 'questions')
  assert.equal(dive.json.questions[0].area, 'tables')
  assert.equal(dive.json.plan.venue.name, 'Zqx Leeds Briggate', 'the person\'s name wins over Pepper\'s')
  assert.equal(dive.json.areas.find(a => a.key === 'emails').mode, 'skip')
  assert.equal(dive.json.title, 'Leeds flagship', 'the person\'s title stays')
  const step = stepOf(lastRequest())
  assert.equal(step.step, 'deep_dive')
  assert.equal(step.deep_dive_area, 'tables')
  assert.equal(step.person_choices.venue.name, 'Zqx Leeds Briggate')
  assert.equal(step.round, 2, 'a deep dive isn\'t a round')

  // A change to the plan.
  claude.script.push(reply(answer({
    ready: true,
    plan: { venue: { name: 'x', slug: 'x', timezone: 'Europe/London', currency: 'GBP' }, template_venue_id: ware, areas: copyAll(), opening_date: '2026-12-01',
      staff: [{ name: 'Ann Lee', role: 'Zqx Chef', pay_type: 'hourly', rate: 12.5 }], pars_percent: 150 },
    brief: { headline: 'Zqx Leeds opens in December', summary: 'Copied from Ware.', highlights: [], assumptions: [], risks: [], followups: ['Order a card terminal'] },
  })))
  const change = await owner.post(`${BASE}/${opening.id}/change`, { request: 'Copy everything from Ware please' })
  assert.equal(change.status, 200, change.body)
  opening = change.json
  assert.equal(opening.status, 'ready')
  assert.equal(stepOf(lastRequest()).change_request, 'Copy everything from Ware please')
})

test('another tenant and people without access', async () => {
  const b = as(B.owner, ids.b)
  assert.equal((await b.get(`${BASE}/${opening.id}`)).status, 404)
  assert.equal((await b.patch(`${BASE}/${opening.id}`, { title: 'Mine' })).status, 404)
  assert.equal((await b.post(`${BASE}/${opening.id}/create`, {})).status, 404)
  assert.equal((await b.post(`${BASE}/${opening.id}/answers`, { answers: {} })).status, 404)
  assert.equal((await b.delete(`${BASE}/${opening.id}`)).status, 404)
  assert.ok(!(await ok(b.get(BASE))).some(o => o.id === opening.id))
  assert.equal((await b.post(BASE, { input: 'A new place copied from theirs', template_venue_id: ware })).status, 404)

  const viewer = as(A.viewer, ids.a)
  assert.equal((await viewer.get(`${BASE}/${opening.id}`)).status, 200, 'View on Venues reads it')
  assert.equal((await viewer.post(BASE, { input: 'Another new store somewhere nice' })).status, 403)
  assert.equal((await viewer.post(`${BASE}/${opening.id}/create`, {})).status, 403)
  assert.equal((await viewer.patch(`${BASE}/${opening.id}`, { title: 'x' })).status, 403)
  const operator = as(A.operator, ids.a)
  assert.equal((await operator.post(BASE, { input: 'Another new store somewhere nice' })).status, 403, 'operators only view venues')
})

test('busy: a second step while Pepper works on one is refused', async () => {
  await sql`UPDATE store_openings SET busy_until = now() + interval '1 minute' WHERE id = ${opening.id}`
  const res = await owner.post(`${BASE}/${opening.id}/answers`, { answers: {} })
  assert.equal(res.status, 409)
  assert.equal((await owner.post(`${BASE}/${opening.id}/create`, {})).status, 409)
  await sql`UPDATE store_openings SET busy_until = NULL WHERE id = ${opening.id}`
})

test('create: the location is copied whole, pointing only at its own rows', async () => {
  const res = await owner.post(`${BASE}/${opening.id}/create`, {})
  assert.equal(res.status, 200, res.body)
  const o = res.json
  assert.equal(o.status, 'created')
  assert.equal(o.venue.name, 'Zqx Leeds Briggate')
  assert.equal(o.venue.slug, 'zqx-ware-2')
  const V = o.venue.id
  for (const key of AREA_KEYS) {
    const r = o.results[key]
    if (['emails', 'deliveroo'].includes(key)) assert.equal(r.status, 'skipped', key)
    else assert.equal(r.status, 'done', key + ': ' + JSON.stringify(r))
  }
  const [t] = await sql`SELECT count(*)::int AS n FROM tables WHERE venue_id = ${V} AND NOT is_unallocated`
  assert.equal(t.n, 3)
  const [combo] = await sql`SELECT count(*)::int AS n FROM table_combination_members m JOIN table_combinations c ON c.id = m.combination_id WHERE c.venue_id = ${V}`
  assert.equal(combo.n, 2)
  const [days] = await sql`SELECT count(*)::int AS n FROM venue_schedule_templates WHERE venue_id = ${V} AND is_open`
  assert.equal(days.n, 7)
  const [closed] = await sql`SELECT date_from::text, date_to::text FROM schedule_exceptions WHERE venue_id = ${V} AND name = 'Not open yet'`
  assert.equal(closed.date_to, '2026-12-04', 'closed for bookings until the day before opening')
  const [pos] = await sql`SELECT p.pin_salt, t.pin_salt AS tpl_salt, p.receipt_name, p.kds_active_flow_id FROM pos_settings p, pos_settings t WHERE p.venue_id = ${V} AND t.venue_id = ${ware}`
  assert.notEqual(pos.pin_salt, pos.tpl_salt, 'its own PIN salt')
  assert.equal(pos.receipt_name, 'Zqx Leeds Briggate')
  const devices = await sql`SELECT kind, secret_hash, paired_at, settings FROM pos_devices WHERE venue_id = ${V}`
  assert.ok(devices.length >= 1)
  assert.ok(devices.every(d => d.secret_hash === null && d.paired_at === null), 'devices wait to be linked')
  const [ordering] = await sql`SELECT is_enabled FROM ordering_settings WHERE venue_id = ${V}`
  assert.equal(ordering.is_enabled, false, 'ordering stays off until opening')
  const [sv] = await sql`SELECT account_ref FROM supplier_venues WHERE venue_id = ${V}`
  assert.equal(sv.account_ref, null, 'supplier account numbers aren\'t copied')
  const [par] = await sql`SELECT p.par_base::float8 AS mine, t.par_base::float8 AS theirs FROM order_list_pars p JOIN order_list_pars t ON t.list_item_id = p.list_item_id AND t.venue_id = ${ware} WHERE p.venue_id = ${V}`
  assert.equal(par.mine, par.theirs * 1.5, 'pars scaled')
  const [web] = await sql`SELECT address_line1, city, postcode FROM website_config WHERE venue_id = ${V}`
  assert.deepEqual({ ...web }, { address_line1: '1 Briggate', city: 'Leeds', postcode: 'LS1 6HD' })
  const [staff] = await sql`SELECT s.name, r.name AS role FROM cash_staff s LEFT JOIN staff_roles r ON r.id = s.role_id WHERE s.venue_id = ${V}`
  assert.deepEqual({ ...staff }, { name: 'Ann Lee', role: 'Zqx Chef' })

  // Nothing in the new location points at the one it was copied from.
  // (The opening itself names the location it was copied from, on purpose.)
  const tables = (await sql`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'venue_id'`).map(r => r.table_name).filter(t => t !== 'store_openings')
  const owned = new Set([ware])
  for (const tb of tables) for (const r of await sql`SELECT * FROM ${sql(tb)} WHERE venue_id = ${ware}`) if (r.id) owned.add(r.id)
  const children = [
    sql`SELECT row_to_json(m)::text AS j FROM table_combination_members m JOIN table_combinations c ON c.id = m.combination_id WHERE c.venue_id = ${V}`,
    sql`SELECT row_to_json(i)::text AS j FROM checklist_template_items i JOIN checklist_templates t ON t.id = i.template_id WHERE t.venue_id = ${V}`,
    sql`SELECT row_to_json(w)::text AS j FROM hs_dashboard_widgets w JOIN hs_dashboards d ON d.id = w.dashboard_id WHERE d.venue_id = ${V}`,
    sql`SELECT row_to_json(g)::text AS j FROM website_gallery_images g JOIN website_config c ON c.id = g.website_config_id WHERE c.venue_id = ${V}`,
  ]
  let scanned = 0
  const leaks = []
  for (const tb of tables) {
    for (const r of await sql`SELECT row_to_json(x)::text AS j FROM ${sql(tb)} x WHERE venue_id = ${V}`) {
      scanned++
      for (const id of owned) if (r.j.includes(id)) leaks.push(tb + ': ' + r.j.slice(0, 160))
    }
  }
  for (const q of children) for (const r of await q) { scanned++; for (const id of owned) if (r.j.includes(id)) leaks.push(r.j.slice(0, 160)) }
  assert.ok(scanned > 50, 'scanned ' + scanned)
  assert.deepEqual(leaks, [])

  // Follow-ups: what's left, from the results, the location copied from and Pepper's brief.
  const keys = o.followups.map(f => f.key)
  for (const k of ['link_devices', 'printers', 'website', 'ordering', 'bookings', 'suppliers', 'team', 'gloriafood', 'pepper-1']) assert.ok(keys.includes(k), k + ' in ' + keys)
  const tick = await owner.patch(`${BASE}/${opening.id}/followups/website`, { done: true })
  assert.equal(tick.status, 200, tick.body)
  assert.equal(tick.json.followups.find(f => f.key === 'website').done, true)
  assert.equal((await owner.patch(`${BASE}/${opening.id}/followups/nope`, { done: true })).status, 404)

  // Done is done.
  assert.equal((await owner.post(`${BASE}/${opening.id}/create`, {})).status, 422)
  assert.equal((await owner.post(`${BASE}/${opening.id}/answers`, { answers: {} })).status, 422)
  assert.equal((await owner.patch(`${BASE}/${opening.id}`, { title: 'x' })).status, 422)
  assert.equal((await owner.delete(`${BASE}/${opening.id}`)).status, 422)
  const list = await ok(owner.get(BASE))
  assert.equal(list.find(x => x.id === opening.id).venue_name, 'Zqx Leeds Briggate')
})

test('set up new, with no location to copy from', async () => {
  const days = [1, 2, 3, 4, 5, 6].map(day => ({ day, open: true, sittings: [{ name: 'All day', opens_at: '12:00', closes_at: '22:00', max_covers: 0 }] }))
  claude.script.push(reply(answer({
    ready: true, title: 'Manchester',
    plan: {
      venue: { name: 'Zqx Manchester', slug: 'zqx-manchester', timezone: 'Europe/London', currency: 'GBP' },
      areas: AREA_KEYS.map(key => ({ key, mode: 'new', note: '', deep_dive: false })),
      hours: { slot_interval_mins: 30, days: [...days, { day: 0, open: false, sittings: [] }] },
      tables: { sections: [{ name: 'Main', tables: [{ label: 'T1', min_covers: 1, max_covers: 4 }, { label: 'T2', min_covers: 1, max_covers: 4 }] }] },
      till: { receipt_name: '', streams: [{ name: 'Restaurant', service_charge_percent: 12.5 }] },
      devices: { tills: 2, kitchen_screens: 1, kiosks: 1, menu_screens: 2 },
      food_safety: { equipment: [{ name: 'Walk-in', type: 'fridge' }, { name: 'Chest', type: 'freezer' }], check_times: ['09:00', '16:00'], hold_stations: [{ name: 'Pass', hold_type: 'hot' }], hold_check_times: ['12:00'], cooking_sessions: [{ label: 'Lunch', time: '12:00', required: 2 }] },
      checklists: [{ name: 'Opening', frequency: 'daily', tasks: ['Lights on', 'Fridges checked'] }],
    },
    brief: { headline: 'Manchester from scratch', summary: 'All new.', highlights: [], assumptions: [], risks: [], followups: [] },
  })))
  const res = await owner.post(BASE, { input: 'Zqx Manchester, a brand new format, set everything up fresh.' })
  assert.equal(res.status, 201, res.body)
  assert.equal(res.json.status, 'ready')
  const modes = Object.fromEntries(res.json.areas.map(a => [a.key, a.mode]))
  assert.equal(modes.emails, 'skip', 'an area that can only be copied is left out')
  assert.equal(modes.staff, 'skip', 'no people named: nothing to set up')
  const made = await ok(owner.post(`${BASE}/${res.json.id}/create`, {}))
  const V = made.venue.id
  assert.equal(made.results.tables.status, 'done')
  const [t] = await sql`SELECT count(*)::int AS n FROM tables WHERE venue_id = ${V}`
  assert.equal(t.n, 2)
  const sittings = await sql`SELECT s.opens_at::text FROM venue_sittings s WHERE s.venue_id = ${V}`
  assert.equal(sittings.length, 6)
  const devices = await sql`SELECT kind, count(*)::int AS n FROM pos_devices WHERE venue_id = ${V} GROUP BY kind ORDER BY kind`
  assert.deepEqual(devices.map(d => d.kind + d.n), ['kds1', 'kiosk1', 'terminal2'])
  const screens = await sql`SELECT short_code FROM screens WHERE tenant_id = ${ids.a} ORDER BY short_code`
  assert.equal(new Set(screens.map(s => s.short_code)).size, screens.length, 'menu screen codes stay unique in the tenant')
  const [eq] = await sql`SELECT count(*)::int AS n FROM fs_equipment WHERE venue_id = ${V}`
  assert.equal(eq.n, 2)
  const [cash] = await sql`SELECT count(*)::int AS n FROM cash_payment_channels WHERE venue_id = ${V}`
  assert.equal(cash.n, 2)
  const [items] = await sql`SELECT count(*)::int AS n FROM checklist_template_items i JOIN checklist_templates t ON t.id = i.template_id WHERE t.venue_id = ${V}`
  assert.equal(items.n, 2)
  const [stream] = await sql`SELECT service_charge_percent::float8 AS pct FROM pos_revenue_streams WHERE venue_id = ${V}`
  assert.equal(stream.pct, 12.5)
})

test('someone who can\'t set up an area: it is left out and listed for someone else', async () => {
  // Give operators Manage on Venues (and nothing else new).
  const roles = await ok(owner.get('/api/access/roles'))
  const op = (roles.roles || roles).find(r => r.key === 'operator')
  await ok(owner.patch('/api/access/roles/' + op.id, { permissions: { ...(op.permissions || {}), venues: 'manage' } }))
  const operator = as(A.operator, ids.a)
  claude.script.push(reply(answer({
    ready: true,
    plan: { venue: { name: 'Zqx York', slug: 'zqx-york', timezone: 'Europe/London', currency: 'GBP' }, template_venue_id: ware, areas: copyAll() },
    brief: { headline: 'York', summary: 'Copied.', highlights: [], assumptions: [], risks: [], followups: [] },
  })))
  const res = await operator.post(BASE, { input: 'Zqx York, the same as Ware in every way.' })
  assert.equal(res.status, 201, res.body)
  const step = stepOf(lastRequest())
  assert.ok(!step.can_set_up.includes('till'), 'Pepper is told what they can set up')
  assert.ok(!step.can_set_up.includes('cash'), 'Cash Recon setup needs an owner or admin')
  assert.ok(step.can_set_up.includes('booking_rules') === false)
  assert.equal(res.json.areas.find(a => a.key === 'till').can_set_up, false)
  const made = await ok(operator.post(`${BASE}/${res.json.id}/create`, {}))
  assert.equal(made.results.till.status, 'no_access')
  assert.equal(made.results.cash.status, 'no_access')
  assert.equal(made.results.hours.status, 'no_access', 'Schedule is view only for operators')
  assert.equal(made.results.food_safety.status, 'done', 'operators manage food safety')
  const [pos] = await sql`SELECT count(*)::int AS n FROM pos_settings WHERE venue_id = ${made.venue.id}`
  assert.equal(pos.n, 0)
  assert.ok(made.followups.some(f => f.key === 'access-till'))
  await ok(owner.patch('/api/access/roles/' + op.id, { permissions: { ...(op.permissions || {}), venues: 'view' } }))
})

test('a failed first look keeps the draft, and the last round always ends in a brief', async () => {
  claude.script.push(() => ({ status: 400, type: 'invalid_request_error', message: 'nope' }))
  const res = await owner.post(BASE, { input: 'A pop-up kitchen in Bristol for the summer.' })
  assert.equal(res.status, 201, res.body)
  assert.equal(res.json.status, 'draft')
  assert.ok(res.json.error)
  assert.equal(res.json.busy, false)
  assert.equal((await owner.post(`${BASE}/${res.json.id}/create`, {})).status, 422, 'nothing to create yet')

  const ask = (round) => reply(answer({ plan: { venue: { name: 'Zqx Bristol', slug: '', timezone: 'Europe/London', currency: 'GBP' }, areas: [] },
    questions: [{ id: 'more', area: 'basics', text: 'Round ' + round + '?', why: '', kind: 'yesno', options: [], suggested: 'yes' }] }))
  claude.script.push(ask(1))
  let o = await ok(owner.post(`${BASE}/${res.json.id}/scope`, {}))
  assert.equal(o.status, 'questions')
  for (let round = 2; round <= MAX_ROUNDS; round++) {
    claude.script.push(ask(round))
    o = await ok(owner.post(`${BASE}/${o.id}/answers`, { answers: { [o.questions[0].id]: 'yes' } }))
  }
  assert.equal(o.status, 'ready', 'questions in the last round are dropped')
  assert.equal(o.rounds, MAX_ROUNDS)
  assert.equal(o.plan.venue.slug_final, 'zqx-bristol')
  assert.equal(o.brief.headline, 'Leeds', 'a missing brief headline falls back to the title')
  assert.equal((await owner.delete(`${BASE}/${o.id}`)).status, 200)
  assert.equal((await owner.get(`${BASE}/${o.id}`)).status, 404)
})

test('Pepper: plans a new location in the chat and creates it from a Confirm card', async () => {
  const text = s => [{ type: 'text', text: s }]
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_p1', name: 'plan_new_location', input: { description: 'Zqx Hull, just like Ware, opening in January.', copy_from: 'Ware' } }] }),
    reply(answer({
      ready: true, title: 'Hull',
      plan: { venue: { name: 'Zqx Hull', slug: 'zqx-hull', timezone: 'Europe/London', currency: 'GBP' }, template_venue_id: ware, areas: copyAll(), opening_date: '2027-01-15' },
      brief: { headline: 'Zqx Hull opens 15 January', summary: 'A copy of Ware.', highlights: [], assumptions: [], risks: [], followups: [] },
    })),
    () => ({ stop_reason: 'end_turn', content: text('Here is the plan for Hull.') }),
  )
  const r = await ok(owner.post('/api/ai/chat', { message: 'Plan a new store in Hull like Ware' }))
  const toolResult = claude.requests.at(-1).body.messages.at(-1).content.find(b => b.type === 'tool_result')
  assert.ok(!toolResult.is_error, toolResult.content?.[0]?.text)
  const planned = JSON.parse(toolResult.content[0].text)
  assert.equal(planned.status, 'ready')
  assert.equal(planned.location.copying_from, 'Zqx Ware')
  assert.equal(planned.location.opening_date, '2027-01-15')
  assert.match(planned.link, /^\/new-location\/[0-9a-f-]{36}$/)
  assert.ok(planned.brief.headline)
  const step = stepOf(claude.requests.at(-2).body)
  assert.equal(step.person_choices.template_venue_id, ware, 'copy_from went to the planner as the person\'s choice')

  // A direct change: the website left for later.
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_p2', name: 'change_location_plan', input: { opening: 'Hull', ways: [{ area: 'website', way: 'later' }] } }] }),
    () => ({ stop_reason: 'end_turn', content: text('Done.') }),
  )
  await ok(owner.post('/api/ai/chat', { conversation_id: r.conversation_id, message: 'Leave the website for later' }))
  const changed = JSON.parse(claude.requests.at(-1).body.messages.at(-1).content.find(b => b.type === 'tool_result').content[0].text)
  assert.equal(changed.areas.find(a => a.area === 'website').way, 'later')

  // The card, then Confirm.
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_p3', name: 'create_location', input: { opening: 'Hull' } }] }),
    () => ({ stop_reason: 'end_turn', content: text('Press Create when ready.') }),
  )
  await ok(owner.post('/api/ai/chat', { conversation_id: r.conversation_id, message: 'Create it' }))
  const [card] = await sql`SELECT id, card FROM ai_pending_actions WHERE conversation_id = ${r.conversation_id} AND tool = 'create_location'`
  assert.equal(card.card.title, 'Create Zqx Hull?')
  assert.ok(card.card.lines.some(l => /Copying from Zqx Ware, opening 2027-01-15/.test(l)))
  assert.ok(!card.card.lines.some(l => /^Location page/.test(l)), 'areas left for later aren\'t on the card')
  assert.equal((await sql`SELECT 1 FROM venues WHERE tenant_id = ${ids.a} AND name = 'Zqx Hull'`).length, 0, 'nothing made before Confirm')
  await ok(owner.post(`/api/ai/actions/${card.id}/confirm`, {}))
  const [v] = await sql`SELECT id FROM venues WHERE tenant_id = ${ids.a} AND name = 'Zqx Hull'`
  assert.ok(v, 'the location was created')
  const [web] = await sql`SELECT count(*)::int AS n FROM website_config WHERE venue_id = ${v.id}`
  assert.equal(web.n, 0, 'the website was left for later')
  const [audit] = await sql`SELECT ok FROM ai_actions WHERE tenant_id = ${ids.a} AND tool = 'create_location'`
  assert.equal(audit.ok, true)

  // A viewer can list but not plan.
  claude.script.push(
    () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_p4', name: 'plan_new_location', input: { description: 'Another one somewhere else please' } }] }),
    () => ({ stop_reason: 'end_turn', content: text('No access.') }),
  )
  await ok(as(A.operator, ids.a).post('/api/ai/chat', { message: 'Plan another' }))
  const refused = claude.requests.at(-1).body.messages.at(-1).content.find(b => b.type === 'tool_result')
  assert.equal(refused.is_error, true)
  assert.match(refused.content[0].text, /Venues|venues/)
})

test('a shared kitchen flow in use at the location copied from stays in use at the new one', async () => {
  // Ware puts the fixtures' shared flow (migration 192) in use.
  const setup = await ok(owner.get(`/api/pos/venues/${ware}/setup`))
  const shared = setup.kds_flows.find(f => f.shared)
  assert.ok(shared, 'the fixtures made a shared flow')
  await ok(owner.put(`/api/pos/venues/${ware}/kds-flows/active`, { flow_id: shared.id }))
  claude.script.push(reply(answer({
    ready: true,
    plan: { venue: { name: 'Zqx Bath', slug: 'zqx-bath', timezone: 'Europe/London', currency: 'GBP' }, template_venue_id: ware, areas: copyAll() },
    brief: { headline: 'Bath', summary: 'Copied.', highlights: [], assumptions: [], risks: [], followups: [] },
  })))
  const res = await owner.post(BASE, { input: 'Zqx Bath, the same as Ware in every way.' })
  assert.equal(res.status, 201, res.body)
  const made = await ok(owner.post(`${BASE}/${res.json.id}/create`, {}))
  const [pos] = await sql`SELECT kds_active_flow_id FROM pos_settings WHERE venue_id = ${made.venue.id}`
  assert.equal(pos.kds_active_flow_id, shared.id, 'the shared flow, not a copy')
  const own = await sql`SELECT name FROM kds_flows WHERE tenant_id = ${ids.a} AND venue_id = ${made.venue.id}`
  assert.ok(own.length > 0, 'Ware\'s own flows are copied as Bath\'s own')
  assert.equal((await sql`SELECT count(*)::int AS n FROM kds_flows WHERE tenant_id = ${ids.a} AND venue_id IS NULL`)[0].n, 1, 'the shared flow isn\'t copied')
})
