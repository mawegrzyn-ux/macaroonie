// src/areas/recipes.js
//
// The recipes area's route plugins (docs/claude/areas/recipes.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import recipeRoutes from '../routes/recipes.js'

export const routes = [
  // Recipes and prep recipes, costed by shared/costing.js (inventory phase 1, migration 300)
  [recipeRoutes, { prefix: '/api/recipes' }],
]
