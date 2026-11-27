# Outstanding: recipes

What is not built, known limits and follow-ups in this area (`docs/claude/areas/recipes.md`). A new item takes the next number after the highest in any file of this folder. Check the live code before calling anything here pending. The phases still to build are in `docs/INVENTORY.md` section 11.

**69. Recipes: what phase 1 left for later** *(phase 1 shipped 27 Nov 2026, migrations 298 to 301)*
- No link from a recipe to what is sold yet: dishes, options, meal deals and goods have no recipe, so nothing shows a margin and stock is not taken off by sales. Phase 2 builds the links, and with them the owner's variation matrix: which recipe (or variation) a dish uses at each venue and for each revenue stream or order type (eat in, takeaway, delivery). Phase 1 only groups variations (`recipes.variant_of`) so they are made and costed side by side.
- `margin()` is built and tested but nothing calls it until phase 2 (menu margins with the order type switch).
- Pepper can read recipes (`find_recipes`, `recipe`) but not change them: change tools (with Activity words in `shared/pepperActions.js` and a place in the registry) and the recipe reader come with phase 3.
- A unit a line uses is free text: a line can name a unit nobody has defined (it shows as a gap), and the editor's unit list offers only the units the item knows. There is no bulk "give these items a size" screen.
- The inventory import and price update don't read yield or units, and the item import doesn't set them; they are typed in the item's drawer.
- Last paid and average paid read received purchase order lines only; they don't follow stock moves, transfers or credit notes (phase 4 onwards), and the average is over a fixed 90 days.
- The Recipe costs report subject costs at standard prices only, today's; there is no history of what a recipe cost on a past day (D9: open days are recomputed, closed periods never change, comes with periods in phase 6).
- No cost target or colour threshold yet (the `costing` module's Manage level is for them, phase 2 / 7).
- Recipe photos come from the media library through `PicturePick`, which needs the person to be able to upload to Media: a cook with Recipes manage but no media access sees the upload refused.
- No allergens, calories or labels from recipes (phase 8), and `shelf_life_hours` is kept but nothing prints a label with it.
- Recipes are per group: nothing passes recipes from a franchisor to its franchisees (phase 10).
