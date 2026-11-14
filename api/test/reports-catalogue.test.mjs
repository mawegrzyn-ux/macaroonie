// The report catalogue against the database (docs/REPORTS.md 5.3, 5.6 and
// section 19, "Catalogue"):
//
//   every table has one decision: a subject reads it, it is planned, it is
//     settings, or it is left out with a reason
//   every id column of a table a subject reads is linked, offered or left
//     out on purpose (a new link can't be missed); other new columns are
//     listed as "not offered yet" without failing
//   nothing that must stay secret is read, and nothing of the SQL leaves
//     the server
//   every field, grouping, figure and link of every subject runs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, closeApp, sql } from './support/app.mjs'
import { resetAndSeed, A } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays } from './support/tillDays.mjs'
import { runner } from './support/reports.mjs'
import { CATALOGUE, CATALOGUE_MODULES, AREAS, catalogueView } from '../src/reports/catalogue/index.js'
import { PLANNED, SETTINGS, LEFT_OUT, checkDecisions, tableDecisions, catalogueTables } from '../src/reports/catalogue/decisions.js'
import { tableCoverage, secretsRead, columnUse } from '../src/reports/catalogue/coverage.js'
import { MODULE_KEYS } from '../src/config/modules.js'
import { bucketsFor } from '../../shared/reports/paths.js'
import { EVENT_LABELS, TILL_EVENT_TYPES } from '../src/reports/catalogue/till.js'

let ids, columns, tables

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  await sellTwoDays({ owner: as(A.owner, ids.a), tenantId: ids.a, filled })
  columns = await sql`
    SELECT c.table_name AS "table", c.column_name AS "column", c.data_type AS type
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name, c.ordinal_position`
  tables = [...new Set(columns.map(c => c.table))]
})
after(closeApp)

test('every table in the database has one decision, and every decision names a table', () => {
  const d = checkDecisions(CATALOGUE, tables)
  assert.deepEqual(d.missing, [], 'tables with no decision: add a subject that reads them, or a line in src/reports/catalogue/decisions.js')
  assert.deepEqual(d.twice, [], 'tables decided more than once')
  assert.deepEqual(d.gone, [], 'decisions.js names tables that are gone')
  assert.equal(d.counts.subject + d.counts.planned + d.counts.settings + d.counts.out, tables.length)

  // Where the catalogue stands today: a change here is a change to say in the docs.
  assert.deepEqual(d.counts, { subject: 101, planned: 27, settings: 57, out: 48 })
  assert.equal(tables.length, 233)

  // Left-out tables carry a reason; planned ones an area with a phase.
  for (const [reason, list] of Object.entries(LEFT_OUT)) {
    assert.ok(reason.trim().length > 8, 'a reason: ' + reason)
    assert.ok(list.length, reason + ' leaves nothing out')
  }
  for (const [area, a] of Object.entries(PLANNED)) {
    assert.ok(Array.isArray(a.happen) && Array.isArray(a.group), area)
    assert.ok(a.happen.length + a.group.length > 0, area + ' plans nothing')
    assert.ok([3, 4, 5, undefined].includes(a.phase), area + ' phase')
  }
  assert.equal(new Set(SETTINGS).size, SETTINGS.length)

  // The tables report subjects read are the ones the catalogue says it reads.
  const read = catalogueTables(CATALOGUE)
  assert.deepEqual(read.get('pos_check_lines'), ['till.lines', 'till.voids'])
  assert.deepEqual(read.get('cash_staff'), ['till.takers', 'rota.staff_weeks', 'rota.weeks', 'rota.pot_weeks', 'rota.tip_shares', 'staff.people'])
  assert.deepEqual(read.get('gloriafood_orders'), ['online.sales'])
  assert.deepEqual(read.get('kds_log'), ['kitchen.tickets', 'kitchen.remakes'])
  assert.equal(tableDecisions(CATALOGUE).find(x => x.table === 'reviews').area, 'guests')
  // The rota's own rows, and the weeks and days worked out from them.
  assert.deepEqual(read.get('rota_entries'), ['rota.staff_weeks', 'rota.weeks', 'rota.days', 'rota.pot_weeks', 'rota.tip_shares', 'rota.entries'])
  // A table read by rows worked out for each run counts as read by them.
  assert.deepEqual(read.get('cash_wage_entries'), ['cash.days', 'cash.weeks', 'cash.wages', 'rota.staff_weeks', 'rota.weeks', 'rota.pot_weeks', 'rota.tip_shares'])
  assert.deepEqual(read.get('fs_temp_logs'), ['safety.fridge_checks', 'safety.days'])
  assert.equal(tableDecisions(CATALOGUE).find(x => x.table === 'supply_order_lines').reason, 'Filled in until placed, then copied onto the purchase order lines reports read')
  assert.equal(tableDecisions(CATALOGUE).find(x => x.table === 'report_runs').phase, 4)
  assert.equal(tableDecisions(CATALOGUE).find(x => x.table === 'platform_secrets').reason, 'Secrets and keys')
})

