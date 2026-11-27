// src/reports/catalogue/recipes.js
//
// Recipes in the report catalogue (inventory phase 1, migrations 298 to 300):
// the recipes and prep recipes, their lines, and what each recipe costs at
// each venue. Recipes are for people with Recipes view; what a recipe costs
// is worked out in code for each run by the Recipes page's own rule
// (work/recipes.js, recipeCost() in shared/costing.js) at each venue's
// standard supplier prices, and needs Costing view: a cost tells what
// suppliers charge. Costs are in pounds, before VAT, as purchasing keeps them.

import { subject, text, number, money, percent, yesno, choice, moment, sum, avg, count, one, many } from './define.js'

const COSTING = 'costing'
const pounds = (src, opts = {}) => money(src, { unit: 'pounds', needs: COSTING, ...opts })

const KINDS = { dish: 'Dish', prep: 'Prep' }
const STATUSES = { draft: 'Draft', live: 'Live' }
const COVERAGE = { full: 'Fully costed', partial: 'Partly costed', none: 'Not costed' }

// The tables a recipe's cost is worked out from (the work subject's from.tables).
export const RECIPE_COST_TABLES = ['recipes', 'recipe_lines', 'inv_item_units']

/** Where these subjects come in the catalogue (index.js gathers this folder by it, then by file name). */
export const order = 105

/**
 * This area's tables that no subject reads, and why (decisions.js gathers
 * them): settings (how something is set up) and out ({ reason: [tables] }).
 * Recipes and their lines are subjects, and an item's own units are read by
 * the cost subject's work.
 */
export const decisions = {
  settings: [],
  out: {},
}

