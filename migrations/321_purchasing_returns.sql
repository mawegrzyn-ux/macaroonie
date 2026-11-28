-- 321_purchasing_returns.sql
--
-- Inventory phase 9b (27 Nov 2026; docs/INVENTORY.md 6.4 and 11): returns to
-- the supplier and their credit notes. A return is made against a delivery
-- that was booked in (a purchase order received, with or without an order):
-- its lines are lines of that delivery, each with how many packs go back, a
-- reason (damaged, wrong item, short dated, quality, other) and the credit
-- expected for them (packs x the price paid: the invoice's, else the price
-- ordered at, before VAT). Receiving's own line statuses (short, damaged,
-- missing) stay as they are; a damaged line can start a return prefilled.
--
-- The stock goes out of the venue when the return is made (returned_at, now
-- or up to 14 days back, never before the delivery was booked in): each line
-- is a 'return' move on the ledger (MOVE_SOURCES in
-- api/src/services/stockSvc.js), so on hand and variance's returns term read
-- the same moves (shared/variance.js itemVariance()). A cancelled return
-- moves nothing (the goods never went); a refused one keeps its move (they
-- went back, no credit came).
--
--   open       made: the stock has gone out, the supplier not told yet
--   sent       emailed to the supplier (a PDF, like a purchase order) or
--              marked sent (handed to the driver, phoned, on their website)
--   credited   their credit note came: its number, and the amount on it
--   refused    the supplier won't credit it (a note says why)
--   cancelled  not returned after all: the stock is back as it was
--
-- Starting a return is Purchasing Use (the module gains a Use level in this
-- phase); sending, marking sent, the credit note, refused and cancelling a
-- sent one are Purchasing approval Manage. Money (the credit expected, the
-- prices, the amount credited) shows only with purchasing prices
-- (seesPurchasingPrices()).
--
-- number: the group's own running number (RT-00012), as purchase orders have.

CREATE TABLE purchase_returns (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number              int           NOT NULL CHECK (number > 0),
  venue_id            uuid          NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  po_id               uuid          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  supplier_id         uuid          NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status              text          NOT NULL DEFAULT 'open'
                                    CHECK (status IN ('open', 'sent', 'credited', 'refused', 'cancelled')),
  -- A note for the supplier, printed on the return.
  note                text          CHECK (note IS NULL OR length(note) <= 500),
  -- When the goods went out (the stock move's moment).
  returned_at         timestamptz   NOT NULL DEFAULT now(),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  created_by          text,
  -- The credit expected: the lines' amounts before VAT, and the VAT on them.
  credit_expected     numeric(12,2) NOT NULL DEFAULT 0 CHECK (credit_expected >= 0),
  credit_vat          numeric(12,2) NOT NULL DEFAULT 0 CHECK (credit_vat >= 0),
  sent_at             timestamptz,
  sent_by             text,
  sent_via            text          CHECK (sent_via IS NULL OR sent_via IN ('email', 'driver', 'phone', 'website', 'print', 'other')),
  sent_to             text,
  send_error          text,
  -- The supplier's credit note: its number and date, and the amount on it before VAT
  -- (null when the person recording it can't see purchasing prices).
  credit_note_number  text          CHECK (credit_note_number IS NULL OR length(credit_note_number) BETWEEN 1 AND 100),
  credit_note_date    date,
  credit_amount       numeric(12,2) CHECK (credit_amount IS NULL OR credit_amount >= 0),
  credited_at         timestamptz,
  credited_by         text,
  refused_at          timestamptz,
  refused_by          text,
  refuse_note         text          CHECK (refuse_note IS NULL OR length(refuse_note) <= 500),
  cancelled_at        timestamptz,
  cancelled_by        text,
  cancel_note         text          CHECK (cancel_note IS NULL OR length(cancel_note) <= 500),
  -- Every step after it was made: [{ action, by, at, note }].
  history             jsonb         NOT NULL DEFAULT '[]'::jsonb,
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number),
  CHECK (status <> 'credited' OR credit_note_number IS NOT NULL)
);
CREATE INDEX purchase_returns_po ON purchase_returns (tenant_id, po_id);
CREATE INDEX purchase_returns_venue ON purchase_returns (tenant_id, venue_id, status, returned_at DESC);

ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_returns FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_returns_tenant ON purchase_returns
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- A line: one line of the delivery, the packs going back (of that line's own
-- pack, never today's price's), the same in the item's base unit, the price
-- paid per pack before VAT and its VAT rate (copied from the delivery line:
-- the invoice's where one was read), the credit expected for it, the reason
-- and a note. The item's name, the supplier's product name and code and the
-- pack are copied as the supplier's document prints them.
CREATE TABLE purchase_return_lines (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  return_id        uuid          NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  po_line_id       uuid          NOT NULL REFERENCES purchase_order_lines(id) ON DELETE CASCADE,
  item_id          uuid          REFERENCES inv_items(id) ON DELETE SET NULL,
  item_name        text          NOT NULL,
  product_name     text,
  supplier_code    text,
  pack_label       text          NOT NULL,
  base_unit        text          NOT NULL,
  pack_base_qty    numeric(16,4) NOT NULL CHECK (pack_base_qty > 0),
  qty              numeric(10,3) NOT NULL CHECK (qty > 0),
  qty_base         numeric(16,4) NOT NULL CHECK (qty_base > 0),
  price            numeric(12,4) NOT NULL CHECK (price >= 0),
  vat_rate         numeric(5,2)  NOT NULL DEFAULT 0,
  credit_expected  numeric(12,2) NOT NULL DEFAULT 0 CHECK (credit_expected >= 0),
  reason           text          NOT NULL CHECK (reason IN ('damaged', 'wrong_item', 'short_dated', 'quality', 'other')),
  note             text          CHECK (note IS NULL OR length(note) <= 500),
  sort_order       int           NOT NULL DEFAULT 0,
  UNIQUE (return_id, po_line_id)
);
CREATE INDEX purchase_return_lines_return ON purchase_return_lines (return_id, sort_order);
CREATE INDEX purchase_return_lines_po_line ON purchase_return_lines (tenant_id, po_line_id);
CREATE INDEX purchase_return_lines_item ON purchase_return_lines (tenant_id, item_id);

ALTER TABLE purchase_return_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_return_lines_tenant ON purchase_return_lines
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
