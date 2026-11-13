// src/reports/catalogue/common.js
//
// Things reports group by that more than one area shares: venues, the menu
// (dishes, sections, menus) and customers.

import { subject, text, number, money, yesno, choice, moment, count, one, many } from './define.js'

export default [
  subject({
    key: 'venue',
    label: 'Venues',
    one: 'venue',
    area: 'shared',
    about: 'Your venues. Every dated subject has its venue, so any report can be split or filtered by it.',
    from: 'venues',
    name: 'name',
    fields: {
      name: text('name'),
      active: yesno('is_active', { label: 'In use' }),
      currency: text({ sql: 'btrim({t}.currency::text)' }, { label: 'Currency' }),
      timezone: text('timezone', { label: 'Time zone' }),
    },
    measures: {
      venues: count({ label: 'Venues' }),
    },
    list: ['name', 'active', 'currency', 'timezone'],
    sort: [{ by: 'name', dir: 'asc' }],
    // google_place_id is Google's id for the venue, not a link to anything here.
    skip: ['slug', 'zero_cap_display', 'created_at', 'updated_at', 'google_place_id'],
  }),

  subject({
    key: 'menu.menus',
    label: 'Menus',
    one: 'menu',
    area: 'menus',
    module: 'menus',
    about: 'Your menus as they are being edited now (the draft), for grouping dishes by menu.',
    from: 'menus',
    name: 'name',
    fields: {
      name: text('name'),
      published: yesno('is_published', { label: 'Shown to guests' }),
    },
    measures: {
      menus: count({ label: 'Menus' }),
    },
    list: ['name', 'published'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: [
      'venue_id', 'print_design_id',
      // Words and settings for the printed menu and the website.
      'slug', 'tagline', 'service_times', 'intro_line', 'sort_order', 'created_at', 'updated_at',
      'print_columns', 'print_orientation', 'print_paper_size', 'print_hide_variant_group_headers', 'print_settings',
      'hide_zero_priced_variants', 'hide_unpriced_variants', 'needs_first_release', 'tax',
    ],
  }),

  subject({
    key: 'menu.sections',
    label: 'Menu sections',
    one: 'section',
    area: 'menus',
    module: 'menus',
    about: 'The sections (categories) of your menus, as they are being edited now.',
    from: 'menu_sections',
    name: 'name',
    fields: {
      name: text('title'),
      visibility: choice('visibility', { show: 'Shown', website_hidden: 'Hidden on the website', hidden: 'Hidden everywhere' }, { label: 'Where it shows' }),
      subtitle: text('subtitle'),
    },
    measures: {
      sections: count({ label: 'Sections' }),
    },
    links: {
      menu: one('menu.menus', 'menu_id', { label: 'Menu' }),
    },
    list: ['name', 'menu.name', 'visibility'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['pos_course_id', 'highlight', 'sort_order', 'created_at', 'image_url', 'print_break_before', 'print_keep_together', 'pos_colour', 'tax'],
  }),

  subject({
    key: 'menu.dishes',
    label: 'Menu dishes',
    one: 'dish',
    area: 'menus',
    module: 'menus',
    about: 'The dishes on your menus, as they are being edited now. Sales keep the name a dish had when it was sold; this is the dish as it is today.',
    from: 'menu_items',
    name: 'name',
    fields: {
      name: text('name'),
      kind: choice('kind', { dish: 'Dish', combo: 'Meal deal' }, { label: 'Dish or meal deal' }),
      price: money('price_pence', { label: 'Menu price', adds: false }),
      featured: yesno('is_featured', { label: 'House favourite' }),
      orderable: yesno('is_orderable', { label: 'Can be ordered online' }),
      calories: number('calories', { decimals: 0 }),
      description: text('description'),
      notes: text('notes'),
      native_name: text('native_name', { label: 'Name in its own language' }),
      kitchen_name: text('kitchen_name', { label: 'Kitchen name' }),
      min_order_qty: number('min_order_qty', { label: 'Smallest online order', decimals: 0 }),
      has_photo: yesno({ sql: "(COALESCE({t}.image_url, '') <> '')" }, { label: 'Has a photo' }),
      created_at: moment('created_at', { label: 'Added' }),
    },
    measures: {
      dishes: count({ label: 'Dishes' }),
    },
    links: {
      section: one('menu.sections', 'section_id', { label: 'Section' }),
    },
    list: ['name', 'section.name', 'section.menu.name', 'price'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['pos_course_id', 'sort_order', 'updated_at', 'pos_colour', 'combo', 'tax'],
  }),

  subject({
    key: 'guests.customers',
    label: 'Customers',
    one: 'customer',
    area: 'guests',
    module: 'customers',
    about: 'Everyone with a customer record: people who booked a table or ordered online with their details.',
    from: 'customers',
    name: 'name',
    fields: {
      name: text('name', { pii: true }),
      email: text('email', { pii: true }),
      phone: text('phone', { pii: true }),
      visits: number('visit_count', { label: 'Visits', decimals: 0, adds: true }),
      newsletter: yesno('marketing_opt_in', { label: 'Gets the newsletter' }),
      anonymised: yesno('is_anonymised', { label: 'Erased' }),
      created_at: moment('created_at', { label: 'First seen' }),
      notes: text('notes', { pii: true }),
      newsletter_since: moment('marketing_opt_in_at', { label: 'Joined the newsletter' }),
      newsletter_source: text('marketing_opt_in_source', { label: 'Joined the newsletter through' }),
      newsletter_left: moment('marketing_opt_out_at', { label: 'Left the newsletter' }),
      anonymised_at: moment('anonymised_at', { label: 'Erased at' }),
    },
    measures: {
      customers: count({ label: 'Customers', where: 'NOT {t}.is_anonymised' }),
      subscribers: count({ label: 'On the newsletter', where: '{t}.marketing_opt_in AND NOT {t}.is_anonymised' }),
    },
    links: {
      bookings: many('bookings.bookings', 'customer_id', { label: 'Bookings' }),
      orders: many('online.orders', 'customer_id', { label: 'Online orders' }),
    },
    list: ['name', 'email', 'phone', 'visits', 'newsletter', 'created_at'],
    sort: [{ by: 'created_at', dir: 'desc' }],
    skip: ['updated_at'],
  }),
]
