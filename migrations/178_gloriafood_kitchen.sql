-- 178_gloriafood_kitchen.sql
--
-- GloriaFood orders on the kitchen screens. A venue with a GloriaFood link
-- (migration 159) and kitchen screens (migration 168) can send its accepted
-- GloriaFood orders into the kitchen, like its own online orders:
--
--   kds_orders.source     'gloriafood' for these (kitchen order id
--                          'gf-<gloriafood_orders.id>')
--   pos_settings
--     kds_gloriafood            send them (off until switched on: a venue may
--                               be using GloriaFood's own app in the kitchen)
--     kds_gloriafood_types      GloriaFood order type (pickup, delivery,
--                               dine_in, order_ahead, table_reservation) ->
--                               the tenant's order type id, or null for none;
--                               a type left out is matched by name
--                               (Collection / Take out, Delivery, Eat in)
--     kds_gloriafood_lead_mins  an order for later comes on this many minutes
--                               before its time
--
-- kds_online_ready (migration 168) also covers these: ready / collected in
-- the kitchen moves the order on the Online orders board (our board status
-- only; GloriaFood never hears about it).

BEGIN;

ALTER TABLE kds_orders DROP CONSTRAINT IF EXISTS kds_orders_source_check;
ALTER TABLE kds_orders ADD CONSTRAINT kds_orders_source_check CHECK (source IN ('till', 'online', 'gloriafood'));

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS kds_gloriafood           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kds_gloriafood_types     jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS kds_gloriafood_lead_mins integer NOT NULL DEFAULT 20
    CHECK (kds_gloriafood_lead_mins BETWEEN 0 AND 240);

COMMIT;
