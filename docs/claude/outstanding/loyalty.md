# Outstanding: loyalty

What is not built, known limits and follow-ups in this area (`docs/claude/areas/loyalty.md`). Item numbers are the old CLAUDE.md numbering, kept so earlier references still work; a new item takes the next number after the highest in any file of this folder. Check the live code before calling anything here pending.

**34. Loyalty — follow-ups** *(shipped with migration 211)*
- The Macaroonie-wide (network) programme is data model only: the `network` programme row, `loyalty_identities` and the feature switch exist, nothing earns, spends or shows across tenants yet.
- Wallet cards are tested only against stand-in Apple and Google servers; not yet with a real Pass Type ID, a real Google issuer or a phone. First real use: add a pass on an iPhone and a card on Android, then check the balance updates within a minute of a sale.
- Rewards need the internet: the venue hub (offline) refuses loyalty discounts, and a till or kiosk can't look a member up offline.
- No points for bookings, reviews or referrals; no tiers; no birthday rewards; no marketing emails to members (the newsletter consent is recorded only).
- Staff search by email needs the whole address (matched by its hash); there is no partial email search.
- GloriaFood, Loyverse and Deliveroo orders don't earn.
- The kiosk and till QR scanners use `BarcodeDetector` where the browser has it (Chrome on Android); elsewhere a USB / Bluetooth scanner typing into the box. Not tried on real kiosk hardware.
- Sign-in codes come from the venue's email settings (the booking widget's venue first); a group with no email set up uses the platform's sender.
