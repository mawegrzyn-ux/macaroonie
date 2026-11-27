-- 304_recipes_reader.sql
--
-- Inventory phase 3 (docs/INVENTORY.md 5.6, 27 Nov 2026): recipes read in by
-- Pepper. recipes.source says who wrote a recipe's lines when it was not a
-- person on the Recipes page:
--
--   reader   read in from a file or pasted text (the Recipes page's Read
--            recipes, or Pepper's read_recipes in the chat)
--   pepper   made by Pepper from a description in the chat (make_recipe)
--   null     made on the Recipes page (or copied, or a goods dish's recipe)
--
-- A recipe Pepper wrote starts as a draft, and a draft with a source is not
-- costed as if it were finished: shared/costing.js recipeCost() adds the gap
-- "still a draft" to it (so it and every dish linked to it show as partly
-- costed) until a person checks it and makes it live. A draft a person made
-- (a variation, a copy) is costed as it is, as before. Kept once the recipe
-- is live, so the list can say where it came from.

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS source text CHECK (source IS NULL OR source IN ('reader', 'pepper'));
