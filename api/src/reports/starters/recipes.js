// src/reports/starters/recipes.js
//
// Starter reports on recipes (inventory phase 1): which recipes can't be
// costed in full yet, and what each recipe costs at each venue. Both read
// Recipe costs (Costing view), worked out at today's standard supplier
// prices: they have no period, and the venues choice narrows the venues.
// Phase 2: dishes over the target cost % and dishes with no recipe, from
// Dish margins (Costing view), today's prices too.

import { starter } from './define.js'

/** Where these starters come in the list (index.js gathers this folder by it, then by file name). */
export const order = 65

export const starters = [
  starter({
    key: 'recipes_not_fully_costed',
    name: 'Recipes not fully costed',
    about: 'Recipes in use that can\'t be costed in full at a venue: partly costed (some lines have no supplier price or no size for their unit) or not costed at all, with how many gaps each has. Open one to see each gap and how to fix it.',
    period: false,
    spec: {
      subject: 'recipes.costs',
      kind: 'list',
      rows: ['name', 'kind', 'venue.name', 'coverage', 'gaps', 'costed_lines', 'lines'],
      filters: [{ field: 'coverage', op: 'is_not', value: 'full' }, { field: 'active', op: 'is', value: true }],
      sort: [{ by: 'gaps', dir: 'desc' }, { by: 'name', dir: 'asc' }],
    },
  }),

  // Phase 2: dish margins (Costing view), today's prices.
  starter({
    key: 'dishes_over_target',
    name: 'Dishes over the target cost %',
    about: 'Dishes on your live menus whose cost % is above the target at a venue and order type (over target, or over the limit), dearest first: the menu price, the price net of VAT, what the dish costs there, its gross profit and cost %. A meal deal is judged at its dearest picks.',
    period: false,
    spec: {
      subject: 'recipes.margins',
      kind: 'list',
      rows: ['dish', 'menu', 'venue.name', 'order_type', 'price', 'net', 'cost', 'gp', 'cost_pct', 'target_pct', 'band'],
      filters: [{ field: 'band', op: 'in', value: ['watch', 'over'] }],
      sort: [{ by: 'cost_pct', dir: 'desc' }, { by: 'dish', dir: 'asc' }],
    },
  }),

  starter({
    key: 'dishes_no_recipe',
    name: 'Dishes with no recipe',
    about: 'Dishes on your live menus with no recipe linked at a venue and order type, so they have no cost and no margin there. Link each on the Recipes page, Dishes tab (it offers matches by product code and name). Meal deals and services need no recipe and are left out.',
    period: false,
    spec: {
      subject: 'recipes.margins',
      kind: 'list',
      rows: ['dish', 'menu', 'section', 'venue.name', 'order_type', 'price'],
      filters: [{ field: 'has_recipe', op: 'is', value: false }, { field: 'kind', op: 'in', value: ['dish', 'goods'] }],
      sort: [{ by: 'dish', dir: 'asc' }],
    },
  }),

  starter({
    key: 'recipes_cost_by_venue',
    name: 'Recipe cost by venue',
    about: 'What each recipe in use costs at each venue at today\'s standard supplier prices, before VAT: per portion for a dish, per unit for a prep recipe, and how much of it could be costed. A partly costed recipe\'s cost leaves its gaps out.',
    period: false,
    spec: {
      subject: 'recipes.costs',
      kind: 'list',
      rows: ['name', 'kind', 'venue.name', 'unit_cost', 'unit', 'cost', 'coverage'],
      filters: [{ field: 'active', op: 'is', value: true }],
      sort: [{ by: 'name', dir: 'asc' }],
    },
  }),
]
