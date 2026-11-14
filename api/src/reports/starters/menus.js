// src/reports/starters/menus.js
//
// Starter reports on menus (docs/REPORTS.md Appendix B). The menus are the
// draft being edited (guests, tills, kiosks and menu screens show the last
// version published) and every venue shares them, so these ask for no
// venues. Publishing history is by the day a publish went, or goes, live.

import { starter } from './define.js'

export default [
  starter({
    key: 'menu_dishes_to_finish',
    name: 'Dishes with no photo, price or allergens',
    about: 'Every dish (meal deals aside) missing a photo or a price, or tagged with no allergens, as the menus are being edited now. A dish priced by its options has a price. One with no allergens tagged may simply have none: check it.',
    period: false,
    venues: false,
    spec: {
      subject: 'menu.dishes',
      kind: 'list',
      rows: ['section.menu.name', 'section.name', 'name', 'price', 'has_price', 'has_photo', 'allergens'],
      filters: [
        { field: 'kind', op: 'is', value: 'dish' },
        { any: [
          { field: 'has_photo', op: 'is', value: false },
          { field: 'has_price', op: 'is', value: false },
          { field: 'allergens', op: 'is', value: 0 },
        ] },
      ],
      sort: [{ by: 'section.menu.name', dir: 'asc' }, { by: 'section.name', dir: 'asc' }, { by: 'name', dir: 'asc' }],
    },
  }),

  starter({
    key: 'menu_allergens_by_dish',
    name: 'Allergens by dish',
    about: 'Every allergen each dish is tagged with and at what level (contains, may contain, can be removed on request), as the menus are being edited now: the allergen matrix as a list to sort, filter and download. Dishes tagged with no allergens aren\'t listed.',
    period: false,
    venues: false,
    spec: {
      subject: 'menu.dish_tags',
      kind: 'list',
      rows: ['dish.section.name', 'dish.name', 'tag.name', 'level'],
      filters: [{ field: 'tag.kind', op: 'is', value: 'allergen' }],
      sort: [{ by: 'dish.section.name', dir: 'asc' }, { by: 'dish.name', dir: 'asc' }, { by: 'tag.name', dir: 'asc' }],
    },
  }),

  starter({
    key: 'menu_price_list',
    name: 'Price list',
    about: 'Every dish and meal deal with its menu price and whether it can be ordered online, as the menus are being edited now. A dish priced by its options has no menu price of its own.',
    period: false,
    venues: false,
    spec: {
      subject: 'menu.dishes',
      kind: 'list',
      rows: ['section.menu.name', 'section.name', 'name', 'kind', 'price', 'orderable'],
      sort: [{ by: 'section.menu.name', dir: 'asc' }, { by: 'section.name', dir: 'asc' }, { by: 'name', dir: 'asc' }],
    },
  }),

  starter({
    key: 'menu_publishing_history',
    name: 'Publishing history',
    about: 'Every menu publish that went, or goes, live in the period, newest first: which menu, whether it is live now, scheduled or replaced, who published it and its note.',
    period: { relative: 'last_n_days', n: 90 },
    venues: false,
    spec: {
      subject: 'menu.releases',
      kind: 'list',
      rows: ['date', 'menu.name', 'state', 'goes_live_at', 'published_at', 'published_by', 'note'],
      sort: [{ by: 'goes_live_at', dir: 'desc' }],
    },
  }),
]
