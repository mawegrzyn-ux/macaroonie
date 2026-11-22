// src/reports/catalogue/kitchen.js
//
// Kitchen screens in the report catalogue: the stations, every ticket a
// station bumped and how long it took, every remake and why, and the
// kitchen's copy of each order.
//
// The rules are the Kitchen report's (Till reports, Kitchen tab): a ticket
// is a bump that wasn't brought back (recalled); its time is from the order
// reaching the station to the bump; on time is within the station's target
// minutes (8 unless set), late is over its late minutes (12 unless set).
// A station deleted since keeps the name it had in the log.

import { subject, text, number, yesno, choice, moment, duration, sum, avg, max, count, countDistinct, ratio, one, many } from './define.js'
import { KITCHEN_DEVICE_EVENTS } from '../../../../shared/pos/kitchen.js'

const DONE = '{t}.recalled_at IS NULL'
const TARGET = "(COALESCE(({station}.settings->>'target_mins')::int, 8) * 60)"
const LATE_AFTER = "(COALESCE(({station}.settings->>'late_mins')::int, 12) * 60)"
const ON_TIME = '({t}.seconds <= ' + TARGET + ')'
const LATE = '({t}.seconds > ' + LATE_AFTER + ')'
const STATION_KINDS = {
  prep: 'Prep', expo: 'Pass', runner: 'Runner', board: 'Order ready board', balance: 'Splitter',
  printer: 'Kitchen printer', sleeper: 'Sleeper', setter: 'Setter',
}
const SOURCES = { till: 'Till or kiosk', online: 'Online ordering', gloriafood: 'GloriaFood' }
const DAY = { sql: '({t}.at AT TIME ZONE {tz})::date', bound: '{t}.at', label: 'Day' }

// The kitchen screen a log row's tap came from (its till event's device, 44.8).
const UUID_RE = "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"
const SCREEN_OF = { sql: '(SELECT CASE WHEN e.device_id ~ ' + UUID_RE + ' THEN e.device_id::uuid END FROM pos_events e WHERE e.id = {t}.event_id AND e.tenant_id = {t}.tenant_id)' }
const KITCHEN_TAPS = {
  'kitchen.item_done': 'Dish done', 'kitchen.item_checked': 'Dish ticked off', 'kitchen.bumped': 'Ticket bumped',
  'kitchen.recalled': 'Ticket brought back', 'kitchen.remake': 'Dish remade', 'kitchen.priority': 'Rush', 'kitchen.collected': 'Collected',
}
const KITCHEN_TAP_LIST = KITCHEN_DEVICE_EVENTS.map(t => "'" + t + "'").join(', ')
const taps = (type, label, about) => count({ label, where: "{t}.type = '" + type + "'", about })

/** What every kitchen log row says about its order and station. */
const logFields = () => ({
  station_name: text({ sql: 'COALESCE({station}.name, {t}.station_name)' }, { label: 'Station' }),
  station_kind: choice({ sql: 'COALESCE({station}.kind, {t}.station_kind)' }, STATION_KINDS, { label: 'Kind of station' }),
  order_source: choice('order_source', SOURCES, { label: 'Order from' }),
  order_type: text('order_type', { label: 'Order type' }),
  order_number: text('order_number', { label: 'Order number' }),
})

