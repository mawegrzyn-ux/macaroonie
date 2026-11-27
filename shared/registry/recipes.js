// shared/registry/recipes.js: the Recipes area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'recipes.recipes', label: 'Recipe', plural: 'Recipes', words: ['recipe', 'prep', 'batch', 'sub-recipe'],
    table: 'recipes', subjects: ['recipes.recipes', 'recipes.lines'],
    page: '/recipes',
  },
  // Phase 2: which recipe a menu dish uses where (the variation matrix).
  {
    key: 'recipes.links', label: 'Recipe link', plural: 'Recipe links', words: ['link', 'matrix', 'variation', 'takeaway version'],
    table: 'recipe_links', subjects: ['recipes.links'],
    page: '/recipes',
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
]

export const notObjects = {
  'What a recipe costs at each venue, worked out from its lines and the supplier prices each time: a figure, never kept or changed by hand.': ['recipes.costs'],
  'Whether each dish sold can be costed, worked out from the sales and the recipes each time (coverage by sales): a figure, never kept.': ['recipes.coverage'],
}
