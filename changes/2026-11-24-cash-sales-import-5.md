# Sales from other tills, phase 5: Square

- **Connect a Square account** on Money > Integrations: tap Connect a till and choose Square. Paste an access token from Square's Developer Dashboard (Production for live sales, Sandbox for a test account), or, where the server is set up for it, tap Sign in with Square and allow Macaroonie to read your items and orders.
- **Link a venue to a Square location** with its trading day start; its last 13 months of orders come in the background, then new orders within a minute or two (Square's webhook, signed) and every 15 minutes anyway.
- **Every order kept as Square recorded it**: items as the variation sold (Regular, Large) under their item, modifiers under their item, discounts, taxes, service charges, tips and payments, in pence exactly. Returns are kept as refunds linked to the order they return; cancelled orders are kept and marked. Customers are kept as Square's customer id only: no names, emails, phone numbers or card numbers.
- **Item mapping works for Square**: each item with its variations and the modifier lists, so a variation can be mapped to a dish (or a dish and its options), with the suggestions, Pepper's proposals and Create missing dishes as for Loyverse.
- **Reports, Today and Pepper** show Square's sales with Till = Square. Cash Recon's Fill from the till stays Loyverse only for now.
- **Webhook signature key**: after Sign in with Square, add the webhook address shown in Square's dashboard and paste its signature key on the connection.
- Owners: Sign in with Square needs an app on Square's Developer Dashboard and the server settings `SQUARE_APPLICATION_ID` and `SQUARE_APPLICATION_SECRET` (redirect URL `https://office.<domain>/api/square/oauth/callback`). Without them, paste a token.
- Migration 294.
