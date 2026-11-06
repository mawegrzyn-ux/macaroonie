-- 237_order_board_show.sql
--
-- Order status blocks on menu screen boards (screen_designs.layout) choose
-- which columns they show: opts.show = 'both' | 'preparing' | 'ready'
-- (shared/screenLayout.js orderShow()). The old switch opts.show_preparing
-- (false = ready numbers only) becomes show 'ready' and goes. The blocks'
-- new order type and revenue stream filters (opts.filter_types /
-- filter_streams, by name) start empty: every order, as before.

UPDATE screen_designs d
   SET layout = jsonb_set(d.layout, '{blocks}', (
         SELECT jsonb_agg(
                  CASE WHEN b->>'type' = 'order_status' AND (b->'opts') ? 'show_preparing'
                       THEN jsonb_set(b, '{opts}',
                              ((b->'opts') - 'show_preparing')
                              || CASE WHEN (b->'opts'->>'show_preparing') = 'false'
                                      THEN '{"show": "ready"}'::jsonb ELSE '{}'::jsonb END)
                       ELSE b END
                  ORDER BY ord)
           FROM jsonb_array_elements(d.layout->'blocks') WITH ORDINALITY AS t(b, ord)))
 WHERE jsonb_typeof(d.layout->'blocks') = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(d.layout->'blocks') b
                WHERE b->>'type' = 'order_status' AND (b->'opts') ? 'show_preparing');
