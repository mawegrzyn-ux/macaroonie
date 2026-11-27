// shared/nav/recipes.js: the Recipes area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/recipes', label: 'Recipes', icon: 'ChefHat', module: 'recipes',
    section: 'Stock', order: 20, catalogOrder: 165,
    keywords: 'recipes recipe book prep batch sub-recipe ingredients method dish cost plate cost food cost costing portion yield gp margin',
    description: 'What goes into each dish and prep batch, the method and photo, and what each costs at every venue\'s supplier prices, with what is not costed yet.',
  },
]
