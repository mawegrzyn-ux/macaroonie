// src/reports/starters/recipes.js
//
// Starter reports on recipes (inventory phase 1): which recipes can't be
// costed in full yet, and what each recipe costs at each venue. Both read
// Recipe costs (Costing view), worked out at today's standard supplier
// prices: they have no period, and the venues choice narrows the venues.
// Phase 2: dishes over the target cost % and dishes with no recipe, from
// Dish margins (Costing view), today's prices too. Phase 3: uncosted dishes
// by sales, from Recipe coverage (sales in pounds need till reports view).
// Phase 7a: menu engineering this month, from Menu engineering.

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
    about: 'Dishes on your live menus whose cost % is above the target at a venue and order type (over target, or over the limit), dearest first: the menu price, the price net of VAT, what the dish costs there, its gross profit and cost %. A meal deal is judged at its highest cost %: the picks that cost most for what they sell for, extra charges included.',
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

  // Phase 3: what was sold and can't be costed, from Recipe coverage.
  starter({
    key: 'uncosted_dishes_by_sales',
    name: 'Uncosted dishes by sales',
    about: 'The dishes sold in the last 14 days that couldn\'t be costed as they were sold (with the options and meal deal picks each sale had), most units first: how many sold and how many weren\'t costed, what they sold for net, and why not (no recipe linked, a recipe with gaps, an option with no rule or not matched, an item with no price) with how to fix it. From usage from sales (inventory phase 5). Costing these first costs most of what you sell.',
    period: { relative: 'last_n_days', n: 14 },
    spec: {
      subject: 'stock.dish_sales',
      rows: ['dish', 'venue.name', 'why', 'fix'],
      values: [{ measure: 'uncosted' }, { measure: 'units_sold' }, { measure: 'net_sales' }],
      // Units not costed, not "not fully costed": open items, services and dishes gone from every menu are left
      // out (left_out, with no units uncosted), never listed as dishes to cost.
      filters: [{ field: 'uncosted_units', op: 'gt', value: 0 }],
      sort: [{ by: 'uncosted', dir: 'desc' }],
    },
  }),

  // Phase 7a: menu engineering from what sold this month (GP and classes need till reports view too).
  starter({
    key: 'menu_engineering_month',
    name: 'Menu engineering this month',
    about: 'Each dish sold this month in each menu section as a star (sells well and earns at least the section\'s average gross profit per unit), plough-horse (sells well, earns less), puzzle (earns more, sells little) or dog (neither), with its units, share of the section, GP per unit, total GP, cost % and what to do with it. From usage from sales; a meal deal is one dish of its own section.',
    period: { relative: 'this_month' },
    // Engineering is over every venue together (the subject has no venue: a section's dishes are compared across them).
    venues: false,
    spec: {
      subject: 'recipes.engineering',
      kind: 'list',
      rows: ['section', 'dish', 'class', 'units', 'share', 'gp_per_unit', 'section_gp_per_unit', 'gp', 'cost_pct', 'suggestion'],
      sort: [{ by: 'section', dir: 'asc' }, { by: 'units', dir: 'desc' }],
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
