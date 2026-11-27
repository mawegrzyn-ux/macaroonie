# Recipes

Covers: recipes and prep recipes, the cost engine (`shared/costing.js`), item units and yield as costing reads them, the Recipes page, the recipes and costing modules; later the links to dishes, menu margins and scenarios (`docs/INVENTORY.md`).

Key files and mistakes to avoid for this area: read it before changing code here. What shipped and when is in `docs/claude/history/recipes.md`; the index of all areas is in `CLAUDE.md`. The plan is `docs/INVENTORY.md` (phases 1 to 3 and 7 are this area's; stock is phases 4 to 6).

## Key files

Under **API**, `src/...` means `api/src/...`; under **Admin portal**, `src/...` means `admin/src/...`. Other paths are from the repo root.

### Shared

- `shared/costing.js` (inventory phase 1, 27 Nov 2026) — the cost engine, plain ESM: `toBase()` (standard units of the item's kind, then its own units; a unit that doesn't fit is named), `unitChoices()`, `unitNameProblem()`, `yieldOf()`, `asBought()`, `itemCost()` on `BASES` standard | last | average (`AVERAGE_DAYS` 90), `recipeMakes()`, `recipeUnit()`, `inRecipeUnit()`, `recipeUnitChoices()`, `recipeCost()` (lines, gaps with reason / text / fix, coverage full | partial | none, a memo per venue and basis on `ctx._memo`), `explain()` (rows and text; `prices: false` leaves the quote out), `nestingProblem()` (`MAX_DEPTH` 5, `recipe_cycle` / `recipe_depth` with the path), `margin()` (pence meet pounds only here), `pounds()`, `unitWord()` / `perWord()`, `KINDS`, `COVERAGE`, `YIELD_UNITS`. Tests: `shared/test/costing.test.mjs`.
- `shared/nav/recipes.js` (the Recipes page, Stock section after Purchasing), `shared/registry/recipes.js` (`recipes.recipes`; `recipes.costs` is a figure, no object).

### API

- `migrations/298_purchasing_item_units.sql` (purchasing tables: `inv_items.yield_pct`, `recipe_unit`, `count_unit`, `inv_item_units`), `299_recipes_modules.sql` (modules `recipes`, `costing` in group `recipes`; custom roles), `300_recipes_tables.sql` (`recipes`, `recipe_lines`), `301_recipes_menu.sql` (the menu link).
- `src/services/costingSvc.js` — `loadRecipes()`, `loadCostItems()`, `loadReceipts()`, `loadCosting(tx, tenantId, venueId, { basis, recipes })` (the engine's ctx, read once per request), `recipeView()` (money only with `costs`, the explanation with `withExplain`).
- `src/routes/recipes.js` (`/api/recipes`, registered by `src/areas/recipes.js`) — list, `/pickers`, one recipe (`oneView()`: `used_in`, `variations`, `bases`, `explanation`, `unit_choices`), `/preview`, create (`RecipeNew`), the whole save (`RecipeSave`, strict: every field), copy and variation, `/active`, delete; `checkRecipe()` (ids are the group's, prep only inside, variations one level, `nestingProblem()`), `access()` (manage, costs = Costing View, prices = also purchasing prices), `lineRows()` (a unit spelled as the item spells it).
- `src/routes/inventory.js` (purchasing) — units and yield on items: `POST /items/:id/units`, `PATCH /units/:unitId`, `DELETE /units/:unitId`, `checkUsualUnits()`, `loadUnits()`, `recipesUsingUnit()`; an item in a recipe is switched off instead of deleted.
- `src/ai/tools/recipes.js` — Pepper's `find_recipes` and `recipe` (read, through the routes, by name).
- Reports (reports area files): `src/reports/catalogue/recipes.js` (`recipes.recipes`, `recipes.lines`, `recipes.costs`; heading `recipes` in `AREAS`), `src/reports/work/recipes.js` (`RECIPE_WORKS.recipe_costs`), `src/reports/starters/recipes.js`.
- Tests: `api/test/recipes.test.mjs`, fixtures `api/test/support/fixtures/recipes.mjs` (kinds `recipeId`, `unitId`).

### Admin portal

- `src/pages/Recipes.jsx` (`/recipes`, lazy from `src/routes/recipes.jsx`; `?recipe= &venue= &basis=`), `src/components/recipes/RecipeEditor.jsx` (`LinesCard`, `DetailsCard`, `MethodCard`, `CostCard`, `UsedCard`, `NewRecipe`, `AddLine`), `src/components/recipes/shared.jsx` (`saveBody()`, `detailsOf()` / `linesOf()` / `methodOf()`, `CostAt`, `CoverageBadge`, `usePickers()`), `src/components/purchasing/units.jsx` (purchasing: `UnitsCard` in the Inventory page's item drawer).
- Help `src/pages/help/recipes.jsx`, Docs `src/pages/docs/recipes.jsx`.

## Mistakes to avoid

> Append-only: never delete an entry, only correct one that turns out to be wrong. New entries go at the end.

- **A cost is worked out by `shared/costing.js` from `loadCosting()`'s rows, never stored or worked out again** (27 Nov 2026, phase 1) — the Recipes page, the preview, the report subject Recipe costs and Pepper all call `recipeCost()` on the ctx `loadCosting()` reads. A new place that shows a cost (menu margins, a widget, usage from sales) loads the same ctx and calls the same functions; a cost column on a table would go stale the moment a supplier price changes.
- **Yield divides, never multiplies** (phase 1) — what has to be bought is the usable quantity / (yield / 100) (`asBought()`): 1.20 at 80% is 1.50, not 1.44. A line's own `yield_pct` beats the item's (`yieldOf()`); a prep recipe's cooking loss is on the recipe (`loss_pct`), never on its items.
- **A unit a line uses is free text, so a unit the item doesn't know is a gap, not a refusal** — the save keeps it (a reader in phase 3 will bring units nobody has defined yet) and `toBase()` names it ("Cheddar has no size for a tbsp"). What must refuse is the item's side: an own unit a recipe uses can't be deleted (409 `unit_in_use`), a renamed one is written into its recipe lines in the same transaction, and an item's base unit can't change while it has own units or recipe lines. A new way of changing an item's units must keep all three.
- **Costs need Costing View everywhere, and supplier prices inside the explanation also need purchasing prices** — `access()` in `routes/recipes.js` and `recipeView()` decide it for the routes, the catalogue gives every money field `needs: 'costing'` and the cost subject module `costing`, and Pepper reads only through the routes. Coverage and gaps carry no money and show with Recipes View. A new place showing a cost must take the same two levels; never compare `costing` with 'none' by hand (use `permissionAtLeast()`).
- **A recipe save is whole: PUT `/api/recipes/:id` requires every field (`RecipeSave` is strict) and replaces the lines** (rule 13) — the editor's three Saves each send `saveBody(server, parts)`: that card's draft over the stored recipe, so another card's unsaved changes are neither saved nor lost. A new caller (Pepper's change tools later, an import) must send every field it doesn't change too.
- **Nesting is checked across every recipe of the group on each save (`nestingProblem()`), not by the database** — the table only refuses a line naming its own recipe. Any new way of writing `recipe_lines` (an import, Pepper, copying between groups) must load every recipe and call it, or a loop or a chain deeper than five levels gets in; the engine then shows a gap instead of hanging, but the recipe can't be costed.
- **The editor's `SortableRows` items must be a stable array** — `SortableRows` (`components/staff/shared.jsx`) copies `items` into its own state in an effect on `[items]`; building the array inline (`value.map(...)` in the JSX) gives a new array each render, the effect sets state each render, and the page loops. Memoise it (`useMemo(..., [value])`), as `LinesCard` does.
- **A test that looks for money in a JSON answer must look for money keys, not digits** (27 Nov 2026) — `doesNotMatch(JSON.stringify(view), /8\.5|102/)` failed now and then because a random uuid held "102". Match the keys that carry money (`"cost":`, `"per_unit":`, `"price":`, `"explanation":`) instead.
