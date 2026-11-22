// src/reports/catalogue/usage.js
//
// The usage record (migration 270, services/usageRecord.js): the pages
// people open in the admin and their searches in the menu box (the ask bar),
// with whether a search was handed to Pepper and what it opened.
//
// Decision 8 of the Pepper-first strategy: the record of what a person opens
// stays that person's own, and Pepper does not rank individuals. So:
//
//   usage.mine       each person's own pages and searches, the words they
//                    typed included: its rule reads {me}, the person running
//                    the report, so nobody (an owner included) can report on
//                    anyone else's. No module: everyone who can open reports.
//   usage.pages      the group's pages opened, by page and day: no person,
//   usage.searches   the group's searches: how many, how many handed to
//                    Pepper and their share, what was opened; no person and
//                    no words typed (they can name a guest or a colleague).
//                    Both need View on Navigation (the menu's designer, an
//                    owner by default): which pages are used is the question
//                    a menu is designed from.
//
// None of the three has a field, figure or link that reads user_sub: a
// group-wide count by person would be a ranking of people.

import { subject, text, number, yesno, choice, moment, count, countDistinct, ratio } from './define.js'
import { ASSISTANT_NAME } from '../../../../shared/assistant.js'

const DAY = '({t}.at AT TIME ZONE {tz})::date'
const KINDS = { page: 'A page opened', search: 'A menu search' }
const PICKED = { menu: 'One of the menu\'s matches', report: 'A saved report', pepper: 'One of ' + ASSISTANT_NAME + '\'s picks' }
const GROUP_MODULE = 'nav_designer'

/** Where these subjects come in the catalogue (index.js gathers this folder by it, then by file name). */
export const order = 175

export const subjects = [
  subject({
    key: 'usage.pages',
    label: 'Pages opened',
    one: 'page opened',
    area: 'shared',
    module: GROUP_MODULE,
    about: 'Each time someone in the group opened a page of the app, by page and day (kept 90 days). Who opened it isn\'t reported here: each person sees their own in My pages and searches.',
    from: 'usage_events',
    where: "{t}.kind = 'page'",
    name: 'page',
    date: { sql: DAY, bound: '{t}.at', label: 'Day' },
    fields: {
      at: moment('at', { label: 'When' }),
      page: text('path', { label: 'Page', about: 'The page\'s address without anything after a ?, ids as :id.' }),
    },
    measures: {
      opens: count({ label: 'Times opened' }),
      pages: countDistinct('path', { label: 'Pages' }),
      days: countDistinct({ sql: DAY }, { label: 'Days' }),
    },
    list: ['at', 'page'],
    sort: [{ by: 'at', dir: 'desc' }],
    // The person and the words typed: never in a group-wide subject.
    skip: ['created_at'],
  }),

  subject({
    key: 'usage.searches',
    label: 'Menu searches',
    one: 'menu search',
    area: 'shared',
    module: GROUP_MODULE,
    about: 'Each search in the menu box (the ask bar) in the group, by day (kept 90 days): how many of the menu\'s own matches it had, whether it was handed to ' + ASSISTANT_NAME + ' and what was opened. What was typed and who typed it aren\'t reported here.',
    from: 'usage_events',
    where: "{t}.kind = 'search'",
    name: 'opened',
    date: { sql: DAY, bound: '{t}.at', label: 'Day' },
    fields: {
      at: moment('at', { label: 'When' }),
      to_pepper: yesno('pepper', { label: 'Handed to ' + ASSISTANT_NAME }),
      opened: choice('picked', PICKED, { label: 'Opened', empty: 'Nothing' }),
      page: text('path', { label: 'Page opened', empty: 'None' }),
      matches: number('results', { label: 'Menu matches', about: 'How many of the menu\'s own links fitted the words when the search ended.' }),
    },
    measures: {
      searches: count({ label: 'Searches' }),
      handed: count({ label: 'Handed to ' + ASSISTANT_NAME, where: '{t}.pepper' }),
      handed_share: ratio('handed', 'searches', { type: 'percent', label: 'Handed to ' + ASSISTANT_NAME + ' (%)' }),
      opened_any: count({ label: 'Opened something', where: '{t}.picked IS NOT NULL' }),
      opened_share: ratio('opened_any', 'searches', { type: 'percent', label: 'Opened something (%)' }),
      pepper_picks: count({ label: 'Opened ' + ASSISTANT_NAME + '\'s pick', where: "{t}.picked = 'pepper'" }),
      no_match: count({ label: 'No menu match', where: '{t}.results = 0' }),
    },
    list: ['at', 'to_pepper', 'opened', 'page', 'matches'],
    sort: [{ by: 'at', dir: 'desc' }],
    skip: ['created_at'],
  }),

  subject({
    key: 'usage.mine',
    label: 'My pages and searches',
    one: 'page or search of mine',
    area: 'shared',
    about: 'The pages you opened and what you searched for in the menu box, over the last 90 days: only ever your own, whoever runs the report.',
    from: 'usage_events',
    where: '{t}.user_sub = {me}',
    name: 'page',
    date: { sql: DAY, bound: '{t}.at', label: 'Day' },
    fields: {
      at: moment('at', { label: 'When' }),
      what: choice('kind', KINDS, { label: 'What' }),
      page: text('path', { label: 'Page', empty: 'None', about: 'The page opened (for a search, the page it opened).' }),
      words: text('query', { label: 'Searched for', pii: true, empty: '' }),
      to_pepper: yesno('pepper', { label: 'Handed to ' + ASSISTANT_NAME }),
      opened: choice('picked', PICKED, { label: 'Opened', empty: 'Nothing' }),
      matches: number('results', { label: 'Menu matches' }),
    },
    measures: {
      events: count({ label: 'Pages and searches' }),
      opens: count({ label: 'Pages opened', where: "{t}.kind = 'page'" }),
      searches: count({ label: 'Searches', where: "{t}.kind = 'search'" }),
      handed: count({ label: 'Handed to ' + ASSISTANT_NAME, where: '{t}.pepper' }),
      pages: countDistinct({ sql: "(CASE WHEN {t}.kind = 'page' THEN {t}.path END)" }, { label: 'Different pages' }),
    },
    list: ['at', 'what', 'page', 'words', 'opened'],
    sort: [{ by: 'at', dir: 'desc' }],
    skip: ['created_at'],
  }),
]
