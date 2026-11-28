// shared/registry/recipes.js: the Recipes area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'recipes.recipes', label: 'Recipe', plural: 'Recipes', words: ['recipe', 'prep', 'batch', 'sub-recipe'],
    table: 'recipes', subjects: ['recipes.recipes', 'recipes.lines'],
    page: '/recipes',
    actions: ['read_recipes', 'make_recipe'],
    forms: ['recipe'],
  },
  // Phase 2: which recipe a menu dish uses where (the variation matrix).
  {
    key: 'recipes.links', label: 'Recipe link', plural: 'Recipe links', words: ['link', 'matrix', 'variation', 'takeaway version'],
    table: 'recipe_links', subjects: ['recipes.links'],
    page: '/recipes',
    actions: ['link_recipes'],
  },
  {
    key: 'recipes.option_rules', label: 'Option rule', plural: 'Option rules', words: ['option recipe', 'modifier rule', 'extra cheese'],
    table: 'recipe_option_rules',
    page: '/recipes',
  },
  // A dish's margin is worked out each time; the targets it is judged by are kept.
  {
    key: 'recipes.margins', label: 'Menu margin', plural: 'Menu margins', words: ['margin', 'GP', 'food cost', 'cost target'],
    table: 'costing_settings', subjects: ['recipes.margins'],
    page: '/menu-margins',
  },
  // Phase 7a (migration 314): a what-if on a menu's prices and costs; Push prices writes its prices into the menu's draft.
  {
    key: 'recipes.scenarios', label: 'Cost scenario', plural: 'Cost scenarios', words: ['scenario', 'what if', 'price change', 'push prices'],
    table: 'cost_scenarios', subjects: ['recipes.scenarios'],
    page: '/menu-margins',
    actions: ['save_scenario'],
  },
  // Phase 7b (migration 315): a dish a supplier price change took over its cost target or limit (price creep),
  // recorded by the price change hook; marked seen on the Menu margins page.
  {
    key: 'recipes.cost_alerts', label: 'Cost alert', plural: 'Cost alerts', words: ['price creep', 'cost creep', 'price rise', 'cost alert'],
    table: 'cost_alerts', subjects: ['recipes.cost_alerts'],
    page: '/menu-margins',
  },
  // Phase 8a (migration 316): a dish's declared allergens against what its recipes suggest, worked out on asking and
  // kept so a decision holds; accepted or dismissed on the Recipes page's Allergens tab.
  {
    key: 'recipes.allergen_checks', label: 'Allergen check', plural: 'Allergen checks', words: ['allergen check', 'allergen difference', 'declared allergens', 'may contain'],
    table: 'allergen_checks', subjects: ['recipes.allergen_checks'],
    page: '/recipes',
  },
  // Phase 8b (migration 318): a dish's declared calories against one serving of its recipe, kept so a decision holds;
  // accepted (the figure into the menu's draft) or dismissed on the Recipes page's Allergens tab.
  {
    key: 'recipes.calorie_checks', label: 'Calorie check', plural: 'Calorie checks', words: ['calorie check', 'calories', 'kcal', 'energy'],
    table: 'calorie_checks', subjects: ['recipes.calorie_checks'],
    page: '/recipes',
  },
]

export const notObjects = {
  'What a recipe costs at each venue, worked out from its lines and the supplier prices each time: a figure, never kept or changed by hand.': ['recipes.costs'],
  'Whether each dish sold can be costed, worked out from the sales and the recipes each time (coverage by sales): a figure, never kept.': ['recipes.coverage'],
  'Each dish\'s menu engineering class (star, plough-horse, puzzle, dog), worked out from what sold each time: a figure, never kept.': ['recipes.engineering'],
}
