// src/reports/catalogue/pepper.js
//
// Pepper, the staff assistant: how much it is used (by month and channel, by
// person and day), the changes it made and its chats. Counts and dates only:
// never what was said. A change's input and result, a chat's title, its
// system prompt and the guest's key are never read here (the catalogue test
// checks a template never names them).
//
// The words for what a change was and where it was made come from
// shared/pepperActions.js, as on the Pepper page's Activity tab. The usage
// month and day run on UTC, as the allowance and the daily share do
// (usageMonth() / usageDay() in src/ai/context.js).
//
// Levels follow the Pepper page: the month's usage is on its Settings tab for
// View; everyone's use by person, the Activity tab and other people's chats
// are for Manage. Each model request (migration 271) is for View like the
// month's usage: it has no person.

import { subject, text, number, yesno, choice, date, moment, duration, sum, avg, max, count, countDistinct, ratio, one, many } from './define.js'
import { ASSISTANT_NAME } from '../../../../shared/assistant.js'
import { CHANNEL_LABELS, ACTION_LABELS, USE_LABELS } from '../../../../shared/pepperActions.js'

const MODULE = 'ai_assistant'
const DAY = '({t}.created_at AT TIME ZONE {tz})::date'
const GUEST = 'A guest'

/** Where these subjects come in the catalogue (index.js gathers this folder by it, then by file name). */
export const order = 160

/**
 * This area's tables that no subject reads, and why (decisions.js gathers
 * them): settings (how something is set up) and out ({ reason: [tables] }).
 */
export const decisions = {
  settings: ['ai_settings'],
  out: {
    'Tokens, codes and sessions': ['ai_access_tokens', 'ai_oauth_clients', 'ai_oauth_grants', 'ai_booking_codes', 'ai_booking_grants'],
    'Conversations and files': ['ai_messages', 'ai_attachments', 'ai_pending_actions'],
  },
}

