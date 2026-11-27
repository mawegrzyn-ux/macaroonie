-- 309_stock_transfers.sql
--
-- Inventory phase 4b (docs/INVENTORY.md 6.4; 27 Nov 2026): stock moved
-- between two venues of the same group, in two steps. Sent: it leaves the
-- sender (Stock use at the sender). Received: it arrives at the receiver
-- (Stock use there), with quantities that can differ from what was sent;
-- what didn't arrive stays on the transfer, at the sender, as lost in
-- transit. A sent transfer can be cancelled (Stock use at the sender): the
-- stock comes back to the sender then. Valued at the sender's average cost
-- (the average paid there over the 90 days before it was sent), kept on
-- each line, so both venues see the same pounds.
--
-- On hand reads each line as moves (shared/stock.js transferLineMoves(),
-- api/src/services/stockSvc.js MOVE_SOURCES): out of the sender when sent;
-- once received, out of the sender what arrived and lost in transit the
-- rest (both when it was sent: it all left then), in at the receiver when
-- it arrived; once cancelled, back at the sender when it was cancelled.

-- number: the group's own running number (Transfer 12), for people to say.
CREATE TABLE stock_transfers (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number         int         NOT NULL CHECK (number > 0),
  from_venue_id  uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  to_venue_id    uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  status         text        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'received', 'cancelled')),
  note           text        CHECK (note IS NULL OR length(note) <= 500),
  sent_at        timestamptz NOT NULL DEFAULT now(),
  sent_by        text,
  received_at    timestamptz,
  received_by    text,
  receive_note   text        CHECK (receive_note IS NULL OR length(receive_note) <= 500),
  cancelled_at   timestamptz,
  cancelled_by   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (from_venue_id <> to_venue_id)
);
CREATE UNIQUE INDEX stock_transfers_number ON stock_transfers (tenant_id, number);
CREATE INDEX stock_transfers_from ON stock_transfers (tenant_id, from_venue_id, sent_at DESC);
CREATE INDEX stock_transfers_to ON stock_transfers (tenant_id, to_venue_id, status);

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_transfers_tenant ON stock_transfers
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');

-- A line: one item, sent as typed (qty, unit) and in its base unit
-- (qty_base); what arrived as typed and in its base unit once received
-- (null until then; 0 when none of it came); the sender's cost per base
-- unit when it was sent (null with nothing paid there yet).
CREATE TABLE stock_transfer_lines (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transfer_id     uuid          NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  item_id         uuid          NOT NULL REFERENCES inv_items(id) ON DELETE CASCADE,
  sort_order      int           NOT NULL DEFAULT 0,
  qty             numeric(16,4) NOT NULL CHECK (qty > 0),
  unit            text          NOT NULL CHECK (length(unit) BETWEEN 1 AND 80),
  qty_base        numeric(16,4) NOT NULL CHECK (qty_base > 0),
  received_qty    numeric(16,4) CHECK (received_qty IS NULL OR received_qty >= 0),
  received_unit   text          CHECK (received_unit IS NULL OR length(received_unit) BETWEEN 1 AND 80),
  received_base   numeric(16,4) CHECK (received_base IS NULL OR received_base >= 0),
  cost_per_base   numeric(18,8),
  UNIQUE (transfer_id, item_id)
);
CREATE INDEX stock_transfer_lines_item ON stock_transfer_lines (tenant_id, item_id);

ALTER TABLE stock_transfer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_transfer_lines_tenant ON stock_transfer_lines
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
