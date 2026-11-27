// src/reports/catalogue/recipes.js
//
// Recipes in the report catalogue (inventory phase 1, migrations 298 to 300):
// the recipes and prep recipes, their lines, and what each recipe costs at
// each venue. Phase 2 (migration 302): which recipe each menu dish uses
// where (recipe links), and each live dish's margin at each venue and order
// type (dish margins, a work). Recipes are for people with Recipes view; what a recipe costs
// is worked out in code for each run by the Recipes page's own rule
// (work/recipes.js, recipeCost() in shared/costing.js) at each venue's
// standard supplier prices, and needs Costing view: a cost tells what
// suppliers charge. Costs are in pounds, before VAT, as purchasing keeps them.

import { subject, text, number, money, percent, yesno, choice, moment, sum, avg, count, countDistinct, one, many } from './define.js'

const COSTING = 'costing'
const pounds = (src, opts = {}) => money(src, { unit: 'pounds', needs: COSTING, ...opts })

const KINDS = { dish: 'Dish', prep: 'Prep' }
const STATUSES = { draft: 'Draft', live: 'Live' }
const COVERAGE = { full: 'Fully costed', partial: 'Partly costed', none: 'Not costed' }

// The tables a recipe's cost is worked out from (the work subject's from.tables).
export const RECIPE_COST_TABLES = ['recipes', 'recipe_lines', 'inv_item_units']
// And a dish's margin (phase 2): the links, the option rules and the targets
// too. Read by the dish margins work, so they are decided as read.
export const DISH_MARGIN_TABLES = [...RECIPE_COST_TABLES, 'recipe_links', 'recipe_option_rules', 'costing_settings']
// And coverage by sales (phase 3): what was sold on each channel too (pos_devices tells a kiosk's checks from the till's).
export const COVERAGE_TABLES = [...DISH_MARGIN_TABLES, 'pos_check_lines', 'pos_checks', 'pos_days', 'pos_devices', 'order_items', 'orders', 'ext_check_lines', 'ext_checks', 'ext_line_parts']
// And menu engineering (phase 7a): usage from sales and the menus' sections and dishes it names.
export const ENGINEERING_TABLES = ['dish_cost_days', 'menu_sections', 'menu_items', 'menus']
const CLASS_LABELS = { star: 'Star', plough_horse: 'Plough-horse', puzzle: 'Puzzle', dog: 'Dog', not_costed: 'Not costed' }
const SALES = [COSTING, 'pos_reports']
const CHANNELS = { till: 'Till', kiosk: 'Kiosk', online: 'Online orders', imported: 'Other tills' }
const SOLD_STATES = { costed: 'Costed', uncosted: 'Not costed', left_out: 'Left out (a service, or no longer on a menu)' }
const FIX_KINDS = { link: 'Link a recipe', recipe: 'Finish the recipe', option: 'Add an option rule', deal: 'Cost the meal deal\'s dishes', map: 'Map it to a menu dish' }

const BANDS = { good: 'On target', watch: 'Over target', over: 'Over the limit' }
const DISH_KINDS = { dish: 'Dish', deal: 'Meal deal', goods: 'Goods', service: 'Service' }
const DISH_COVERAGE = { full: 'Fully costed', partial: 'Partly costed', none: 'Not costed', not_needed: 'No recipe needed (a service)' }
// A link's dish, its menu and section, from the menu as it is being edited (plain ids: a dish gone is empty).
const DISH_NAME = '(SELECT d.name FROM menu_items d WHERE d.id = {t}.dish_id AND d.tenant_id = {t}.tenant_id)'
const DISH_MENU = '(SELECT m.name FROM menu_items d JOIN menu_sections s ON s.id = d.section_id AND s.tenant_id = d.tenant_id'
  + ' JOIN menus m ON m.id = s.menu_id AND m.tenant_id = s.tenant_id WHERE d.id = {t}.dish_id AND d.tenant_id = {t}.tenant_id)'
const DISH_SECTION = '(SELECT s.title FROM menu_items d JOIN menu_sections s ON s.id = d.section_id AND s.tenant_id = d.tenant_id'
  + ' WHERE d.id = {t}.dish_id AND d.tenant_id = {t}.tenant_id)'
