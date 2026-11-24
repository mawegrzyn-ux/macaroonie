# Rules can be changed and undone, Pepper counts stock, barcodes and own fields in imports

- **Rules: Change.** Each rule in Settings under Rules has a Change button: its name, venue, the numbers and words it checks, the text of its action and how many times a day it may run, with its own Save. It is checked as a new rule is, keeps its runs and still runs as the person who made it.
- **Pepper changes, switches and deletes rules** by their names (change_rule shows the rule before and after; delete needs the typed word). **Undo** on a rule Pepper just made deletes it, or switches it off if it has already run (and says so).
- **No order totals for people who can't see prices.** A rule's notice with an order's total in it reads "(amount not shown)" for people without View on Purchasing setup.
- **Stock by chat.** "How much rice have we got?", "what's low at Ware?" (below the venue's par) and "we've got 3 kg of rice" (a stock count, on a card). The Stock tab marks items below par.
- **Barcodes**: Pepper reads and sets a supplier price's barcode; the inventory import and Update the price list take a Barcode (GTIN, EAN, UPC) column, and a wrong barcode is listed with its row while the rest of the row goes in.
- **Your own fields**: drawn on the Inventory page's New item (needed ones must be filled), and filled by the inventory and customer CSV imports from a column headed with the field's name (never needed on an import: the result counts new rows without it). Pepper knows your fields' names from the start of a chat.
- Fixed: the Customers page's CSV import sent its rows under a name the API didn't read.
- No migration.
