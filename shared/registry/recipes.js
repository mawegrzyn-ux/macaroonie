// shared/registry/recipes.js: the Recipes area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'recipes.recipes', label: 'Recipe', plural: 'Recipes', words: ['recipe', 'prep', 'batch', 'sub-recipe'],
    table: 'recipes', subjects: ['recipes.recipes', 'recipes.lines'],
    page: '/recipes',
  },
]

export const notObjects = {
  'What a recipe costs at each venue, worked out from its lines and the supplier prices each time: a figure, never kept or changed by hand.': ['recipes.costs'],
}