export const subjects = [
  subject({
    key: 'pepper.usage',
    label: ASSISTANT_NAME + '\'s use by month',
    one: 'month of use',
    area: 'pepper',
    module: MODULE,
    about: 'How much ' + ASSISTANT_NAME + ' was used each month (UTC), by where: its chat, AI apps on the staff connector, the website chat and guest AI apps. Requests, tokens, web searches and the units the monthly allowance counts.',
    from: 'ai_usage',
    id: { sql: "({t}.month::text || '|' || {t}.channel)" },
    idType: 'text',
    name: 'channel',
    fields: {
      month: date('month', { label: 'Month', about: 'The first day of the month (UTC).' }),
      channel: choice('channel', CHANNEL_LABELS, { label: 'Where' }),
      requests: number('requests', { label: 'Requests', adds: true, about: 'Calls to the model: a chat message can take several when ' + ASSISTANT_NAME + ' uses tools.' }),
      units: number('units', { label: 'Units', adds: true, about: 'What the monthly allowance counts: tokens weighted by the model and their kind, and 2,500 for each web search.' }),
      input_tokens: number('input_tokens', { label: 'Tokens in', adds: true, about: 'What ' + ASSISTANT_NAME + ' was sent: the chat so far, files and tools.' }),
      output_tokens: number('output_tokens', { label: 'Tokens out', adds: true, about: 'What ' + ASSISTANT_NAME + ' wrote, its thinking included.' }),
      cache_read_tokens: number('cache_read_tokens', { label: 'Tokens from the cache', adds: true, about: 'Parts of a chat sent again and read from the cache, which counts for far less.' }),
      cache_write_tokens: number('cache_write_tokens', { label: 'Tokens put in the cache', adds: true }),
      web_searches: number('web_searches', { label: 'Web searches', adds: true }),
    },
    measures: {
      total_requests: sum('requests', { label: 'Requests' }),
      total_units: sum('units', { label: 'Units', about: 'What the monthly allowance counts: tokens weighted by the model and their kind, and 2,500 for each web search.' }),
      total_input: sum('input_tokens', { label: 'Tokens in' }),
      total_output: sum('output_tokens', { label: 'Tokens out' }),
      total_searches: sum('web_searches', { label: 'Web searches' }),
      units_a_request: ratio('total_units', 'total_requests', { label: 'Units a request', decimals: 0 }),
      months: countDistinct('month', { label: 'Months' }),
    },
    list: ['month', 'channel', 'requests', 'units', 'web_searches'],
    sort: [{ by: 'month', dir: 'desc' }],
    skip: ['updated_at'],
  }),

  subject({
    key: 'pepper.requests',
    label: ASSISTANT_NAME + '\'s model requests',
    one: 'model request',
    area: 'pepper',
    module: MODULE,
    about: 'Each call ' + ASSISTANT_NAME + ' made to the AI model (kept 90 days): when, where, what for (the chat, the menu search, a reader, the report smart builder, local info), which model answered, its tokens, how long it took and what it cost. The cost is an estimate at the list prices of each model. Who asked isn\'t reported here.',
    from: 'ai_requests',
    name: 'model',
    date: { sql: DAY, bound: '{t}.created_at', label: 'Day' },
    fields: {
      at: moment('created_at', { label: 'When' }),
      channel: choice('channel', CHANNEL_LABELS, { label: 'Where' }),
      use: choice('use', USE_LABELS, { label: 'What for' }),
      model: text('model', { label: 'Model' }),
      input_tokens: number('input_tokens', { label: 'Tokens in', adds: true }),
      output_tokens: number('output_tokens', { label: 'Tokens out', adds: true }),
      cache_read_tokens: number('cache_read_tokens', { label: 'Tokens from the cache', adds: true }),
      cache_write_tokens: number('cache_write_tokens', { label: 'Tokens put in the cache', adds: true }),
      web_searches: number('web_searches', { label: 'Web searches', adds: true }),
      units: number('units', { label: 'Units', adds: true, about: 'What the monthly allowance counts for this request.' }),
      cost: number('cost_usd', { label: 'Cost ($)', adds: true, decimals: 4, about: 'An estimate in US dollars at the model\'s list prices: tokens of each kind and web searches.' }),
      took: duration({ sql: '({t}.ms::numeric / 1000)' }, { label: 'Took', about: 'How long the model took to answer, where it was timed.' }),
    },
    measures: {
      requests: count({ label: 'Requests' }),
      total_input: sum('input_tokens', { label: 'Tokens in' }),
      total_output: sum('output_tokens', { label: 'Tokens out' }),
      total_cache_read: sum('cache_read_tokens', { label: 'Tokens from the cache' }),
      total_cache_write: sum('cache_write_tokens', { label: 'Tokens put in the cache' }),
      total_units: sum('units', { label: 'Units' }),
      total_cost: sum('cost_usd', { label: 'Cost ($)', decimals: 4 }),
      cost_a_request: ratio('total_cost', 'requests', { label: 'Cost a request ($)', decimals: 4 }),
      units_a_request: ratio('total_units', 'requests', { label: 'Units a request', decimals: 0 }),
      input_a_request: ratio('total_input', 'requests', { label: 'Tokens in a request', decimals: 0 }),
      output_a_request: ratio('total_output', 'requests', { label: 'Tokens out a request', decimals: 0 }),
      average_time: avg({ sql: '({t}.ms::numeric / 1000)' }, { type: 'duration', label: 'Average time' }),
      longest_time: max({ sql: '({t}.ms::numeric / 1000)' }, { type: 'duration', label: 'Longest time' }),
      models: countDistinct('model', { label: 'Models' }),
    },
    list: ['at', 'use', 'model', 'input_tokens', 'output_tokens', 'cost', 'took'],
    sort: [{ by: 'at', dir: 'desc' }],
  }),

  subject({
    key: 'pepper.people',
    label: ASSISTANT_NAME + '\'s use by person',
    one: 'person\'s day',
    area: 'pepper',
    module: MODULE,
    level: 'manage',
    about: 'Each person\'s use of ' + ASSISTANT_NAME + '\'s chat each day (UTC): requests and the units their daily share counts. Like everyone\'s use on the Pepper page\'s Settings tab, this needs Manage on ' + ASSISTANT_NAME + '.',
    from: 'ai_usage_people',
    id: { sql: "({t}.day::text || '|' || {t}.user_sub)" },
    idType: 'text',
    name: 'email',
    date: { sql: '{t}.day', label: 'Day', about: 'The day (UTC).' },
    fields: {
      email: text('user_email', { label: 'Email', pii: true }),
      requests: number('requests', { label: 'Requests', adds: true }),
      units: number('units', { label: 'Units', adds: true, about: 'What the person\'s daily share counts.' }),
    },
    measures: {
      total_requests: sum('requests', { label: 'Requests' }),
      total_units: sum('units', { label: 'Units' }),
      people: countDistinct('user_sub', { label: 'People' }),
      days: countDistinct('day', { label: 'Days used' }),
      units_a_request: ratio('total_units', 'total_requests', { label: 'Units a request', decimals: 0 }),
    },
    links: {
      person: one('group.team', 'user_sub', { on: 'auth0_user_id', label: 'Person', needs: 'team' }),
    },
    list: ['date', 'email', 'requests', 'units'],
    sort: [{ by: 'date', dir: 'desc' }],
    skip: ['updated_at'],
  }),

  subject({
    key: 'pepper.actions',
    label: ASSISTANT_NAME + '\'s changes',
    one: 'change',
    area: 'pepper',
    module: MODULE,
    level: 'manage',
    about: 'Every change ' + ASSISTANT_NAME + ' made or tried to make (a booking, a reading, an order, a price, a report), from its chat, AI apps and the website chat: what it was, who asked and whether it went through. What was asked and the answer aren\'t reported. Like the Activity tab, this needs Manage on ' + ASSISTANT_NAME + '.',
    from: 'ai_actions',
    name: 'what',
    date: { sql: DAY, bound: '{t}.created_at', label: 'Day' },
    fields: {
      at: moment('created_at', { label: 'When' }),
      what: choice('tool', ACTION_LABELS, { label: 'What it did' }),
      channel: choice('channel', CHANNEL_LABELS, { label: 'Where' }),
      who: text({ sql: "(CASE WHEN {t}.actor = 'guest' THEN '" + GUEST + "' ELSE {t}.actor END)" }, { label: 'Who asked', pii: true }),
      went_through: yesno('ok', { label: 'Went through' }),
      cleared: yesno({ sql: '({t}.redacted_at IS NOT NULL)' }, { label: 'Details cleared', about: 'Its details were cleared a year on, or when a guest asked to be forgotten.' }),
    },
    measures: {
      changes: count({ label: 'Changes' }),
      done: count({ label: 'Went through', where: '{t}.ok' }),
      failed: count({ label: 'Didn\'t go through', where: 'NOT {t}.ok' }),
      people: countDistinct('actor', { label: 'People who asked', where: "{t}.actor <> 'guest'" }),
      done_rate: ratio('done', 'changes', { type: 'percent', label: 'Went through (%)' }),
    },
    links: {
      booking: one('bookings.bookings', 'booking_id', { label: 'Booking', needs: 'bookings' }),
      chat: one('pepper.chats', 'conversation_id', { label: 'Chat' }),
    },
    list: ['at', 'what', 'channel', 'who', 'went_through'],
    sort: [{ by: 'at', dir: 'desc' }],
    // What was asked and the answer: never reported (they hold guests' details).
    skip: ['input', 'result'],
  }),

  subject({
    key: 'pepper.chats',
    label: ASSISTANT_NAME + ' chats',
    one: 'chat',
    area: 'pepper',
    module: MODULE,
    level: 'manage',
    about: 'Every chat with ' + ASSISTANT_NAME + ' (staff) and the website chat (guests), on the day it started: who started it, which model it ran on and whether it was closed. What was said is never reported. Chats idle past the group\'s retention are deleted, so older days hold fewer.',
    from: 'ai_conversations',
    name: 'who',
    date: { sql: DAY, bound: '{t}.created_at', label: 'Day started' },
    fields: {
      started: moment('created_at', { label: 'Started' }),
      last_message: moment('updated_at', { label: 'Last message' }),
      channel: choice('channel', CHANNEL_LABELS, { label: 'Where' }),
      who: text({ sql: "(CASE WHEN {t}.channel = 'guest_chat' THEN '" + GUEST + "' ELSE {t}.user_email END)" }, { label: 'Started by', pii: true }),
      model: choice({ sql: "COALESCE({t}.model_tier, 'main')" }, { fast: 'Everyday model', main: 'Main model' }, {
        label: 'Model', about: 'Chats start on the everyday model and move to the main one for files, harder tools and long chats.',
      }),
      closed: yesno({ sql: '({t}.closed_at IS NOT NULL)' }, { label: 'Closed' }),
      closed_at: moment('closed_at', { label: 'Closed at' }),
      closed_why: choice('closed_reason', { erased: 'A guest asked to be forgotten' }, { label: 'Why it closed' }),
    },
    measures: {
      chats: count({ label: 'Chats' }),
      staff_chats: count({ label: 'Staff chats', where: "{t}.channel = 'staff_chat'" }),
      guest_chats: count({ label: 'Website chats', where: "{t}.channel = 'guest_chat'" }),
      people: countDistinct('user_sub', { label: 'People', where: "{t}.channel = 'staff_chat'" }),
      main_model: count({ label: 'On the main model', where: "COALESCE({t}.model_tier, 'main') = 'main'" }),
      closed_count: count({ label: 'Closed', where: '{t}.closed_at IS NOT NULL' }),
    },
    links: {
      // Named location, not venue: most staff chats have none, and a venues
      // choice would leave them out.
      location: one('venue', 'venue_id', { label: 'Location' }),
      person: one('group.team', 'user_sub', { on: 'auth0_user_id', label: 'Person', needs: 'team' }),
      changes: many('pepper.actions', 'conversation_id', { label: 'Changes' }),
    },
    list: ['started', 'channel', 'who', 'model', 'closed'],
    sort: [{ by: 'started', dir: 'desc' }],
    // What was said, the chat's own key and the working state: never reported.
    skip: ['title', 'system_prompt', 'guest_key', 'running_until', 'tools_key', 'thinking_from_seq'],
  }),
]
