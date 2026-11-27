// src/reports/starters/recipes.js
//
// Starter reports on recipes (inventory phase 1): which recipes can't be
// costed in full yet, and what each recipe costs at each venue. Both read
// Recipe costs (Costing view), worked out at today's standard supplier
// prices: they have no period, and the venues choice narrows the venues.

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
