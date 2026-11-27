// src/areas/recipes.js
//
// The recipes area's route plugins (docs/claude/areas/recipes.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import recipeRoutes from '../routes/recipes.js'
import recipeLinkRoutes from '../routes/recipeLinks.js'
import recipeOptionRoutes from '../routes/recipeOptions.js'
import menuMarginRoutes from '../routes/menuMargins.js'
import recipeReadRoutes from '../routes/recipeRead.js'

export const routes = [
  // Recipes and prep recipes, costed by shared/costing.js (inventory phase 1, migration 300)
  [recipeRoutes, { prefix: '/api/recipes' }],
  // Menu dishes linked to recipes: the variation matrix (inventory phase 2, migration 302)
  [recipeLinkRoutes, { prefix: '/api/recipe-links' }],
  // What options do to a dish's recipe (phase 2, migration 302)
  [recipeOptionRoutes, { prefix: '/api/recipe-options' }],
  // Menu margins and the cost % targets (phase 2, migration 302)
  [menuMarginRoutes, { prefix: '/api/menu-margins' }],
  // Pepper reads recipes and suggests typical yields, under /api/ai for its proxy timeout (phase 3)
  [recipeReadRoutes, { prefix: '/api/ai/recipes' }],
]
