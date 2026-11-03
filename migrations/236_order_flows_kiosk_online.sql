-- Order flows on kiosks and online ordering (shared/pos/orderFlows.js).
--
-- A flow now says where it runs: tills, kiosks, online ordering (flow.apps,
-- any of them), at every location or the ones it names, on every till / kiosk
-- there or the ones it names. The tills it names were flow.device_ids; they
-- are flow.till_ids now, beside flow.kiosk_ids. Flows saved before run on
-- tills, as they did.
UPDATE pos_order_flows
   SET flow = (flow - 'device_ids') || jsonb_build_object('till_ids', flow->'device_ids')
 WHERE flow ? 'device_ids';

-- Online orders keep what the order flows put on them:
--   orders.charges        the charges, as priced: [{ id, name, label, kind, value,
--                         basis, per, count, amount_pence, vat_rate, vat_pence,
--                         tax_rate_id, removable, flow: { id, key } }]
--   orders.charges_pence  their sum (total = subtotal - discount + charges + tip)
--   orders.flows          { asked: { [flow id]: { n, answer, item_ids } },
--                           off: { [key]: true } } the prompts asked and what the
--                         guest took off
--   order_items.flow      { id, key, removable } on a dish a flow put on
ALTER TABLE orders ADD COLUMN IF NOT EXISTS charges jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS charges_pence int NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS flows jsonb;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS flow jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_charges_pence_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_charges_pence_check CHECK (charges_pence >= 0);
  END IF;
END $$;