export const subjects = [
  subject({
    key: 'recipes.recipes',
    label: 'Recipes',
    one: 'recipe',
    area: 'recipes',
    module: 'recipes',
    about: 'Every dish and prep recipe: what kind it is, what it makes (portions for a dish; a quantity for a prep recipe, before what cooking loses), whether it is a draft or live, and the recipe it is a variation of.',
    from: 'recipes',
    name: 'name',
    open: { page: '/recipes?recipe=:id', module: 'recipes' },
    fields: {
      name: text('name'),
      kind: choice('kind', KINDS, { label: 'Kind' }),
      category: text('category'),
      code: text('code', { label: 'Our code' }),
      status: choice('status', STATUSES),
      portions: number('portions', { label: 'Portions', about: 'How many portions a dish recipe makes (empty for prep).' }),
      yield_qty: number('yield_qty', { label: 'Makes', about: 'How much a prep recipe makes before what cooking loses.' }),
      yield_unit: text('yield_unit', { label: 'Made in' }),
      loss_pct: percent('loss_pct', { label: 'Lost in cooking' }),
      shelf_life_hours: number('shelf_life_hours', { label: 'Keeps for (hours)', decimals: 0 }),
      variation: yesno({ sql: '({t}.variant_of IS NOT NULL)' }, { label: 'A variation' }),
      variation_of: text({ sql: '(SELECT v.name FROM recipes v WHERE v.id = {t}.variant_of AND v.tenant_id = {t}.tenant_id)' }, { label: 'Variation of' }),
      has_method: yesno({ sql: "(COALESCE(btrim({t}.method), '') <> '')" }, { label: 'Has a method' }),
      has_photo: yesno({ sql: '({t}.photo_url IS NOT NULL)' }, { label: 'Has a photo' }),
      active: yesno('is_active', { label: 'In use' }),
      notes: text('notes'),
      added_by: text('created_by', { label: 'Added by' }),
      added_at: moment('created_at', { label: 'Added at' }),
      changed_at: moment('updated_at', { label: 'Last changed' }),
    },
    measures: {
      recipes: count({ label: 'Recipes', where: '{t}.is_active', about: 'Recipes in use.' }),
      prep_recipes: count({ label: 'Prep recipes', where: "{t}.is_active AND {t}.kind = 'prep'" }),
      drafts: count({ label: 'Drafts', where: "{t}.is_active AND {t}.status = 'draft'" }),
    },
    links: {
      lines: many('recipes.lines', 'recipe_id', { label: 'Lines' }),
    },
    list: ['name', 'kind', 'category', 'status', 'variation_of', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
  }),

  subject({
    key: 'recipes.lines',
    label: 'Recipe lines',
    one: 'recipe line',
    area: 'recipes',
    module: 'recipes',
    about: 'What goes into each recipe: an inventory item or a prep recipe, how much in which unit, and a yield of the line\'s own where it trims harder than usual.',
    from: 'recipe_lines',
    open: 'recipe',
    fields: {
      what: text({ sql: "COALESCE((SELECT i.name FROM inv_items i WHERE i.id = {t}.item_id AND i.tenant_id = {t}.tenant_id), (SELECT r.name FROM recipes r WHERE r.id = {t}.sub_recipe_id AND r.tenant_id = {t}.tenant_id))" }, { label: 'What it uses' }),
      line_kind: choice({ sql: "(CASE WHEN {t}.sub_recipe_id IS NOT NULL THEN 'prep' ELSE 'item' END)" }, { item: 'Inventory item', prep: 'Prep recipe' }, { label: 'Item or prep' }),
      qty: number('qty', { label: 'Quantity' }),
      unit: text('unit'),
      yield_pct: percent('yield_pct', { label: 'Line yield', about: 'The usable share for this line, when it differs from the item\'s own.' }),
      note: text('note'),
      position: number({ sql: '({t}.sort_order + 1)' }, { label: 'Line number', decimals: 0 }),
    },
    measures: {
      lines: count({ label: 'Lines' }),
    },
    links: {
      recipe: one('recipes.recipes', 'recipe_id', { label: 'Recipe' }),
      item: one('purchasing.items', 'item_id', { label: 'Inventory item' }),
      prep: one('recipes.recipes', 'sub_recipe_id', { label: 'Prep recipe' }),
    },
    list: ['recipe.name', 'position', 'what', 'qty', 'unit', 'yield_pct', 'note'],
    sort: [{ by: 'recipe.name', dir: 'asc' }, { by: 'position', dir: 'asc' }],
  }),

  // What each recipe costs at each venue, worked out for each run by the
  // Recipes page's rule (work/recipes.js), at the standard supplier prices.
  subject({
    key: 'recipes.costs',
    label: 'Recipe costs',
    one: 'recipe at a venue',
    area: 'recipes',
    module: COSTING,
    about: 'What each recipe costs at each venue at today\'s standard supplier prices (each venue\'s supplier choice, else the group\'s, else the cheapest), before VAT: the whole recipe, per portion or per unit it makes, and how much of it could be costed. Lines with no price or no size for their unit are left out of the cost and counted as gaps. Not by period: it is now.',
    from: { work: 'recipe_costs', tables: RECIPE_COST_TABLES },
    idType: 'text',
    venue: 'venue_id',
    name: 'name',
    open: 'recipe',
    fields: {
      name: text('name', { label: 'Recipe' }),
      kind: choice('kind', KINDS, { label: 'Kind' }),
      category: text('category'),
      status: choice('status', STATUSES),
      active: yesno('active', { label: 'In use' }),
      cost: pounds('cost', { label: 'Recipe cost', synonyms: ['batch cost'], about: 'All of its lines that could be costed, at the venue\'s standard prices, before VAT.' }),
      unit_cost: pounds('per_unit', { label: 'Cost per portion or unit', adds: false, synonyms: ['plate cost', 'food cost', 'cost per portion', 'portion cost'], about: 'A dish\'s cost per portion, or a prep recipe\'s per unit it makes (after what cooking loses).' }),
      unit: text('unit', { label: 'Per' }),
      makes: number('makes', { label: 'Makes', about: 'Portions for a dish; for a prep recipe what it makes after cooking.' }),
      coverage: choice('coverage', COVERAGE, { label: 'Costed', about: 'Fully costed, partly costed (some lines have no price or no size for their unit), or not costed at all.' }),
      gaps: number('gaps', { label: 'Gaps', decimals: 0, about: 'Lines (or the recipe itself) that could not be costed.' }),
      lines: number('lines', { label: 'Lines', decimals: 0 }),
      costed_lines: number('costed_lines', { label: 'Lines costed', decimals: 0 }),
    },
    measures: {
      recipes: count({ label: 'Recipes costed', about: 'Recipes at venues (one row for each recipe at each venue).' }),
      fully_costed: count({ label: 'Fully costed', where: "{t}.coverage = 'full'" }),
      not_fully_costed: count({ label: 'Not fully costed', where: "{t}.coverage <> 'full'" }),
      average_unit_cost: avg('per_unit', { type: 'money', unit: 'pounds', needs: COSTING, label: 'Average cost per portion or unit' }),
      total_gaps: sum('gaps', { label: 'Gaps' }),
    },
    links: {
      recipe: one('recipes.recipes', 'recipe_id', { label: 'Recipe details' }),
    },
    list: ['name', 'venue.name', 'kind', 'unit_cost', 'unit', 'coverage', 'gaps'],
    sort: [{ by: 'name', dir: 'asc' }],
  }),
]
