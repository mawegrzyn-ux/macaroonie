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
// Phase 7b (migration 315): cost alerts, the dishes a supplier price change
// took over their cost target or limit (price creep), as the price change
// hook recorded them. Phase 8a (migration 316): allergen checks, each dish's
// declared allergens against what its recipes suggest, as last worked out.
// Phase 8b (migrations 317 and 318): what change opened an allergen check
// again, and calorie checks, each dish's declared calories against one
// serving of its recipe (shared/calorieCheck.js), as last worked out.

import { subject, text, number, money, percent, yesno, choice, moment, sum, avg, count, countDistinct, one, many } from './define.js'
import { CREEP_SOURCES } from '../../../../shared/priceCreep.js'
import { CHECK_STATUSES } from '../../../../shared/allergenCheck.js'
import { CALORIE_KINDS } from '../../../../shared/calorieCheck.js'

const CALORIE_KIND_LABELS = Object.fromEntries(Object.entries(CALORIE_KINDS).map(([k, v]) => [k, v.label]))

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

  // Phase 7b (migration 315): price creep, as the price change hook recorded it.
  subject({
    key: 'recipes.cost_alerts',
    label: 'Cost alerts',
    one: 'cost alert',
    area: 'recipes',
    module: COSTING,
    about: 'Each time a supplier price change (a price typed in or edited, an inventory import, a supplier\'s price list, an invoice\'s prices applied) took a dish on a live menu over its cost target or its limit at a venue: the dish at its worst order type, its cost % before and after at today\'s menu price, the % it crossed, what moved (the ingredients whose cost went up or down, in words), where the change came from and who made it, and who marked it seen on the Menu margins page.',
    from: 'cost_alerts',
    venue: 'venue_id',
    name: 'dish',
    date: { sql: '{t}.day', label: 'Day' },
    open: { page: '/menu-margins?venue=:venue&alerts=1&alert=:id', module: COSTING, with: { venue: 'venue_id' } },
    skip: ['menu_id', 'order_type_id', 'po_id', 'causes'],
    fields: {
      dish: text('name', { label: 'Dish', synonyms: ['menu item'] }),
      menu: text('menu', { label: 'Menu' }),
      section: text('section', { label: 'Section' }),
      order_type: text('order_type', { label: 'Order type', about: 'Where its cost % is worst (the VAT differs by order type).' }),
      old_cost_pct: percent('old_cost_pct', { label: 'Cost % before', about: 'At the prices before the change, today\'s menu price and recipe; empty when it couldn\'t be costed then.' }),
      new_cost_pct: percent('new_cost_pct', { label: 'Cost % after', synonyms: ['food cost percent', 'cost percentage'] }),
      points_up: number({ sql: '({t}.new_cost_pct - {t}.old_cost_pct)' }, { label: 'Points up', decimals: 1, adds: false, about: 'How many points the cost % rose (after less before).' }),
      old_band: choice('old_band', BANDS, { label: 'Before' }),
      new_band: choice('new_band', BANDS, { label: 'After' }),
      over_limit: yesno({ sql: "({t}.new_band = 'over')" }, { label: 'Over the limit', about: 'Over the limit cost % (else over the target).' }),
      crossed_pct: percent('threshold_pct', { label: 'Crossed', about: 'The cost % it went over: its target, or its limit.' }),
      target_pct: percent('target_pct', { label: 'Target cost %' }),
      limit_pct: percent('limit_pct', { label: 'Limit cost %' }),
      cause: text('cause', { label: 'What moved', synonyms: ['price rise', 'cost creep', 'price creep', 'why'], about: 'The ingredients whose cost per kg, litre or each moved, biggest effect on a serving first.' }),
      source: choice('source', CREEP_SOURCES, { label: 'Where the change came from' }),
      changed_by: text('changed_by', { label: 'Price changed by' }),
      at: moment('at', { label: 'Changed at' }),
      seen: yesno({ sql: '({t}.seen_at IS NOT NULL)' }, { label: 'Seen' }),
      seen_by: text('seen_by', { label: 'Seen by' }),
      seen_at: moment('seen_at', { label: 'Seen at' }),
    },
    measures: {
      alerts: count({ label: 'Cost alerts', synonyms: ['cost alert', 'price creep', 'cost creep', 'price rise'] }),
      dishes: countDistinct('dish_id', { label: 'Dishes', about: 'Different dishes that crossed.' }),
      unseen: count({ label: 'Not seen yet', where: '{t}.seen_at IS NULL' }),
      average_points_up: avg({ sql: '({t}.new_cost_pct - {t}.old_cost_pct)' }, { label: 'Average points up', decimals: 1 }),
    },
    list: ['date', 'dish', 'venue.name', 'old_cost_pct', 'new_cost_pct', 'crossed_pct', 'cause', 'seen_by'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  // Phase 8a (migration 316): each dish's declared allergens against what its
  // recipes suggest, as the Allergens tab or Pepper last worked it out.
  subject({
    key: 'recipes.allergen_checks',
    label: 'Allergen checks',
    one: 'allergen check',
    area: 'recipes',
    module: 'recipes',
    about: 'Each menu dish whose declared allergens differ from what its recipes suggest (the allergens of the supplier products each venue orders, through its prep recipes and its options), or did: open (nobody has decided), accepted (the declaration was changed to match, in the menu\'s draft) or dismissed (kept as declared, with why). As last worked out on the Recipes page\'s Allergens tab or by Pepper. The declaration on the menu is what guests are told; this is a check on it, only as good as the supplier data under it.',
    from: 'allergen_checks',
    name: 'dish',
    open: { page: '/recipes?tab=allergens&check=:id', module: 'recipes', id: 'dish_id' },
    // updated_at: any save of the row (worked out again, decided); Last worked out and Decided at say when.
    // venue_ids (phase 8b): where Today shows a check, the dish's menu's venues.
    skip: ['menu_id', 'fingerprint', 'suggested', 'declared', 'scopes', 'history', 'updated_at', 'venue_ids'],
    fields: {
      dish: text('dish', { label: 'Dish', synonyms: ['menu item'] }),
      menu: text('menu', { label: 'Menu' }),
      section: text('section', { label: 'Section' }),
      status: choice('status', CHECK_STATUSES, { label: 'Status', about: 'Open: nobody has decided. Accepted: the declaration was changed to match. Dismissed: kept as declared, with a note.' }),
      differences: number({ sql: 'jsonb_array_length({t}.differences)' }, { label: 'Differences', decimals: 0, about: 'Allergens where the recipe and the declaration differ (for an accepted check, the ones accepted).' }),
      what_differs: text({ sql: "(SELECT string_agg(e->>'text', '; ' ORDER BY e->>'allergen') FROM jsonb_array_elements({t}.differences) e)" }, {
        label: 'What differs', synonyms: ['allergen', 'may contain', 'sesame', 'gluten', 'nuts', 'allergen difference'],
        about: 'Each difference in words: "The recipe has sesame; the dish does not say so", "The dish declares celery; nothing in the recipe has it".',
      }),
      allergens: text({ sql: "(SELECT string_agg(e->>'label', ', ' ORDER BY e->>'allergen') FROM jsonb_array_elements({t}.differences) e)" }, { label: 'Allergens that differ', synonyms: ['allergens', 'which allergen'] }),
      complete: yesno('complete', { label: 'Every product known', about: 'Every ingredient\'s supplier product has its allergens; when not, an allergen declared that nothing has can\'t be said.' }),
      gaps: number('gaps', { label: 'Allergens unknown', decimals: 0, about: 'Ingredients whose supplier product has no allergens yet (or has no supplier product), and other gaps such as no recipe at a venue.' }),
      decided_by: text('decided_by', { label: 'Decided by' }),
      decided_at: moment('decided_at', { label: 'Decided at' }),
      note: text('note', { label: 'Why dismissed', about: 'The note left when the check was dismissed.' }),
      worked_at: moment('worked_at', { label: 'Last worked out' }),
      first_found: moment('created_at', { label: 'First found' }),
      // Phase 8b (migration 317): opened again by a change, until someone decides.
      change: text('change', { label: 'What changed', synonyms: ['reopened', 'opened again', 'substitute'], about: 'The change that opened the check again or changed it while open ("Oyster sauce: the usual supplier switched at Leeds"), until someone decides.' }),
      changed_at: moment('changed_at', { label: 'Changed at' }),
    },
    measures: {
      checks: count({ label: 'Allergen checks', synonyms: ['allergen check', 'allergen differences'] }),
      open: count({ label: 'Open', where: "{t}.status = 'open'", synonyms: ['allergens to check'] }),
      dishes: countDistinct('dish_id', { label: 'Dishes' }),
      unknown: sum('gaps', { label: 'Allergens unknown' }),
    },
    list: ['dish', 'menu', 'status', 'what_differs', 'gaps', 'decided_by', 'decided_at'],
    sort: [{ by: 'dish', dir: 'asc' }],
  }),

  // Phase 8b (migration 318): each dish's declared calories against one serving
  // of its recipe, as the Allergens tab, the recipe editor or a change last
  // worked it out.
  subject({
    key: 'recipes.calorie_checks',
    label: 'Calorie checks',
    one: 'calorie check',
    area: 'recipes',
    module: 'recipes',
    about: 'Each menu dish whose declared calories differ from what one serving of its recipe comes to (each ingredient\'s energy through its prep recipes, at each venue it is sold at: the highest), or did: open, accepted (the figure was written into the menu\'s draft) or dismissed (kept, with why). A figure within 10% (at least 10 kcal) agrees. While an ingredient\'s energy is unknown there is no suggestion, only what is known so far. As last worked out on the Recipes page\'s Allergens tab. Calorie labelling applies in England to businesses with 250 or more employees, counting a franchise\'s whole network: confirm the detail.',
    from: 'calorie_checks',
    name: 'dish',
    open: { page: '/recipes?tab=allergens&check=:id', module: 'recipes', id: 'dish_id' },
    skip: ['menu_id', 'fingerprint', 'scopes', 'history', 'updated_at', 'venue_ids'],
    fields: {
      dish: text('dish', { label: 'Dish', synonyms: ['menu item'] }),
      menu: text('menu', { label: 'Menu' }),
      section: text('section', { label: 'Section' }),
      status: choice('status', CHECK_STATUSES, { label: 'Status', about: 'Open: nobody has decided. Accepted: the suggested figure was written into the menu\'s draft. Dismissed: kept as declared, with a note.' }),
      kind: choice('kind', CALORIE_KIND_LABELS, { label: 'What differs', about: 'No calories declared; the declared figure differs (beyond 10%); or the dish declares less than what is known already comes to.' }),
      difference: text({ sql: "(CASE {t}.kind WHEN 'missing' THEN 'The recipe comes to ' || {t}.suggested_kcal || ' kcal; the dish declares no calories' WHEN 'differs' THEN 'The recipe comes to ' || {t}.suggested_kcal || ' kcal; the dish declares ' || {t}.declared_kcal || ' kcal' WHEN 'under' THEN 'What is known already comes to more than the ' || {t}.declared_kcal || ' kcal the dish declares' END)" }, {
        label: 'Calories difference', synonyms: ['calorie', 'calories', 'kcal', 'energy'],
        about: 'The difference in words: "The recipe comes to 722 kcal; the dish declares 600 kcal".',
      }),
      suggested_kcal: number('suggested_kcal', { label: 'Suggested kcal', decimals: 0, synonyms: ['calorie', 'kcal', 'energy', 'calories from the recipe'], about: 'One serving of the recipe, at the venue where it comes to most. Empty while anything is unknown.' }),
      declared_kcal: number('declared_kcal', { label: 'Declared kcal', decimals: 0, synonyms: ['menu calories'], about: 'What the dish declares on the menu\'s draft.' }),
      min_kcal: number('min_kcal', { label: 'Lowest at a venue (kcal)', decimals: 0 }),
      max_kcal: number('max_kcal', { label: 'Highest at a venue (kcal)', decimals: 0 }),
      complete: yesno('complete', { label: 'Every energy known', about: 'Every ingredient has its energy and every quantity is known; when not, there is no suggestion.' }),
      gaps: number('gaps', { label: 'Not known', decimals: 0, about: 'Ingredients with no energy figure, quantities in a unit with no size, and other gaps such as no recipe at a venue.' }),
      decided_kcal: number('decided_kcal', { label: 'Decided kcal', decimals: 0, about: 'The figure written into the draft (accepted) or the suggestion dismissed.' }),
      decided_by: text('decided_by', { label: 'Decided by' }),
      decided_at: moment('decided_at', { label: 'Decided at' }),
      note: text('note', { label: 'Why dismissed' }),
      change: text('change', { label: 'What changed', about: 'The change that opened it again, until someone decides.' }),
      changed_at: moment('changed_at', { label: 'Changed at' }),
      worked_at: moment('worked_at', { label: 'Last worked out' }),
      first_found: moment('created_at', { label: 'First found' }),
    },
    measures: {
      checks: count({ label: 'Calorie checks', synonyms: ['calorie check', 'calorie differences', 'kcal'] }),
      open: count({ label: 'Open', where: "{t}.status = 'open'", synonyms: ['calories to check'] }),
      dishes: countDistinct('dish_id', { label: 'Dishes' }),
      unknown: sum('gaps', { label: 'Energy not known' }),
    },
    list: ['dish', 'menu', 'status', 'difference', 'suggested_kcal', 'declared_kcal', 'gaps', 'decided_by'],
    sort: [{ by: 'dish', dir: 'asc' }],
  }),
]
