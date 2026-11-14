// src/reports/catalogue/menus.js
//
// The menu as it is being edited (docs/REPORTS.md 20, phase 3d): when each
// menu was published, the option groups and their options, the allergens
// and dietary tags, and which dishes carry which. Menus, sections and
// dishes themselves are in common.js (other areas group by them).
//
// Everything here is the draft the Menus pages edit, as those pages show
// it; guests see the published version (menu.releases says when each one
// went live). A publish's state is worked out the way the menu editor's
// Publishing window works it out (services/menuReleases.js liveRows()):
// the newest publish not cancelled whose time has come is live, the ones
// before it are earlier ones, the ones still to come are scheduled.

import { subject, text, number, money, yesno, choice, moment, count, countDistinct, avg, one, many } from './define.js'
import { STANDARD_ALLERGENS, LEVEL_LABELS } from '../../../../shared/menuTags.js'
import { VARIATION_TYPES } from '../../../../shared/procurement.js'
import { DISPLAY_LABELS } from '../../../../shared/kiosk.js'

const STATES = { live: 'Live', earlier: 'Earlier', scheduled: 'Scheduled', cancelled: 'Cancelled' }

// The live publish of the row's menu: the newest one not cancelled whose
// time has come (liveRows()).
const LIVE_ID = `(SELECT r2.id FROM menu_releases r2
   WHERE r2.tenant_id = {t}.tenant_id AND r2.menu_id = {t}.menu_id
     AND r2.cancelled_at IS NULL AND r2.goes_live_at <= now()
   ORDER BY r2.goes_live_at DESC, r2.created_at DESC LIMIT 1)`

const STATE = `(CASE WHEN {t}.cancelled_at IS NOT NULL THEN 'cancelled'
   WHEN {t}.goes_live_at > now() THEN 'scheduled'
   WHEN {t}.id = ${LIVE_ID} THEN 'live'
   ELSE 'earlier' END)`

const ALLERGENS = Object.fromEntries(STANDARD_ALLERGENS.map(a => [a.key, a.label]))
const VARIATIONS = Object.fromEntries(VARIATION_TYPES.map(t => [t.key, t.label]))
const PRICE_MODES = { base: 'Option price is the dish price', extra: 'Option price is added on top' }

// A picture is set when its address isn't empty.
const hasPicture = col => ({ sql: "(COALESCE({t}." + col + ", '') <> '')" })

// Which dish and which tag or group a row of a dish's link tables is: its
// two ids together (the tables have no id of their own).
const pair = (a, b) => ({ sql: '({t}.' + a + "::text || ':' || {t}." + b + '::text)' })

