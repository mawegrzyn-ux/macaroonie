# Stock

Covers: stock on hand and the ledger (`shared/stock.js`, `loadStockMoves()`), storage areas, stocktakes (full and key-item counts, drafts, approval, blind counts), adjustments, the Stock page and the phone's count page, the stock module; waste and transfers next (`docs/INVENTORY.md` phases 4 to 6).

Key files and mistakes to avoid for this area: read it before changing code here. What shipped and when is in `docs/claude/history/stock.md`; the index of all areas is in `CLAUDE.md`. The plan is `docs/INVENTORY.md` (phases 4 to 6 are this area's).

## Key files

## Mistakes to avoid

> Append-only: never delete an entry, only correct one that turns out to be wrong. New entries go at the end.
