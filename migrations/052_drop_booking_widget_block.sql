-- 052_drop_booking_widget_block.sql
--
-- Pre-prod cleanup: the legacy `booking_widget` block has been replaced
-- with `reservations_widget` (clean front-end, fixed slot filter,
-- proper calendar). Block data shape is identical — just the type tag
-- changes — so any existing block on a published page rewrites in place.
--
-- Idempotent: re-runs are no-ops because no `booking_widget` blocks
-- remain after the first pass.

DO $$
DECLARE rec record;
BEGIN
  FOR rec IN SELECT tenant_id, home_blocks FROM tenant_site WHERE home_blocks IS NOT NULL LOOP
    UPDATE tenant_site
       SET home_blocks = (
         SELECT jsonb_agg(
           CASE WHEN b->>'type' = 'booking_widget'
                THEN jsonb_set(b, '{type}', '"reservations_widget"')
                ELSE b
           END
         )
         FROM jsonb_array_elements(rec.home_blocks) AS b
       )
     WHERE tenant_id = rec.tenant_id;
  END LOOP;

  FOR rec IN SELECT id, page_blocks FROM website_config WHERE page_blocks IS NOT NULL LOOP
    UPDATE website_config
       SET page_blocks = (
         SELECT jsonb_agg(
           CASE WHEN b->>'type' = 'booking_widget'
                THEN jsonb_set(b, '{type}', '"reservations_widget"')
                ELSE b
           END
         )
         FROM jsonb_array_elements(rec.page_blocks) AS b
       )
     WHERE id = rec.id;
  END LOOP;
END $$;
