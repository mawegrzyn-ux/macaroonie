# Outstanding: recipes

What is not built, known limits and follow-ups in this area (`docs/claude/areas/recipes.md`). A new item takes the next number after the highest in any file of this folder. Check the live code before calling anything here pending. The phases still to build are in `docs/INVENTORY.md` section 11.

**69. Recipes: what phase 1 left for later** *(phase 1 shipped 27 Nov 2026, migrations 298 to 301)*
- Built in phase 2 (27 Nov 2026): the links from dishes, options, meal deals and goods to recipes with the variation matrix, `margin()` in use on Menu margins, and the cost targets. Stock is still not taken off by sales (phase 5).
- Pepper can read recipes (`find_recipes`, `recipe`) but not change them: change tools (with Activity words in `shared/pepperActions.js` and a place in the registry) and the recipe reader come with phase 3.
- A unit a line uses is free text: a line can name a unit nobody has defined (it shows as a gap), and the editor's unit list offers only the units the item knows. There is no bulk "give these items a size" screen.
- The inventory import and price update don't read yield or units, and the item import doesn't set them; they are typed in the item's drawer.
- Last paid and average paid read received purchase order lines only; they don't follow stock moves, transfers or credit notes (phase 4 onwards), and the average is over a fixed 90 days.
- The Recipe costs report subject costs at standard prices only, today's; there is no history of what a recipe cost on a past day (D9: open days are recomputed, closed periods never change, comes with periods in phase 6).
- Recipe photos come from the media library through `PicturePick`, which needs the person to be able to upload to Media: a cook with Recipes manage but no media access sees the upload refused.
- No allergens, calories or labels from recipes (phase 8), and `shelf_life_hours` is kept but nothing prints a label with it.
- Recipes are per group: nothing passes recipes from a franchisor to its franchisees (phase 10).
- Pepper's link to a recipe searches the Recipes page by its name (`?q=`) instead of opening the recipe: two recipes whose names contain the same words both show. Opening one straight from a name needs a link the page resolves by name.
- After an item's base unit changes, deliveries booked in under the old unit are left out of Last paid and Average paid; the gap then says nothing was booked in. It doesn't say the old deliveries were in another unit.
- This phase made the pepper area's `api/src/ai/tools/util.js` public in `areas.json` (every area's Pepper tool file uses it; four baseline crossings went with it). It is another area's public surface: name it in the pull request's title.

**70. Recipes: what phase 2 left for later** *(phase 2 shipped 27 Nov 2026, migrations 302 and 303)*
- A meal deal's cost is its picks' sum on a sale, but on Menu margins and in reports it is a range (least and most); the typical cost from what guests actually pick waits for usage from sales (phase 5: `dishCost()` returns `typical: null` as the hook). Deals are banded at their highest cost %, each end of the range over what its own picks sell for (`dealRange()`, review fix 27 Nov 2026); a picked dish's own options that cost extra in the deal are in neither the cost nor the price of the range.
- Costs in the matrix, on Menu margins and in the Dish margins report are at standard prices only (no Last paid or Average paid switch there).
- An option rule adds one line: an option that adds two things (a "loaded" topping) needs a prep recipe holding both. Nested options (an option's child group) are costed by their own option ids only. A dish's one-off option is keyed by its label: renaming it loses its rule (the option then shows Needs a rule again).
- Rules for a library option that is deleted stay in `recipe_option_rules` unused (the option id is plain); the nightly sweep cleans links and dish rules, not those. A section's own cost target for a deleted section stays in `costing_settings.sections` until the targets are saved again.
- A goods dish's recipe is one each of its stock item: an item kept in grams with no size for each shows as a gap until it has one.
- Menu margins leave out order type charges (packaging, service), discounts and promotions; the margin is the menu price net of VAT against the dish cost. Targets are per group and per menu section, not per dish.
- The Dish margins report has a row for every live dish at each venue and active order type (no revenue stream): fine at today's sizes, heavier for many venues and big menus (one cost context per venue).
- Pepper can read links and margins (`dish_cost`, `menu_margins`) but not change them: `link_recipes` comes with phase 3. The recipe editor's Link a dish links for every venue only; other cells are set from the dish's matrix.
- No "Make a recipe for this dish" from the menu editor, no Today task or dashboard widget for dishes over target, no rule trigger on cost % yet (phase 7, `docs/INVENTORY.md` 8.2 and 10.3).
- The matrix lists active venues, streams and order types (and inactive ones a link names); a dish on a menu for one venue still shows every venue's row, marked "not on its menus".
- Dishes are costed from whichever recipe their link names, draft or live: nothing marks a dish costed from a draft (`dishCost()` returns `recipe.status`, the pages don't show it). `docs/INVENTORY.md` 5.6 means the drafts phase 3's reader makes; whether a draft link is a gap is for that phase.
- `dishCost()` takes a meal deal's picks as its own list, a till line's combo parts (`modifiers`) or a basket's selection (`choices`). A stored online order's parts carry option labels, not ids (`priceLine()`): costing past orders (phase 5) needs the option ids kept on the order, or a lookup by label.
- This phase made `api/src/services/dishCostSvc.js` public (menus' duplicate calls `copyRecipeLinks()`), and changed other areas' files: `api/src/routes/menus.js` (menus), the report catalogue, work and starter files and `api/test/reports-catalogue.test.mjs` (reports), `api/test/nav-default.test.mjs` (shell). Name them in the pull request's title.