test('a table nobody has decided on, one decided twice and a stale name are each caught', () => {
  const d = checkDecisions(CATALOGUE, [...tables.filter(t => t !== 'nav_items'), 'brand_new_table'])
  assert.deepEqual(d.missing, ['brand_new_table'])
  assert.deepEqual(d.gone, ['nav_items'])
  // A subject's table that is also listed by hand counts twice.
  const twice = checkDecisions({ subjects: { ...CATALOGUE.subjects, x: { key: 'x', from: { table: 'tenants', tables: ['tenants'] } } } }, tables)
  assert.deepEqual(twice.twice, ['tenants'])
})

test('every id column of a table a subject reads is linked, offered or left out on purpose', t => {
  const cover = tableCoverage(CATALOGUE, columns)
  assert.deepEqual(cover.derived, ['till.takers', 'online.sales', 'cash.days', 'cash.weeks', 'rota.staff_weeks', 'rota.weeks', 'rota.days', 'rota.pot_weeks', 'rota.tip_shares', 'rota.tip_moves', 'safety.days', 'local.weather'])
  assert.equal(cover.tables.length, 90)

  const undecided = cover.tables.flatMap(x => x.idsUndecided.map(c => x.table + '.' + c))
  assert.deepEqual(undecided, [], 'id columns with no link: add one(...) to the subject, or the column to its skip list')
  const stale = cover.tables.flatMap(x => x.stale.map(c => x.table + '.' + c))
  assert.deepEqual(stale, [], 'skip lists naming a column that is gone, or one a field reads after all')
  const unknown = cover.tables.flatMap(x => x.unknown.map(c => x.table + '.' + c))
  assert.deepEqual(unknown, [], 'a subject reads a column its table doesn\'t have')

  // Other columns nobody has looked at yet don't fail the test (a new column
  // mustn't hold a deploy up): they are listed, with how many are waiting.
  // Offer each as a field, or add it to its subject's skip list.
  const waiting = cover.tables.filter(x => x.notOffered.length)
  t.diagnostic('Columns not offered yet: ' + waiting.reduce((n, x) => n + x.notOffered.length, 0))
  for (const x of waiting) t.diagnostic('  ' + x.table + ': ' + x.notOffered.join(', '))
})

test('a new column on a known table is listed, and a new id column is asked about', () => {
  const more = [
    ...columns,
    { table: 'pos_checks', column: 'weather', type: 'text' },
    { table: 'pos_checks', column: 'driver_id', type: 'uuid' },
    { table: 'bookings', column: 'handed_to', type: 'uuid' },
    { table: 'orders', column: 'courier_id', type: 'text' },
  ]
  const cover = tableCoverage(CATALOGUE, more)
  const of = name => cover.tables.find(x => x.table === name)
  assert.deepEqual(of('pos_checks').notOffered, ['weather', 'driver_id'])
  assert.deepEqual(of('pos_checks').idsUndecided, ['driver_id'])
  assert.deepEqual(of('bookings').idsUndecided, ['handed_to'])
  assert.deepEqual(of('orders').idsUndecided, ['courier_id'])
  // A column that is taken away while a subject still reads it, or still skips it.
  const fewer = tableCoverage(CATALOGUE, columns.filter(c => !(c.table === 'bookings' && ['covers', 'manage_token'].includes(c.column))))
  assert.deepEqual(fewer.tables.find(x => x.table === 'bookings').unknown, ['covers'])
  assert.deepEqual(fewer.tables.find(x => x.table === 'bookings').stale, ['manage_token'])
})

