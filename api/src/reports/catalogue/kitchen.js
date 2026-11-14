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

import { subject, text, number, yesno, choice, moment, duration, sum, avg, max, count, ratio, one, many } from './define.js'

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
    },
    list: ['date', 'bumped_at', 'venue.name', 'station_name', 'order_number', 'dishes', 'ticket_time', 'on_time'],
    sort: [{ by: 'bumped_at', dir: 'desc' }],
    // The till event that made the bump; when the log row was written.
    skip: ['event_id', 'created_at'],
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
    },
    list: ['date', 'remade_at', 'venue.name', 'station_name', 'dish', 'reason', 'order_number'],
    sort: [{ by: 'remade_at', dir: 'desc' }],
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