export default [
  subject({
    key: 'menu.releases',
    label: 'Menu publishes',
    one: 'publish',
    area: 'menus',
    module: 'menus',
    about: 'Each time a menu was published, or scheduled to be, from the menu editor\'s Publishing window: when it goes or went live, who published it and its note. Guests, tills, kiosks and menu screens show the live one.',
    from: 'menu_releases',
    date: { sql: '({t}.goes_live_at AT TIME ZONE {tz})::date', bound: '{t}.goes_live_at', label: 'Day it went live', about: 'The day it went (or goes) live, at the group\'s time.' },
    fields: {
      state: choice({ sql: STATE }, STATES, { label: 'State', about: 'Live: what guests see now. Earlier: live before a later publish replaced it. Scheduled: still to come. Cancelled: called off before it went live.' }),
      goes_live_at: moment('goes_live_at', { label: 'Goes live' }),
      published_at: moment('created_at', { label: 'Published', about: 'When someone pressed Publish or scheduled it.' }),
      published_by: text('published_by', { label: 'Published by', pii: true }),
      note: text('note'),
      scheduled: yesno({ sql: '({t}.goes_live_at > {t}.created_at + interval \'1 minute\')' }, { label: 'Scheduled ahead', about: 'Set to go live later rather than straight away.' }),
      cancelled_at: moment('cancelled_at', { label: 'Cancelled at' }),
      cancelled_by: text('cancelled_by', { label: 'Cancelled by', pii: true }),
    },
    measures: {
      publishes: count({ label: 'Publishes', where: '{t}.cancelled_at IS NULL', about: 'Publishes that weren\'t cancelled, live and scheduled ones included.' }),
      cancelled: count({ label: 'Cancelled publishes', where: '{t}.cancelled_at IS NOT NULL' }),
      scheduled_now: count({ label: 'Scheduled now', where: '{t}.cancelled_at IS NULL AND {t}.goes_live_at > now()', about: 'Publishes still to go live.' }),
      menus_published: countDistinct('menu_id', { label: 'Menus published', about: 'How many different menus the publishes are of.' }),
    },
    links: {
      menu: one('menu.menus', 'menu_id', { label: 'Menu' }),
    },
    list: ['date', 'menu.name', 'state', 'goes_live_at', 'published_by', 'note'],
    sort: [{ by: 'goes_live_at', dir: 'desc' }],
    // The frozen copy of the menu, and the fingerprint of it that says whether
    // the draft has changed since; when tills were told about it.
    skip: ['snapshot', 'content_hash', 'announced_at'],
  }),

  subject({
    key: 'menu.option_groups',
    label: 'Option groups',
    one: 'option group',
    area: 'menus',
    module: 'menus',
    about: 'The option groups on Menus, Variant groups (Size, Protein, Flavour), shared by every dish they are on.',
    from: 'menu_variant_groups',
    name: 'name',
    fields: {
      name: text('name', { about: 'The group\'s name on the Variant groups page.' }),
      display_name: text({ sql: "NULLIF(btrim({t}.display_name), '')" }, { label: 'Name guests see', empty: 'Same as its name', about: 'The display name guests and tills see; empty when it is the group\'s own name.' }),
      price_mode: choice('price_mode', PRICE_MODES, { label: 'Pricing' }),
      min_picks: number('min_select', { label: 'Picks at least', decimals: 0 }),
      max_picks: number('max_select', { label: 'Picks at most', decimals: 0 }),
      required: yesno({ sql: '({t}.min_select > 0)' }, { label: 'Must be picked', about: 'A guest has to pick at least one.' }),
      repeats: yesno('allow_repeat', { label: 'The same option more than once' }),
      on_request: yesno('on_request', { label: 'Waits behind a button', about: 'An optional group shown only when its button is tapped.' }),
      till_prefixes: yesno('pos_prefixes', { label: 'No, Light, Extra and On the side', about: 'The till offers these with each option.' }),
      kiosk_display: choice('kiosk_display', DISPLAY_LABELS, { label: 'On kiosks', empty: 'As the kiosk design says' }),
      variation_type: choice('variation_type', VARIATIONS, { label: 'Recipe and stock', empty: 'Not set' }),
    },
    measures: {
      groups: count({ label: 'Option groups' }),
      required_groups: count({ label: 'Groups that must be picked', where: '{t}.min_select > 0' }),
    },
    links: {
      options: many('menu.options', 'group_id', { label: 'Options' }),
      dishes: many('menu.dish_option_groups', 'group_id', { label: 'Dishes it is on' }),
    },
    list: ['name', 'display_name', 'price_mode', 'min_picks', 'max_picks'],
    sort: [{ by: 'name', dir: 'asc' }],
    // How the kiosk draws it: the words at the ends of a level scale, its
    // pictures and tiles.
    skip: ['sort_order', 'scale_low', 'scale_high', 'kiosk_pick_photo', 'kiosk_pick_scale', 'kiosk_tiles', 'kiosk_pictures', 'kiosk_entrance'],
  }),

  subject({
    key: 'menu.options',
    label: 'Options',
    one: 'option',
    area: 'menus',
    module: 'menus',
    about: 'The options of each option group (Small, Large; Chicken, Prawn), with their usual price. A dish can have its own price for an option (Dish option prices).',
    from: 'menu_variant_options',
    name: 'name',
    fields: {
      name: text('label', { label: 'Option' }),
      price: money('price_pence', { label: 'Usual price', adds: false, about: 'In a group priced as the dish price, the dish\'s price with this option (£0 keeps the dish\'s own price); in a group added on top, what it adds.' }),
      description: text('description'),
      level: number('level', { label: 'Level', decimals: 0, about: 'Its place on the group\'s scale, 0 to 5 (heat, for example), when it has one.' }),
      has_tile_picture: yesno(hasPicture('image_url'), { label: 'Has a tile picture' }),
      has_dish_picture: yesno(hasPicture('photo_url'), { label: 'Has a picture on the dish' }),
      then_asks: yesno({ sql: '({t}.child_group_id IS NOT NULL)' }, { label: 'Asks another group', about: 'Picking it on the till asks another group (Steak, then Cooking).' }),
    },
    measures: {
      options: count({ label: 'Options' }),
      average_price: avg('price_pence', { label: 'Average usual price', type: 'money' }),
    },
    links: {
      group: one('menu.option_groups', 'group_id', { label: 'Option group' }),
      then_ask: one('menu.option_groups', 'child_group_id', { label: 'Then asks' }),
      dish_prices: many('menu.dish_option_prices', 'option_id', { label: 'Dish prices' }),
    },
    list: ['name', 'group.name', 'price', 'description'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order'],
  }),

  subject({
    key: 'menu.tags',
    label: 'Allergens and dietary tags',
    one: 'tag',
    area: 'menus',
    module: 'menus',
    about: 'The allergens (the 14 UK allergens and any of your own) and dietary tags (Vegan, Spicy) on Menus, Allergens & dietary.',
    from: 'menu_dietary_tags',
    name: 'name',
    fields: {
      name: text('label', { label: 'Tag' }),
      code: text('code', { about: 'The short code the badge shows.' }),
      kind: choice('kind', { allergen: 'Allergen', dietary: 'Dietary tag' }, { label: 'Allergen or dietary tag' }),
      standard: choice('standard_key', ALLERGENS, { label: 'Standard allergen', empty: 'Your own', about: 'Which of the 14 UK allergens it is, when it is one.' }),
      on_menus: yesno('show_on_menu', { label: 'Shown on menus', about: 'Off: kept for the allergen matrix and lookup, left off every menu guests see.' }),
      in_key: yesno('in_key', { label: 'In the allergen key' }),
    },
    measures: {
      tags: count({ label: 'Tags' }),
      allergens: count({ label: 'Allergens', where: "{t}.kind = 'allergen'" }),
      dietary_tags: count({ label: 'Dietary tags', where: "{t}.kind = 'dietary'" }),
    },
    links: {
      dishes: many('menu.dish_tags', 'tag_id', { label: 'Dishes with it' }),
    },
    list: ['name', 'kind', 'code', 'on_menus'],
    sort: [{ by: 'name', dir: 'asc' }],
    // How its badge looks and where it sits.
    skip: ['glyph', 'colour', 'sort_order'],
  }),

  subject({
    key: 'menu.dish_tags',
    label: 'Dish allergens and tags',
    one: 'dish tag',
    area: 'menus',
    module: 'menus',
    about: 'Which dishes carry which allergens and dietary tags, as the allergen matrix shows them: for an allergen, whether the dish contains it, may contain it or has it as something that can be left out.',
    from: 'menu_item_dietary',
    id: pair('item_id', 'tag_id'),
    idType: 'text',
    fields: {
      level: choice('level', LEVEL_LABELS, { label: 'Level', about: 'Dietary tags are always Contains.' }),
    },
    measures: {
      dish_tags: count({ label: 'Dish tags' }),
      contains: count({ label: 'Contains', where: "{t}.level = 'contains'" }),
      may_contain: count({ label: 'May contain', where: "{t}.level = 'may_contain'" }),
      removable: count({ label: 'Can be removed', where: "{t}.level = 'removable'" }),
      dishes: countDistinct('item_id', { label: 'Dishes', about: 'How many different dishes carry them.' }),
    },
    links: {
      dish: one('menu.dishes', 'item_id', { label: 'Dish' }),
      tag: one('menu.tags', 'tag_id', { label: 'Tag' }),
    },
    list: ['dish.name', 'dish.section.menu.name', 'tag.name', 'level'],
    sort: [{ by: 'dish.name', dir: 'asc' }],
  }),

  subject({
    key: 'menu.dish_option_groups',
    label: 'Dish option groups',
    one: 'dish option group',
    area: 'menus',
    module: 'menus',
    about: 'Which option groups each dish asks, in the order the dish asks them.',
    from: 'menu_item_variant_groups',
    id: pair('item_id', 'group_id'),
    idType: 'text',
    fields: {
      place: number({ sql: '({t}.sort_order + 1)' }, { label: 'Asked', decimals: 0, about: 'Where the dish asks it: 1 first.' }),
    },
    measures: {
      dish_groups: count({ label: 'Dish option groups' }),
      dishes: countDistinct('item_id', { label: 'Dishes' }),
      groups: countDistinct('group_id', { label: 'Option groups' }),
    },
    links: {
      dish: one('menu.dishes', 'item_id', { label: 'Dish' }),
      group: one('menu.option_groups', 'group_id', { label: 'Option group' }),
    },
    list: ['dish.name', 'dish.section.menu.name', 'group.name', 'place'],
    sort: [{ by: 'dish.name', dir: 'asc' }],
  }),

  subject({
    key: 'menu.dish_option_prices',
    label: 'Dish option prices',
    one: 'dish option price',
    area: 'menus',
    module: 'menus',
    about: 'Options whose price is the dish\'s own: a dish can charge its own price for an option of a shared group (Large is £2 on this dish, £1.50 on others).',
    from: 'menu_item_variant_prices',
    id: pair('item_id', 'option_id'),
    idType: 'text',
    fields: {
      price: money('price_pence', { label: 'Price on this dish', adds: false }),
      usual_price: money({ sql: '{option}.price_pence' }, { label: 'Usual price', adds: false }),
      difference: money({ sql: '({t}.price_pence - {option}.price_pence)' }, { label: 'Difference', adds: false, about: 'This dish\'s price less the option\'s usual price.' }),
    },
    measures: {
      prices: count({ label: 'Own prices' }),
      dishes: countDistinct('item_id', { label: 'Dishes' }),
    },
    links: {
      dish: one('menu.dishes', 'item_id', { label: 'Dish' }),
      option: one('menu.options', 'option_id', { label: 'Option' }),
    },
    list: ['dish.name', 'option.group.name', 'option.name', 'usual_price', 'price'],
    sort: [{ by: 'dish.name', dir: 'asc' }],
  }),

  subject({
    key: 'menu.dish_own_options',
    label: 'Dish own options',
    one: 'own option',
    area: 'menus',
    module: 'menus',
    about: 'Options a dish has of its own rather than from a shared option group (the Menus page\'s own options card).',
    from: 'menu_item_variants',
    name: 'name',
    fields: {
      name: text('label', { label: 'Option' }),
      price: money('price_pence', { label: 'Price', adds: false }),
    },
    measures: {
      options: count({ label: 'Own options' }),
      dishes: countDistinct('item_id', { label: 'Dishes' }),
    },
    links: {
      dish: one('menu.dishes', 'item_id', { label: 'Dish' }),
    },
    list: ['dish.name', 'name', 'price'],
    sort: [{ by: 'dish.name', dir: 'asc' }],
    skip: ['sort_order'],
  }),
]
