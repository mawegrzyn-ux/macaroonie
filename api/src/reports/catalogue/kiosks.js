// src/reports/catalogue/kiosks.js
//
// Self-order kiosks in the report catalogue: every guest's visit to a
// kiosk (kiosk_sessions, recorded on the kiosk and summed up on arrival by
// shared/kioskJourney.js summariseJourney()) and the kiosk designs.
//
// The rules are Kiosk analytics' own (aggregateJourneys()): a visit ordered
// when its outcome is ordered; sales are the totals of visits that ordered;
// what was left in baskets is the order value of visits that didn't order;
// a visit bounced when it ended without opening a dish; where a guest gave
// up is the last screen of a visit that didn't order. Nothing a guest typed
// is in these rows (names and tent numbers are kept as lengths only).

import { subject, text, number, money, yesno, choice, moment, duration, sum, avg, count, ratio, one, many } from './define.js'
import { OUTCOME_LABELS, STAGE_LABELS, SCREEN_LABELS } from '../../../../shared/kioskJourney.js'
import { KIOSK_LANGUAGES } from '../../../../shared/kiosk.js'

const ORDERED = "{t}.outcome = 'ordered'"
const NOT_ORDERED = "{t}.outcome <> 'ordered'"
const OPENED_DISH = "COALESCE({t}.summary->'stages' @> '[\"item\"]'::jsonb, false)"
const LANGUAGES = Object.fromEntries(KIOSK_LANGUAGES.map(l => [l.code, l.name]))

export default [
  subject({
    key: 'kiosks.visits',
    label: 'Kiosk visits',
    one: 'visit',
    area: 'kiosks',
    module: 'pos_reports',
    about: 'Every guest\'s visit to a self-order kiosk: how far they got, whether they ordered and what was left in the basket when they didn\'t.',
    from: 'kiosk_sessions',
    idType: 'text',
    venue: 'venue_id',
    date: { sql: '({t}.started_at AT TIME ZONE {tz})::date', bound: '{t}.started_at', label: 'Day' },
    open: { page: '/pos/kiosk-analytics?tab=visits&visit=:id', module: 'pos_reports', label: 'Play the visit back' },
    fields: {
      started_at: moment('started_at', { label: 'Started at' }),
      ended_at: moment('ended_at', { label: 'Ended at' }),
      length: duration({ sql: '({t}.duration_ms / 1000.0)' }, { label: 'How long' }),
      outcome: choice('outcome', OUTCOME_LABELS, { label: 'How it ended' }),
      furthest: choice('furthest', STAGE_LABELS, { label: 'How far they got' }),
      last_screen: choice({ sql: "COALESCE({t}.last_screen, 'start')" }, SCREEN_LABELS, { label: 'Last screen', about: 'Where the visit ended (the order number screen when it ordered).' }),
      order_no: text('order_no', { label: 'Order number' }),
      total: money('total_pence', { label: 'Order total', adds: true }),
      basket_value: money('basket_value_pence', { label: 'Order value', adds: false, about: 'What was in the order: its total when the guest ordered, else what it held when they gave up.' }),
      items_added: number('items_added', { label: 'Dishes added', adds: true, decimals: 0 }),
      taps: number('taps', { label: 'Taps', adds: true, decimals: 0 }),
      dead_taps: number('dead_taps', { label: 'Taps that did nothing', adds: true, decimals: 0 }),
      language: choice('lang', LANGUAGES, { label: 'Language' }),
      reach: yesno({ sql: "COALESCE(({t}.summary->>'reach')::boolean, false)" }, { label: 'Used reach mode' }),
      allergens: yesno({ sql: "COALESCE(({t}.summary->>'allergens')::boolean, false)" }, { label: 'Picked allergens or diets' }),
      opened_dish: yesno({ sql: OPENED_DISH }, { label: 'Opened a dish' }),
    },
    measures: {
      visits: count({ label: 'Visits' }),
      orders: count({ label: 'Orders', where: ORDERED, about: 'Visits that ended with an order.' }),
      conversion: ratio('orders', 'visits', { type: 'percent', label: 'Visits that ordered', about: 'Orders out of every visit.' }),
      sales: sum('total_pence', { type: 'money', label: 'Sales', where: ORDERED, about: 'The totals of the orders placed on the kiosks.' }),
      average_order: ratio('sales', 'orders', { type: 'money', label: 'Average order' }),
      gave_up: count({ label: 'Gave up', where: NOT_ORDERED, about: 'Visits that ended without an order.' }),
      left_in_baskets: sum('basket_value_pence', {
        type: 'money', label: 'Left in baskets', where: NOT_ORDERED + ' AND {t}.basket_value_pence > 0',
        about: 'What the orders of guests who gave up held when they did.',
      }),
      bounced: count({ label: 'Left without opening a dish', where: NOT_ORDERED + ' AND NOT ' + OPENED_DISH }),
      average_length: avg({ sql: '({t}.duration_ms / 1000.0)' }, { type: 'duration', label: 'Average visit' }),
      dead_tap_total: sum('dead_taps', { label: 'Taps that did nothing' }),
    },
    links: {
      kiosk: one('till.takers', 'device_id', { label: 'Kiosk' }),
      design: one('kiosks.designs', 'design_id', { label: 'Kiosk design' }),
      stream: one('till.streams', 'revenue_stream_id', { label: 'Revenue stream' }),
      check: one('till.checks', 'check_id', { label: 'Check' }),
    },
    list: ['date', 'started_at', 'venue.name', 'kiosk.name', 'outcome', 'furthest', 'length', 'total'],
    sort: [{ by: 'started_at', dir: 'desc' }],
    // The visit itself (played back on the Kiosk analytics page), what it
    // touched by name, the kiosk's screen and app, and when it arrived.
    skip: ['names', 'events', 'events_cleared_at', 'viewport', 'config_version', 'app_version', 'received_at', 'truncated', 'event_count'],
  }),

  subject({
    key: 'kiosks.designs',
    label: 'Kiosk designs',
    one: 'design',
    area: 'kiosks',
    module: 'pos_setup',
    about: 'How the group\'s kiosks look and behave, as set up in the Kiosk designer.',
    from: 'kiosk_designs',
    name: 'name',
    open: { page: '/pos/kiosk-designs/:id', module: 'pos_setup', label: 'Open the design' },
    fields: {
      name: text('name'),
      made_at: moment('created_at', { label: 'Made at' }),
      saved_at: moment('updated_at', { label: 'Last saved' }),
      shared: yesno({ sql: '({t}.share_created_at IS NOT NULL)' }, { label: 'Shared as a preview link' }),
      preview_views: number('share_views', { label: 'Preview link views', adds: true, decimals: 0 }),
    },
    measures: { designs: count({ label: 'Designs' }) },
    links: {
      visits: many('kiosks.visits', 'design_id', { label: 'Visits' }),
    },
    list: ['name', 'saved_at', 'shared', 'preview_views'],
    sort: [{ by: 'name', dir: 'asc' }],
    // The design itself, who made it, and the preview link's own settings.
    skip: ['settings', 'created_by', 'share_token', 'share_venue_id', 'share_stream_id', 'share_expires_at',
      'share_created_by', 'share_last_viewed_at', 'share_menu'],
  }),
]
