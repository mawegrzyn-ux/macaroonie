// src/forms/recipes.js: the Recipes area's plain forms (src/forms/plain.js
// says what a definition holds), drawn from the route's own schema
// (inventory phase 3).

import { RecipeNewBody } from '../routes/recipes.js'

export const forms = {
  recipe: {
    schema: RecipeNewBody,
    save: { method: 'POST', path: '/recipes' },
    saved: 'Made the recipe {name}',
    fields: {
      name:      { label: 'Name', help: 'As the kitchen calls it.', examples: ['Burger sauce', 'Classic burger'] },
      kind:      { label: 'Kind', help: 'A dish is served and costed per portion; a prep recipe is a batch used inside others.', choices: { dish: 'Dish (costed per portion)', prep: 'Prep (a batch: a sauce, a dough)' } },
      portions:  { label: 'Portions it makes', help: 'Its cost is per portion.', when: { kind: 'dish' } },
      yield_qty: { label: 'It makes', help: 'How much one batch makes, before what cooking loses.', when: { kind: 'prep' } },
      yield_unit: { label: 'Made in', help: 'g, kg, ml, cl, l, each or portion.', examples: ['l', 'kg', 'portion'], when: { kind: 'prep' } },
      loss_pct:  { label: 'Lost in cooking (%)', help: 'A stock that reduces by a quarter: 25.', when: { kind: 'prep' } },
      category:  { label: 'Category', examples: ['Sauces', 'Mains'] },
      code:      { label: 'Code', help: 'Your own, optional.' },
      shelf_life_hours: { label: 'Keeps for (hours)', help: 'Once made, optional.' },
      method:    { label: 'Method', kind: 'textarea' },
      notes:     { label: 'Notes', kind: 'textarea' },
    },
    leave: {
      status: 'A new recipe starts as a draft: it is made live on its page',
      photo_url: 'A photo comes from the media library, on the recipe\'s page',
      variant_of: 'Whether it is a variation of another recipe: set on the recipe\'s page',
      is_active: 'A new recipe is in use',
      lines: 'What goes into it: added on the recipe\'s page (or by Pepper\'s make_recipe)',
    },
  },
}
