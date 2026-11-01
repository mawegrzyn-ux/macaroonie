-- 232_pin_open_order_lines.sql
--
-- Purchasing (1 Nov 2026): a line on an open order (a draft, or waiting for
-- approval) with a quantity stays on the supplier price it was filled in on
-- (supply_order_lines.quote_id). Lines saved before this didn't name one and
-- followed the item's usual price instead, so switching a price off moved
-- them to another supplier's, keeping the number of packs whatever the pack
-- size. Pin each such line to the price it shows now: the venue's choice,
-- else the company's, else the cheapest per base unit at the venue's price
-- (chooseQuote() in shared/procurement.js), among active prices of active
-- suppliers. Lines with no price at all stay unpinned.

UPDATE supply_order_lines sl
   SET quote_id = pick.quote_id
  FROM (
    SELECT DISTINCT ON (l.order_id, l.item_id) l.order_id, l.item_id, q.id AS quote_id
      FROM supply_order_lines l
      JOIN supply_orders o ON o.id = l.order_id AND o.tenant_id = l.tenant_id AND o.status IN ('draft', 'requested')
      JOIN inv_quotes q ON q.item_id = l.item_id AND q.tenant_id = l.tenant_id AND q.is_active AND q.pack_base_qty > 0
      JOIN suppliers s ON s.id = q.supplier_id AND s.tenant_id = l.tenant_id AND s.is_active
      LEFT JOIN inv_preferred pv ON pv.item_id = l.item_id AND pv.tenant_id = l.tenant_id AND pv.venue_id = o.venue_id
      LEFT JOIN inv_preferred pd ON pd.item_id = l.item_id AND pd.tenant_id = l.tenant_id AND pd.venue_id IS NULL
      LEFT JOIN inv_quote_venue_prices vp ON vp.quote_id = q.id AND vp.venue_id = o.venue_id AND vp.tenant_id = l.tenant_id
     WHERE l.quote_id IS NULL AND l.qty > 0
     ORDER BY l.order_id, l.item_id,
              (q.id = pv.quote_id) DESC NULLS LAST,
              (q.id = pd.quote_id) DESC NULLS LAST,
              COALESCE(vp.price, q.price) / q.pack_base_qty,
              q.id
  ) pick
 WHERE sl.order_id = pick.order_id AND sl.item_id = pick.item_id AND sl.quote_id IS NULL;
