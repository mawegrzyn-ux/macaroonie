# Outstanding: cash

What is not built, known limits and follow-ups in this area (`docs/claude/areas/cash.md`). Item numbers are the old CLAUDE.md numbering, kept so earlier references still work; a new item takes the next number after the highest in any file of this folder. Check the live code before calling anything here pending.

**2. GloriaFood sales integration** *(shipped with migration 159: Cash Recon fill + orders board; follow-ups in item 20)*

**12. Desktop Wages — submitted-report lock** *(resolved by migration 137: wages are no longer submitted, and every wages surface uses `WeekWagesEditor`)*

**17. Loyverse — follow-ups** *(shipped with migration 154)*
- Built from the Loyverse API v1.0 shape and tested only against a stand-in server (the docs and API hosts weren't reachable from the build environment). First real use: compare a fill with the Loyverse Back Office sales summary for the same day and store, especially refunds, taxes added on top of prices (not included), and `surcharge` (assumed field name).
- Filling is on demand only: no nightly automatic fill, no webhook.
- Expenses, wages and the day note aren't filled; Loyverse pay-ins/pay-outs (shifts) aren't read.
- Dining option (eat in / takeaway / delivery) isn't offered as a figure; map delivery platforms by payment type.
- One store per venue; a venue with two Loyverse stores can't sum both.
- The AI assistant has no Loyverse tool.
- The dashboard import widget (migration 212) only opens the fill window: there is still no automatic or scheduled fill, and it fills one source at a time (no "fill both").

**20. GloriaFood — follow-ups** *(shipped with migration 159)*
- Built from GloriaFood's Accepted Orders API v2 README and its two sample orders (the docs repo was readable; their website wasn't) and tested only against a stand-in server. First real use: check that the "Push Accepted Order" integration accepts our address (or use the poll key), then compare a day's orders, payments and fulfil times with GloriaFood's own order list.
- No history from the API: earlier days come from importing GloriaFood's order export (migration 162). The import assumes the export's Order ID is the id the API sends (not checked against a live restaurant); if not, the `after_live` cutoff still stops overlaps, except for orders a poll venue's queue holds from before the import. The export has no dishes or discounts (Items before discounts / Discounts are £0 on imported days), and a payment option named in GloriaFood (e.g. "Card (G-Pay / via Browser)") is stored as the export spells it, which may differ from the code the API sends for the same option.
- An order paid two ways counts under its main `payment`; GloriaFood doesn't send the split amounts.
- Polling needs Redis (the BullMQ repeat job); with Redis down only Check for orders now, and the preview's own poll, collect orders. A pop whose orders fail to store is lost except for the API log entry.
- Board moves (and the kitchen screens' ready / collected, migration 178) are ours only; nothing is sent back to GloriaFood (no ready time, no status). GloriaFood orders aren't in the Online orders Report tab (they are in its Transactions tab), aren't linked to Customers, and the AI assistant has no GloriaFood tool.
- No GloriaFood menu sync (the Fetch Menu API exists).

**47. Sales from other tills: Loyverse checks, master data and an item mapping tool; Square and Simphony later (plan, the user, 22 Nov 2026; parked the same day)**
- The ask: import every Loyverse check with all its details and the master data, not just Cash Recon figures, with a smart, flexible tool for mapping Loyverse items (variant combinations, modifiers) to Macaroonie menus; plan for Square and Oracle Simphony too. Plan: `docs/SALES_IMPORT.md` (connectors, a raw store, normalised `ext_*` sales in pence as the other till recorded them, rules-based mapping with smart suggestions, "every till" report subjects, phases). Decisions D1 to D6 answered 24 Nov 2026 (all as recommended: own tables, Macaroonie the menu master, customer ids only, 13 months back, webhooks plus a 15-minute catch-up, an Integrations section); see the plan's section 10.
- **Phase 1 built (24 Nov 2026, migrations 288 to 291)**: `pos_connections` / `pos_connection_venues` (renamed from the Loyverse tables), the Loyverse connector, `ext_documents`, the normalised `ext_*` sales and `ext_catalog`, the `sales-sync` job (webhook, 15-minute catch-up, resumable 13-month history), the Integrations page. Left: phase 2 (mapping rules, the mapping page, coverage, preview), 3 (smart suggestions, Pepper, learning, Create missing dishes), 4 ("every till" report subjects, Cash Recon filled from `ext_checks` instead of reading `/receipts` live, Today and Pepper), 5 (Square), 6 (Simphony).
- Not tried against a real Loyverse account. Loyverse's documentation site (developer.loyverse.com) couldn't be reached from the build session, so `updated_at_min` / `created_at_min` on `/receipts`, `updated_at_min` and `show_deleted` on `/items` and `/modifiers`, `/dining_options` (a 404 is skipped), the variant fields (`variant_id`, `option1_value`..., `default_price`, `stores[]`), `line_modifiers[].money_amount`, the receipt-level `tip` / `surcharge`, and `POST /webhooks` with `{ url, type: 'receipts.update', status: 'ENABLED' }` are as remembered. Check each against the docs and a live account first; if Loyverse only allows webhooks for OAuth apps, connecting shows the address and the 15-minute catch-up carries the load.
- Loyverse webhooks may be signed (an OAuth app's client secret); we have no app, so the address's random token is the only check and the body is never read (it only asks for a sync).
- Rate limits: requests are paced (300 ms apart) and a 429 waits and retries five times; Loyverse's actual limit is not confirmed. A big account's history takes several runs of 4 minutes, each queued straight after the last.
- Refund receipts' amounts are kept as Loyverse signs them (positive in the stand-in); readers in phase 4 must take the sign from `kind`. An item line's money includes its modifiers' (modifier lines are "of which"): add up item lines only.
- A venue's history import is a fixed window (13 months to the moment of linking); the catch-up reads every store by updated time, so receipts of a store linked to no venue are kept raw only and normalised when the store is linked (its history import reads them again).
- Platform status shows the `sales-sync` job (late when it hasn't run); each connection's own lateness (no good sync for 50 minutes) is on the Integrations page only, not on the Platform page.
- Erasure: no customer personal data is taken, so the anonymise path needs nothing yet; receipt line notes are kept as typed on the till.
- Disconnecting a connection deletes its stored sales (cascade); there is no archive.
- Integrations is in the Money section of the menu (a new menu section would mean changing the shell area's `shared/nav/sections.js`).

