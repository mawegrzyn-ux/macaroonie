# Recipes

Covers: recipes and prep recipes, the cost engine (`shared/costing.js`), item units and yield as costing reads them, the Recipes page, the recipes and costing modules; later the links to dishes, menu margins and scenarios (`docs/INVENTORY.md`).

Key files and mistakes to avoid for this area: read it before changing code here. What shipped and when is in `docs/claude/history/recipes.md`; the index of all areas is in `CLAUDE.md`. The plan is `docs/INVENTORY.md` (phases 1 to 3 and 7 are this area's; stock is phases 4 to 6).

## Key files

Under **API**, `src/...` means `api/src/...`; under **Admin portal**, `src/...` means `admin/src/...`. Other paths are from the repo root.

## Mistakes to avoid

> Append-only: never delete an entry, only correct one that turns out to be wrong. New entries go at the end.