export default [
  subject({
    key: 'kitchen.stations',
    label: 'Kitchen stations',
    one: 'station',
    area: 'kitchen',
    module: 'pos_reports',
    about: 'The stations of your kitchen flows (grill, fryer, the pass), with their target times.',
    from: 'kds_stations',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      kind: choice('kind', STATION_KINDS),
      target_mins: number({ sql: "COALESCE(({t}.settings->>'target_mins')::int, 8)" }, { label: 'Target minutes', decimals: 0 }),
      late_mins: number({ sql: "COALESCE(({t}.settings->>'late_mins')::int, 12)" }, { label: 'Late after minutes', decimals: 0 }),
      active: yesno('is_active', { label: 'In use' }),
    },
    measures: { stations: count({ label: 'Stations', where: '{t}.is_active', about: 'Stations in use.' }) },
    links: {
      tickets: many('kitchen.tickets', 'station_id', { label: 'Tickets' }),
    },
    list: ['name', 'venue.name', 'kind', 'target_mins', 'late_mins', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['colour', 'sort_order', 'created_at'],
  }),

  subject({
    key: 'kitchen.tickets',
    label: 'Kitchen tickets',
    one: 'ticket',
    area: 'kitchen',
    module: 'pos_reports',
    about: 'Every ticket a kitchen station bumped, with how long it took from reaching the station. Figures leave out bumps that were brought back.',
    from: 'kds_log',
    where: "{t}.kind = 'bump'",
    venue: 'venue_id',
    date: DAY,
    fields: {
      bumped_at: moment('at', { label: 'Bumped at' }),
      ticket_time: duration('seconds', { label: 'Ticket time' }),
      dishes: number('items', { label: 'Dishes', adds: true, decimals: 0 }),
      on_time: yesno({ sql: ON_TIME }, { label: 'On time' }),
      late: yesno({ sql: LATE }, { label: 'Late' }),
      recalled: yesno({ sql: '({t}.recalled_at IS NOT NULL)' }, { label: 'Brought back' }),
      recalled_at: moment('recalled_at', { label: 'Brought back at' }),
      ...logFields(),
    },
    measures: {
      tickets: count({ label: 'Tickets', where: DONE, about: 'Bumps that weren\'t brought back.' }),
      dishes_total: sum('items', { label: 'Dishes', where: DONE, about: 'Dishes on those tickets.' }),
      average_time: avg('seconds', { type: 'duration', label: 'Average ticket time', where: DONE, about: 'From an order reaching the station to its bump, on average.' }),
      longest: max('seconds', { type: 'duration', label: 'Longest ticket', where: DONE }),
      on_time_count: count({ label: 'On time', where: DONE + ' AND ' + ON_TIME, about: 'Tickets bumped within the station\'s target minutes.' }),
      late_count: count({ label: 'Late', where: DONE + ' AND ' + LATE, about: 'Tickets bumped after the station\'s late minutes.' }),
      on_time_rate: ratio('on_time_count', 'tickets', { type: 'percent', label: 'On time rate', about: 'Tickets on time out of every ticket.' }),
      recalled_count: count({ label: 'Brought back', where: '{t}.recalled_at IS NOT NULL', about: 'Bumps a station brought back to the screen.' }),
    },
    links: {
      station: one('kitchen.stations', 'station_id', { label: 'Station' }),
      kitchen_order: one('kitchen.orders', 'kitchen_order_id', { label: 'Kitchen order' }),
      screen: one('till.devices', SCREEN_OF, { label: 'Kitchen screen', about: 'The kitchen screen that bumped it.' }),
    },
    list: ['date', 'bumped_at', 'venue.name', 'station_name', 'order_number', 'dishes', 'ticket_time', 'on_time'],
    sort: [{ by: 'bumped_at', dir: 'desc' }],
    // When the log row was written.
    skip: ['created_at'],
  }),

  subject({
    key: 'kitchen.remakes',
    label: 'Kitchen remakes',
    one: 'remake',
    area: 'kitchen',
    module: 'pos_reports',
    about: 'Every dish a kitchen station sent back to be made again, with the reason given.',
    from: 'kds_log',
    where: "{t}.kind = 'remake'",
    name: 'dish',
    venue: 'venue_id',
    date: DAY,
    fields: {
      remade_at: moment('at', { label: 'Remade at' }),
      dish: text('item_name', { label: 'Dish' }),
      reason: text('reason', { label: 'Why' }),
      ...logFields(),
    },
    measures: {
      remakes: count({ label: 'Remakes' }),
    },
    links: {
      station: one('kitchen.stations', 'station_id', { label: 'Station' }),
      kitchen_order: one('kitchen.orders', 'kitchen_order_id', { label: 'Kitchen order' }),
      screen: one('till.devices', SCREEN_OF, { label: 'Kitchen screen', about: 'The kitchen screen it was remade from.' }),
    },
    list: ['date', 'remade_at', 'venue.name', 'station_name', 'dish', 'reason', 'order_number'],
    sort: [{ by: 'remade_at', dir: 'desc' }],
  }),

  // Every tap a kitchen screen sent (OUTSTANDING 44.8): by screen and station.
  subject({
    key: 'kitchen.taps',
    label: 'Kitchen screen taps',
    one: 'tap',
    area: 'kitchen',
    module: 'pos_reports',
    about: 'Everything done on a kitchen screen, in order: dishes marked done or ticked off, tickets bumped and brought back, remakes, rushes and orders collected, with the screen and station. Taps while no trading day was open have no day.',
    from: 'pos_events',
    where: '{t}.type IN (' + KITCHEN_TAP_LIST + ') AND {t}.device_id IS NOT NULL',
    idType: 'text',
    venue: 'venue_id',
    date: { sql: '{day}.business_date', label: 'Trading day' },
    fields: {
      type: choice('type', KITCHEN_TAPS, { label: 'Tap' }),
      tapped_at: moment({ sql: 'COALESCE({t}.client_at, {t}.created_at)' }, { label: 'Time' }),
      received_at: moment('created_at', { label: 'Reached us' }),
    },
    measures: {
      taps: count({ label: 'Taps' }),
      dishes_done: taps('kitchen.item_done', 'Dishes marked done', 'Dishes tapped done (or undone) at a prep station.'),
      dishes_ticked: taps('kitchen.item_checked', 'Dishes ticked off', 'Dishes ticked (or unticked) at the pass or a runner.'),
      bumps: taps('kitchen.bumped', 'Tickets bumped'),
      recalls: taps('kitchen.recalled', 'Tickets brought back'),
      remakes: taps('kitchen.remake', 'Remakes'),
      rushes: taps('kitchen.priority', 'Rushes'),
      collected: taps('kitchen.collected', 'Orders collected'),
      orders: countDistinct({ sql: "({t}.payload->>'order_id')" }, { label: 'Orders', about: 'How many different kitchen orders the taps were on.' }),
    },
    links: {
      day: one('till.days', 'day_id', { label: 'Trading day' }),
      screen: one('till.devices', { sql: '(CASE WHEN {t}.device_id ~ ' + UUID_RE + ' THEN {t}.device_id::uuid END)' }, { label: 'Kitchen screen' }),
      station: one('kitchen.stations', { sql: "(CASE WHEN {t}.payload->>'station_id' ~ " + UUID_RE + " THEN ({t}.payload->>'station_id')::uuid END)" }, { label: 'Station' }),
      kitchen_order: one('kitchen.orders', { sql: "({t}.payload->>'order_id')" }, { label: 'Kitchen order' }),
    },
    list: ['tapped_at', 'type', 'screen.name', 'station.name', 'kitchen_order.number'],
    sort: [{ by: 'tapped_at', dir: 'desc' }],
    // The order the cloud put it in, and what the sequencer worked out.
    skip: ['assigned', 'seq'],
  }),

  subject({
    key: 'kitchen.orders',
    label: 'Kitchen orders',
    one: 'kitchen order',
    area: 'kitchen',
    module: 'pos_reports',
    about: 'The kitchen\'s copy of each order sent to it (from a till or kiosk, online ordering or GloriaFood), with when it was ready and collected.',
    from: 'kds_orders',
    idType: 'text',
    name: 'number',
    venue: 'venue_id',
    date: { sql: '({t}.created_at AT TIME ZONE {tz})::date', bound: '{t}.created_at', label: 'Day' },
    fields: {
      number: text({ sql: "({t}.state->>'number')" }, { label: 'Order number' }),
      source: choice('source', SOURCES, { label: 'Order from' }),
      status: choice('status', { active: 'In the kitchen', ready: 'Ready', collected: 'Collected', cancelled: 'Cancelled', merged: 'Joined to another' }),
      order_type: text({ sql: "({t}.state->>'type_name')" }, { label: 'Order type' }),
      stream: text({ sql: "({t}.state->>'stream_name')" }, { label: 'Revenue stream' }),
      came_in_at: moment('created_at', { label: 'Came in at' }),
      ready_at: moment('ready_at', { label: 'Ready at' }),
      collected_at: moment('collected_at', { label: 'Collected at' }),
      to_ready: duration({ sql: 'EXTRACT(EPOCH FROM ({t}.ready_at - {t}.created_at))' }, { label: 'Time to ready' }),
      to_collected: duration({ sql: 'EXTRACT(EPOCH FROM ({t}.collected_at - {t}.created_at))' }, { label: 'Time to collected' }),
    },
    measures: {
      orders: count({ label: 'Orders', where: "{t}.status NOT IN ('cancelled', 'merged')", about: 'Orders the kitchen had, not counting cancelled ones or ones joined to another.' }),
      ready: count({ label: 'Ready', where: '{t}.ready_at IS NOT NULL', about: 'Orders that were ready.' }),
      cancelled: count({ label: 'Cancelled', where: "{t}.status = 'cancelled'" }),
      average_to_ready: avg({ sql: 'EXTRACT(EPOCH FROM ({t}.ready_at - {t}.created_at))' }, {
        type: 'duration', label: 'Average time to ready', where: '{t}.ready_at IS NOT NULL',
        about: 'From an order reaching the kitchen to every dish being ready, on average.',
      }),
    },
    links: {
      check: one('till.checks', 'check_id', { label: 'Check' }),
      online_order: one('online.orders', 'order_id', { label: 'Online order', needs: 'web_orders' }),
      tickets: many('kitchen.tickets', 'kitchen_order_id', { label: 'Tickets' }),
      remakes: many('kitchen.remakes', 'kitchen_order_id', { label: 'Remakes' }),
    },
    list: ['date', 'came_in_at', 'venue.name', 'number', 'source', 'order_type', 'status', 'to_ready'],
    sort: [{ by: 'came_in_at', dir: 'desc' }],
    // The order as the kitchen works it (read above for its number, type and stream).
    skip: ['last_seq', 'updated_at'],
  }),
]
