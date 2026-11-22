# Outstanding: ordering

What is not built, known limits and follow-ups in this area (`docs/claude/areas/ordering.md`). Item numbers are the old CLAUDE.md numbering, kept so earlier references still work; a new item takes the next number after the highest in any file of this folder. Check the live code before calling anything here pending.

**14. Web ordering — follow-ups**
- Stripe is built (migration 215, see item 36 for its follow-ups). Booking deposits moved onto the group's connected account with migration 220.
- Cash Recon feed: online sales are only in the Online orders report; nothing is written into the day's takings yet.
- Order emails use built-in templates (not editable on the Emails page yet).
- Delivery (zones, fees), table QR ordering: not started.
- Promotions next steps (with customer logins / loyalty): per-customer limits, single-use unique codes, first-order-only, fulfilment/channel scope. A meal deal part picks the dearest matching dish greedily in part order, so overlapping parts (the same section in two parts) may not find the best split. The Promo block's canvas preview shows the heading placeholder in the builder's faded style when the heading is blank. `orders.channel` / `fulfilment` already allow them.
- Printing is browser print (80mm ticket); direct Epson kitchen printing comes with the POS printer layer.

**36. Stripe — follow-ups** *(shipped with migration 215)*
- Tested only against a stand-in Stripe (`api/test/support/fake-stripe-connect.mjs`) and a stand-in Stripe.js in the browser; not yet against Stripe's test mode. First real use: put the platform's test keys on the Platform page, add the Connect webhook (address on the Payments tab, events `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `account.updated`, `account.application.deauthorized`, "Listen to events on connected accounts"), connect a test group, order with 4242 4242 4242 4242 and a 3-D Secure card (4000 0025 0000 3155), refund it, then check the fee in the platform dashboard.
- Standard accounts only (the group manages its account in Stripe's own dashboard); no Express or Custom accounts, no payouts screen in the admin.
- The group's site addresses are registered as payment method domains on its account, but whether Apple Pay then shows on Safari hasn't been checked (Stripe's docs weren't reachable from the build environment). If Stripe reports the domain as not verified for Apple Pay, the site may need to serve `/.well-known/apple-developer-merchantid-domain-association` (not built).
- No platform fee on card machine sales (the Terminal PaymentIntents carry none); the online fee is `tenants.ordering_fee_percent`.
- A group's own Stripe key on a card account still works alongside (the old way); nothing moves an existing key account onto the connected account.
- Booking deposits (migration 220) are on Connect and tested only against the stand-in Stripe: in the same test-mode run, book a deposit venue in the widget with 4242 4242 4242 4242 and with the 3-D Secure card, cancel one from the manage link inside and one outside the refund hours, refund one from the booking drawer in two parts, and close the tab after paying once (the webhook must book it).
- Deposits: no deposit for staff bookings, no deposit taken later (a "pay your deposit" link), no hold on the card instead of a charge (pre-authorisation), no deposit by party size bands or by sitting, no deposit through Pepper's guest chat or MCP (they send the guest to the widget). No-show charging isn't built.
- Backlog parked by the user (30 Oct 2026, "park the rest in the backlog"): a platform fee on card machine sales; the Apple Pay domain association file; Express / Custom accounts and a payouts screen; the real Stripe test-mode run above.
