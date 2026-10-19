-- 189_order_tile_fields.sql
--
-- Order status blocks on menu screen boards (screen_designs.layout) choose
-- what each tile shows (shared/orderInfo.js): opts.tile_main (the big value:
-- number | tent | table | name) and opts.tile_lines (small lines under it).
-- The old switch opts.show_names (the guest's first name under online
-- orders) becomes tile_lines ['name'].

BEGIN;

UPDATE screen_designs d
   SET layout = jsonb_set(d.layout, '{blocks}', (
         SELECT jsonb_agg(
                  CASE WHEN b->>'type' = 'order_status' AND (b->'opts') ? 'show_names'
                       THEN jsonb_set(b, '{opts}',
                              ((b->'opts') - 'show_names')
                              || CASE WHEN ((b->'opts')->>'show_names')::boolean
                                      THEN '{"tile_lines": ["name"]}'::jsonb ELSE '{}'::jsonb END)
                       ELSE b END
                  ORDER BY ord)
           FROM jsonb_array_elements(d.layout->'blocks') WITH ORDINALITY AS t(b, ord)))
 WHERE jsonb_typeof(d.layout->'blocks') = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(d.layout->'blocks') b
                WHERE b->>'type' = 'order_status' AND (b->'opts') ? 'show_names');

COMMIT;