test('what each subject uses of its table: its own columns, and the far side of links', () => {
  const { tables: use } = columnUse(CATALOGUE)
  // A check's lines are found by the lines' own check_id (the "many" link on checks).
  assert.ok(use.get('pos_check_lines').used.has('check_id'))
  // A field written as SQL counts for the columns it reads.
  assert.ok(use.get('menu_items').used.has('image_url'), 'has_photo reads image_url')
  assert.ok(use.get('order_promotions').used.has('combo_item_id'), 'kind reads combo_item_id')
  assert.ok(use.get('pos_days').used.has('figures'))
  assert.ok(use.get('bookings').used.has('tenant_id'))
  assert.ok(use.get('bookings').skipped.has('manage_token'))
  assert.ok(!use.get('bookings').used.has('manage_token'))

  // The far side: a "many" link's column is on the other subject's rows, and
  // a "one" link's `on` names a column of the row it leads to.
  const bare = (key, table, links = {}) => ({ key, from: { table, sql: null, tables: [table] }, id: { sql: '{t}.id' }, tenant: 'tenant_id', where: null, fields: {}, measures: {}, links, skip: [] })
  const tiny = { subjects: {
    a: bare('a', 'ta', { bs: { key: 'bs', to: 'b', many: true, sql: '{t}.a_ref' }, b: { key: 'b', to: 'b', many: false, sql: '{t}.b_code', on: 'code' } }),
    b: bare('b', 'tb'),
  } }
  const u = columnUse(tiny).tables
  assert.deepEqual([...u.get('ta').used].sort(), ['b_code', 'id', 'tenant_id'])
  assert.deepEqual([...u.get('tb').used].sort(), ['a_ref', 'code', 'id', 'tenant_id'])
})

test('nothing secret is read, every module asked for exists, and no SQL leaves the server', () => {
  assert.deepEqual(secretsRead(CATALOGUE), [])
  // The check itself catches a template that reads one.
  const leaky = { subjects: { x: { key: 'x', from: { table: 'cash_staff', sql: null, tables: ['cash_staff'] }, id: { sql: '{t}.id' }, where: null, fields: { pin: { key: 'pin', sql: '{t}.pin_hash' } }, measures: {}, links: {} } } }
  assert.deepEqual(secretsRead(leaky), [{ where: 'x field pin', column: 'pin_hash' }])
  // Subjects written as their own SELECT name their columns one by one: none of them a secret.
  for (const s of Object.values(CATALOGUE.subjects)) {
    if (s.from.sql) assert.doesNotMatch(s.from.sql, /\*|pin_hash|secret_hash|manage_token|public_token|poll_key|push_token/, s.key)
  }

  for (const m of CATALOGUE_MODULES) assert.ok(MODULE_KEYS.includes(m), m)
  assert.deepEqual([...CATALOGUE_MODULES].sort(), [
    'bookings', 'cash_recon', 'checklists', 'customers', 'email_templates', 'food_safety', 'hs_action_log', 'local_info', 'loyalty', 'loyalty_members',
    'menus', 'pos_reports', 'pos_setup', 'promotions', 'purchasing', 'purchasing_setup', 'rota', 'rota_pay', 'rota_tips', 'staff',
    'web_orders',
  ])
  for (const s of Object.values(CATALOGUE.subjects)) {
    assert.ok(AREAS.some(a => a.key === s.area), s.key + ' area')
    // Only the venue list is open to everyone who can use reports.
    if (s.key !== 'venue') assert.ok(s.module, s.key + ' needs a module')
    assert.ok(s.about.length > 20, s.key + ' says what it is')
    for (const f of Object.values(s.fields)) assert.ok(f.label && f.type, s.key + '.' + f.key)
  }

  const everything = Object.fromEntries(MODULE_KEYS.map(k => [k, 'manage']))
  const view = catalogueView(everything)
  const text = JSON.stringify(view)
  assert.doesNotMatch(text, /\{t\}|SELECT |"sql"|"col"|"from"|"where"|"tenant"|"skip"|tenant_id/)
  assert.equal(Object.keys(view.subjects).length, Object.keys(CATALOGUE.subjects).length)
  assert.deepEqual(view.areas, AREAS)
  // Personal data is marked for the builder.
  assert.equal(view.subjects['bookings.bookings'].fields.guest_notes.pii, true)
  assert.equal(view.subjects['online.orders'].fields.allergy_note.pii, true)
  assert.equal(view.subjects['guests.customers'].fields.notes.pii, true)
})

test('every kind of till change has its words in reports', () => {
  // Till activity and Changes refused name each event type: a new type the
  // till sends must get words, and words for a type that is gone go.
  assert.deepEqual(TILL_EVENT_TYPES.filter(t => !EVENT_LABELS[t]), [])
  assert.deepEqual(Object.keys(EVENT_LABELS).filter(t => !TILL_EVENT_TYPES.includes(t)), [])
})