const VENUE_NAME = '(SELECT v.name FROM venues v WHERE v.id = {t}.venue_id AND v.tenant_id = {t}.tenant_id)'
const STREAM_NAME = '(SELECT r.name FROM pos_revenue_streams r WHERE r.id = {t}.revenue_stream_id AND r.tenant_id = {t}.tenant_id)'
const TYPE_NAME = '(SELECT o.name FROM order_types o WHERE o.id = {t}.order_type_id AND o.tenant_id = {t}.tenant_id)'
// Where a link applies, in the words of scopeText() in shared/costing.js.
const WHERE = "(CASE WHEN {t}.order_type_id IS NOT NULL THEN COALESCE(" + TYPE_NAME + ", 'an order type') || ' at ' ELSE '' END"
  + " || CASE WHEN {t}.revenue_stream_id IS NOT NULL THEN COALESCE(" + STREAM_NAME + ", 'a revenue stream') || ' (' || COALESCE(" + VENUE_NAME + ", 'a venue') || ')'"
  + " WHEN {t}.venue_id IS NOT NULL THEN COALESCE(" + VENUE_NAME + ", 'a venue') ELSE 'every venue' END)"

/** Where these subjects come in the catalogue (index.js gathers this folder by it, then by file name). */
export const order = 105

/**
 * This area's tables that no subject reads, and why (decisions.js gathers
 * them): settings (how something is set up) and out ({ reason: [tables] }).
 * Recipes, their lines and the links are subjects; an item's own units, the
 * option rules and the cost % targets are read by the works (recipe costs,
 * dish margins), so none is left to decide.
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
      what: text({ sql: "COALESCE((SELECT i.name FROM inv_items i WHERE i.id = {t}.item_id AND i.tenant_id = {t}.tenant_id), (SELECT r.name FROM recipes r WHERE r.id = {t}.sub_recipe_id AND r.tenant_id = {t}.tenant_id))" }, { label: 'What it uses', synonyms: ['ingredient', 'ingredients', 'what goes into it'] }),
      line_kind: choice({ sql: "(CASE WHEN {t}.sub_recipe_id IS NOT NULL THEN 'prep' ELSE 'item' END)" }, { item: 'Inventory item', prep: 'Prep recipe' }, { label: 'Item or prep' }),
      qty: number('qty', { label: 'Quantity' }),
      unit: text('unit'),
      yield_pct: percent('yield_pct', { label: 'Line yield', about: 'The usable share for this line, when it differs from the item\'s own.' }),
      note: text('note'),
      position: number({ sql: '({t}.sort_order + 1)' }, { label: 'Line number', decimals: 0 }),
    },
    measures: {
      lines: count({ label: 'Lines', synonyms: ['ingredients'] }),
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
      // Dishes only: a prep recipe is costed per litre, kg or each it makes, which can't be averaged with a portion.
      average_portion_cost: avg('per_unit', {
        type: 'money', unit: 'pounds', needs: COSTING, label: 'Average cost per portion', where: "{t}.kind = 'dish'",
        synonyms: ['average plate cost', 'average food cost'],
        about: 'Dishes\' cost per portion, on average. Prep recipes are left out: each is costed per unit it makes (a litre, a kg), which can\'t be averaged with a portion.',
      }),
      total_gaps: sum('gaps', { label: 'Gaps' }),
    },
    links: {
      recipe: one('recipes.recipes', 'recipe_id', { label: 'Recipe details' }),
    },
    list: ['name', 'venue.name', 'kind', 'unit_cost', 'unit', 'coverage', 'gaps'],
    sort: [{ by: 'name', dir: 'asc' }],
  }),

  // Which recipe each menu dish uses, and where (inventory phase 2, migration 302).
  subject({
    key: 'recipes.links',
    label: 'Recipe links',
    one: 'recipe link',
    area: 'recipes',
    module: 'recipes',
    about: 'Which recipe each menu dish uses, and where: for every venue, or for a venue, a revenue stream, an order type (takeaway, delivery) or a mix of them, with how many portions of it. The closest link to a sale wins. A link whose dish is on no menu any more is marked missing and goes 30 days later.',
    from: 'recipe_links',
    name: 'dish',
    open: { page: '/recipes?tab=dishes&dish=:id', module: 'recipes', id: 'dish_id' },
    fields: {
      dish: text({ sql: DISH_NAME }, { label: 'Dish' }),
      menu: text({ sql: DISH_MENU }, { label: 'Menu' }),
      section: text({ sql: DISH_SECTION }, { label: 'Section' }),
      applies_to: text({ sql: WHERE }, { label: 'Where', synonyms: ['variation', 'takeaway version', 'matrix'], about: 'Where the link applies: every venue, a venue, a revenue stream, an order type, or an order type at one of them.' }),
      venue_name: text({ sql: "(CASE WHEN {t}.venue_id IS NULL THEN 'Every venue' ELSE " + VENUE_NAME + ' END)' }, { label: 'Venue' }),
      stream: text({ sql: STREAM_NAME }, { label: 'Revenue stream' }),
      order_type: text({ sql: "(CASE WHEN {t}.order_type_id IS NULL THEN 'Any' ELSE " + TYPE_NAME + ' END)' }, { label: 'Order type' }),
      default_link: yesno({ sql: '({t}.venue_id IS NULL AND {t}.revenue_stream_id IS NULL AND {t}.order_type_id IS NULL)' }, { label: 'For every venue', about: 'The dish\'s own recipe everywhere, unless a closer link says otherwise.' }),
      portions: number('portions', { label: 'Portions' }),
      missing: yesno({ sql: '({t}.missing_since IS NOT NULL)' }, { label: 'No longer on a menu' }),
      missing_since: moment('missing_since', { label: 'Gone from the menus since' }),
      added_by: text('created_by', { label: 'Added by' }),
      added_at: moment('created_at', { label: 'Added at' }),
      changed_at: moment('updated_at', { label: 'Last changed' }),
    },
    measures: {
      links: count({ label: 'Links' }),
      dishes: countDistinct('dish_id', { label: 'Dishes linked' }),
      some_places: count({ label: 'Links for some places only', where: '({t}.venue_id IS NOT NULL OR {t}.order_type_id IS NOT NULL)' }),
    },
    links: {
      recipe: one('recipes.recipes', 'recipe_id', { label: 'Recipe' }),
    },
    list: ['dish', 'menu', 'recipe.name', 'applies_to', 'portions', 'missing'],
    sort: [{ by: 'dish', dir: 'asc' }],
  }),

  // What was sold, costed or not (phase 3), worked out for each run by the
  // Recipes page's coverage rule (work/recipes.js, salesCoverage() in
  // shared/costing.js). Sales are till figures: their pounds need till reports view.
  subject({
    key: 'recipes.coverage',
    label: 'Recipe coverage',
    one: 'dish sold on a day',
    area: 'recipes',
    module: 'recipes',
    about: 'Each dish sold on a trading day at a venue (till, kiosk, online and other tills; test till sales left out), whether it can be costed there with today\'s recipes (its recipe has no gaps and its options have rules), and why not. The share costed of sales is coverage.',
    from: { work: 'recipe_coverage', tables: COVERAGE_TABLES },
    idType: 'text',
    venue: 'venue_id',
    date: { sql: '{t}.date', label: 'Trading day' },
    name: 'dish',
    open: { page: '/recipes?tab=dishes&dish=:id', module: 'recipes', id: 'dish_id' },
    fields: {
      dish: text('dish', { label: 'Dish', synonyms: ['uncosted dish', 'menu item'] }),
      menu: text('menu', { label: 'Menu' }),
      channel: choice('channel', CHANNELS, { label: 'Sold through' }),
      where_sold: text('where_sold', { label: 'Sold at', about: 'The venue, revenue stream and order type it was sold at, in words.' }),
      sales: money('sales_pence', { label: 'Sales value', needs: 'pos_reports', about: 'What it sold for after discounts, VAT included.' }),
      qty: number('qty', { label: 'Units sold', adds: true, decimals: 0 }),
      state: choice('state', SOLD_STATES, { label: 'Costed or not' }),
      costed: yesno('costed', { label: 'Costed', synonyms: ['costed', 'has a recipe', 'coverage'] }),
      fix_kind: choice('fix_kind', FIX_KINDS, { label: 'How to fix' }),
      why: text('why', { label: 'Why not', about: 'What stops it being costed, and how to fix each.' }),
      recipe: text('recipe', { label: 'Recipe used' }),
    },
    measures: {
      sales_total: sum('sales_pence', { type: 'money', label: 'Sales', needs: 'pos_reports' }),
      sales_costed: sum('sales_pence', { type: 'money', label: 'Sales costed', needs: 'pos_reports', where: '{t}.costed' }),
      sales_uncosted: sum('sales_pence', { type: 'money', label: 'Sales not costed', needs: 'pos_reports', where: "{t}.state = 'uncosted'" }),
      units: sum('qty', { label: 'Units sold' }),
      dishes: countDistinct({ sql: "COALESCE({t}.dish_id::text, {t}.dish)" }, { label: 'Dishes' }),
    },
    list: ['date', 'dish', 'venue.name', 'channel', 'sales', 'qty', 'costed', 'why'],
    sort: [{ by: 'sales', dir: 'desc' }],
  }),

  // Each live menu dish's margin at each venue and order type, worked out
  // for each run by the Menu margins page's rule (work/recipes.js,
  // menuMargins() in shared/costing.js).
  subject({
    key: 'recipes.margins',
    label: 'Dish margins',
    one: 'dish at a venue and order type',
    area: 'recipes',
    module: COSTING,
    about: 'Every dish on your live menus at each venue and order type: its menu price (VAT included), the price net of VAT for that order type, what it costs at the venue\'s standard supplier prices (the recipe its links pick there, times the portions), the gross profit and the cost %, banded against your targets. A meal deal shows the least and the most its picks can cost. Not by period: it is today\'s prices.',
    from: { work: 'dish_margins', tables: DISH_MARGIN_TABLES },
    idType: 'text',
    venue: 'venue_id',
    name: 'dish',
    // A row is one dish at a venue and order type: the page opens at that order type (its VAT, its recipe).
    open: { page: '/menu-margins?menu=:menu&venue=:venue&type=:type&dish=:id', module: COSTING, id: 'dish_id', with: { menu: 'menu_id', venue: 'venue_id', type: 'order_type_id' } },
    fields: {
      dish: text('dish', { label: 'Dish' }),
      menu: text('menu', { label: 'Menu' }),
      section: text('section', { label: 'Section' }),
      kind: choice('kind', DISH_KINDS, { label: 'Kind' }),
      order_type: text('order_type', { label: 'Order type' }),
      recipe: text('recipe', { label: 'Recipe used' }),
      why: text('why', { label: 'Recipe used for', about: 'The link that picked the recipe: every venue, the venue, an order type there.' }),
      has_recipe: yesno('has_recipe', { label: 'Has a recipe', about: 'A recipe is linked for this venue and order type (a meal deal and a service need none).' }),
      price: money('price_pence', { label: 'Menu price', adds: false, about: 'The price on the menu, VAT included (the cheapest when its options set the price).' }),
      net: money('net_pence', { label: 'Price net of VAT', adds: false, synonyms: ['net price', 'ex vat price'] }),
      vat_rate: percent('vat_rate', { label: 'VAT rate' }),
      cost: pounds('cost', { label: 'Dish cost', adds: false, synonyms: ['plate cost', 'dish cost'], about: 'What one serving costs at the venue\'s standard prices, before VAT. Empty for a meal deal (see its lowest and highest) or a dish with no recipe.' }),
      cost_low: pounds('cost_low', { label: 'Meal deal cost from', adds: false }),
      cost_high: pounds('cost_high', { label: 'Meal deal cost up to', adds: false }),
      gp: money('gp_pence', { label: 'Gross profit', adds: false, needs: COSTING, synonyms: ['gp', 'gross profit', 'margin'], about: 'The price net of VAT less the dish cost.' }),
      cost_pct: percent('cost_pct', { label: 'Cost %', needs: COSTING, synonyms: ['food cost percent', 'cost percentage'], about: 'The dish cost as a share of the price net of VAT (for a meal deal, its highest: the picks that cost most for what they sell for, extra charges included).' }),
      band: choice('band', BANDS, { label: 'Against the target', needs: COSTING, about: 'On target (at or below the target cost %), over target (up to the limit) or over the limit.' }),
      target_pct: percent('target_pct', { label: 'Target cost %' }),
      coverage: choice('coverage', DISH_COVERAGE, { label: 'Costed' }),
      gaps: number('gaps', { label: 'Gaps', decimals: 0 }),
    },
    measures: {
      dishes: count({ label: 'Dishes at venues and order types' }),
      over_target: count({ label: 'Over the target', where: "{t}.band IN ('watch', 'over')" }),
      no_recipe: count({ label: 'With no recipe', where: 'NOT {t}.has_recipe' }),
      average_cost_pct: avg('cost_pct', { type: 'percent', label: 'Average cost %', about: 'Dishes\' cost %, each counted once, on average (not weighted by what sold).' }),
    },
    list: ['dish', 'venue.name', 'order_type', 'price', 'net', 'cost', 'gp', 'cost_pct', 'band'],
    sort: [{ by: 'cost_pct', dir: 'desc' }],
  }),

  // Phase 7a: menu engineering from what sold, worked out for each run by
  // the Engineering tab's rule (work/recipes.js, engineer() in
  // shared/engineering.js). GP and the classes are worked out from what the
  // till took: they need till reports view as well.
  subject({
    key: 'recipes.engineering',
    label: 'Menu engineering',
    one: 'dish sold in a menu section',
    area: 'recipes',
    module: COSTING,
    about: 'Each dish sold in each menu section over the period (the venues the report covers, together), by Kasavana and Smith: popular when its share of the section\'s units is at least 70% of an equal share, profitable when its gross profit per unit is at least the section\'s average per unit sold; stars, plough-horses, puzzles and dogs, with what to do with each. From usage from sales: units that couldn\'t be costed count for popularity, never for gross profit. A meal deal rung up as a deal is one dish of its own section; an automatic deal the till found among dishes rung up one by one is a discount over them, which count in their own sections at what they took.',
    from: { work: 'menu_engineering', tables: ENGINEERING_TABLES },
    idType: 'text',
    date: { sql: '{t}.date', label: 'Period ends' },
    name: 'dish',
    open: { page: '/menu-margins?menu=:menu&dish=:id', module: COSTING, id: 'dish_id', with: { menu: 'menu_id' } },
    fields: {
      dish: text('dish', { label: 'Dish', synonyms: ['menu item'] }),
      section: text('section', { label: 'Section', synonyms: ['menu section'] }),
      menu: text('menu', { label: 'Menu' }),
      kind: choice('kind', { dish: 'Dish', deal: 'Meal deal' }, { label: 'Kind' }),
      class: choice('class', CLASS_LABELS, {
        label: 'Menu engineering class', needs: SALES, synonyms: ['menu engineering', 'stars and dogs', 'plough horse', 'plowhorse', 'puzzle', 'kasavana smith'],
        about: 'Star: sells well and earns at least the section\'s average GP per unit; plough-horse: sells well, earns less; puzzle: earns more, sells little; dog: neither. Not costed: none of its units could be costed.',
        examples: ['which dishes are dogs', 'menu engineering this month'],
      }),
      popular: yesno('popular', { label: 'Popular', about: 'Its share of the section\'s units is at least 70% of an equal share.' }),
      profitable: yesno('profitable', { label: 'Profitable', needs: SALES, about: 'Its gross profit per unit is at least the section\'s average per unit sold.' }),
      units: number('units', { label: 'Units sold', adds: true, decimals: 0 }),
      share: percent('share_pct', { label: 'Share of the section\'s units', synonyms: ['menu mix'] }),
      popular_from: percent('popular_pct', { label: 'Popular from', about: '70% of an equal share: 70% divided by the dishes the section sold.' }),
      costed_units: number('costed_units', { label: 'Units costed', adds: true, decimals: 0 }),
      uncosted_units: number('uncosted_units', { label: 'Units left out of GP', adds: true, decimals: 0, about: 'Sold on days or in ways that couldn\'t be costed in full: they count for popularity, never for GP.' }),
      net: money('net_pence', { label: 'Net sales', needs: SALES, about: 'Of the units costed, after discounts, VAT out.' }),
      cost: money('cost_pence', { label: 'Theoretical cost', needs: COSTING }),
      gp: money('gp_pence', { label: 'Gross profit', needs: SALES }),
      gp_per_unit: money('gp_per_unit_pence', { label: 'GP per unit', adds: false, needs: SALES, synonyms: ['contribution margin'] }),
      section_gp_per_unit: money('avg_gp_per_unit_pence', { label: 'Section average GP per unit', adds: false, needs: SALES }),
      cost_pct: percent('cost_pct', { label: 'Cost %', needs: SALES }),
      suggestion: text('suggestion', { label: 'What to do', needs: SALES }),
    },
    measures: {
      dishes: count({ label: 'Dishes' }),
      units_sold: sum('units', { label: 'Units sold' }),
      gross_profit: sum('gp_pence', { type: 'money', label: 'Gross profit', needs: SALES }),
      stars: count({ label: 'Stars', where: "{t}.class = 'star'", needs: SALES }),
      plough_horses: count({ label: 'Plough-horses', where: "{t}.class = 'plough_horse'", needs: SALES }),
      puzzles: count({ label: 'Puzzles', where: "{t}.class = 'puzzle'", needs: SALES }),
      dogs: count({ label: 'Dogs', where: "{t}.class = 'dog'", needs: SALES }),
    },
    skip: ['section_id'],
    list: ['section', 'dish', 'class', 'units', 'share', 'gp_per_unit', 'gp', 'cost_pct', 'suggestion'],
    sort: [{ by: 'section', dir: 'asc' }, { by: 'units', dir: 'desc' }],
  }),

  // Phase 7a (migration 314): the cost scenarios saved on the Scenarios tab.
  subject({
    key: 'recipes.scenarios',
    label: 'Cost scenarios',
    one: 'cost scenario',
    area: 'recipes',
    module: COSTING,
    about: 'Each what-if saved on the Menu margins page\'s Scenarios tab: the menu, the venue, revenue stream and order type it is for, how many days of sales make its mix, how many price and cost changes it holds, who saved it and when, and when its prices were last pushed into the menu\'s draft. Its figures are worked out on the page.',
    from: 'cost_scenarios',
    venue: 'venue_id',
    name: 'name',
    open: { page: '/menu-margins?tab=scenarios&scenario=:id', module: COSTING },
    fields: {
      name: text('name', { label: 'Scenario', synonyms: ['scenario', 'what if'] }),
      menu: text({ sql: '(SELECT m.name FROM menus m WHERE m.id = {t}.menu_id AND m.tenant_id = {t}.tenant_id)' }, { label: 'Menu' }),
      revenue_stream: text({ sql: STREAM_NAME }, { label: 'Revenue stream' }),
      order_type: text({ sql: TYPE_NAME }, { label: 'Order type' }),
      mix_days: number('mix_days', { label: 'Days of sales in the mix', decimals: 0 }),
      changes: number({ sql: 'jsonb_array_length({t}.changes)' }, { label: 'Changes', decimals: 0 }),
      notes: text('notes', { label: 'Notes' }),
      created_by: text('created_by', { label: 'Saved first by' }),
      updated_by: text('updated_by', { label: 'Last saved by' }),
      created_at: moment('created_at', { label: 'Made' }),
      updated_at: moment('updated_at', { label: 'Last saved' }),
      pushed_at: moment('pushed_at', { label: 'Prices last pushed', about: 'When its new prices were last written into the menu\'s draft (publishing is apart).' }),
      pushed_by: text('pushed_by', { label: 'Pushed by' }),
      pushed: yesno({ sql: '({t}.pushed_at IS NOT NULL)' }, { label: 'Prices pushed' }),
    },
    measures: {
      scenarios: count({ label: 'Scenarios' }),
    },
    list: ['name', 'menu', 'venue.name', 'order_type', 'changes', 'updated_at', 'pushed_at'],
    sort: [{ by: 'updated_at', dir: 'desc' }],
  }),
]