test('every field, grouping, figure and link of every subject runs', async () => {
  const levels = Object.fromEntries([...CATALOGUE_MODULES, 'reports'].map(k => [k, 'view']))
  const run = runner(ids.a)
  const failed = []
  let ran = 0
  const attempt = async (what, spec) => {
    try { await run(spec, {}, { levels }); ran++ } catch (e) { failed.push(what + ': ' + (e.problems || [e.message]).join(' | ').slice(0, 300)) }
  }
  for (const s of Object.values(CATALOGUE.subjects)) {
    // A subject reached only through links (a day's Cash Recon report) can't
    // start a report: its fields run through the links that lead to it (below).
    if (s.hidden) {
      await assert.rejects(run({ kind: 'list', subject: s.key, rows: [{ field: Object.keys(s.fields)[0] }] }, {}, { levels }), /nothing to report on/, s.key)
      continue
    }
    const fields = Object.keys(s.fields)
    // Its fields as a list, 25 at a time.
    for (let i = 0; i < fields.length; i += 25) await attempt(s.key + ' list', { kind: 'list', subject: s.key, rows: fields.slice(i, i + 25).map(f => ({ field: f })) })
    // Each field as a grouping, with each way a date or a moment can be grouped.
    for (const f of Object.values(s.fields)) {
      const buckets = bucketsFor(f.type).length ? bucketsFor(f.type) : [null]
      for (const b of buckets) {
        await attempt(s.key + ' by ' + f.key + (b ? ':' + b : ''), { kind: 'summary', subject: s.key, rows: [{ field: f.key, ...(b ? { bucket: b } : {}) }], values: [{ agg: 'count' }] })
      }
    }
    // Its figures, 15 at a time.
    const ms = Object.keys(s.measures)
    for (let i = 0; i < ms.length; i += 15) await attempt(s.key + ' figures', { kind: 'summary', subject: s.key, values: ms.slice(i, i + 15).map(m => ({ measure: m })) })
    for (const l of Object.values(s.links)) {
      const to = CATALOGUE.subjects[l.to]
      if (l.many) {
        // A figure of the rows that point at this one, and "has any".
        const m = Object.values(to.measures).find(x => !x.ratio && ['sum', 'count'].includes(x.agg))
        if (m) await attempt(s.key + ' ' + l.key + '.' + m.key, { kind: 'summary', subject: s.key, values: [{ measure: l.key + '.' + m.key }] })
        await attempt(s.key + ' has ' + l.key, { kind: 'summary', subject: s.key, values: [{ agg: 'count' }], filters: [{ has: l.key, where: [] }] })
      } else {
        // The row it points at: grouped by its name (by every field of one
        // reached only through links), filtered and counted by the link itself.
        const fs = to.hidden ? Object.keys(to.fields) : [to.name || Object.keys(to.fields)[0]]
        for (const f of fs) {
          const b = bucketsFor(to.fields[f].type)[0]
          await attempt(s.key + ' by ' + l.key + '.' + f, { kind: 'summary', subject: s.key, rows: [{ field: l.key + '.' + f, ...(b ? { bucket: b } : {}) }], values: [{ agg: 'count' }] })
        }
        await attempt(s.key + ' filtered by ' + l.key, { kind: 'summary', subject: s.key, values: [{ agg: 'count' }, { agg: 'count_distinct', field: l.key }], filters: [{ field: l.key, op: 'not_empty' }] })
      }
    }
    // A dated subject over a period, by week, against the period before.
    if (s.fields.date) {
      await attempt(s.key + ' over a period', {
        kind: 'summary', subject: s.key,
        params: [{ key: 'period', type: 'period', default: { relative: 'this_month' } }],
        rows: [{ field: 'date', bucket: 'week' }], values: [{ agg: 'count' }],
        filters: [{ field: 'date', op: 'in_period', param: 'period' }],
        compare: { with: 'previous_period' },
      })
    }
    // The columns a list of it starts with, in its usual order.
    if (s.list.length) await attempt(s.key + ' usual list', { kind: 'list', subject: s.key, rows: s.list.map(f => ({ field: f })), sort: s.sort })
  }
  assert.deepEqual(failed, [])
  assert.ok(ran > 500, 'ran ' + ran)
})
