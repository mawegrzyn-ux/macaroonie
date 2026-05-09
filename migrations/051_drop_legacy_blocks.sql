-- 051_drop_legacy_blocks.sql
--
-- Pre-prod cleanup: the legacy `ticker` and `two_column` blocks have been
-- removed in favour of `scrolling_text` (clean font handling) and
-- `columns` / `story_with_stamp` (1-4 col layout + image+text option).
--
-- This migration rewrites any block of either legacy type inside the two
-- JSONB block columns (`tenant_site.home_blocks` and
-- `website_config.page_blocks`) so they keep rendering.
--
--   ticker → scrolling_text
--     Fields preserved as-is (items / bg_style / font_family / font_size /
--     speed). The new block has additional fields (font_weight,
--     font_style, show_separators, text_colour) that fall back to
--     defaults inside the SSR partial when missing.
--
--   two_column → story_with_stamp
--     Fields mapped where possible; stamp_show forced false so the new
--     block doesn't render the decorative pill that wasn't on the old one.
--
-- No data is lost — the rewrite is in-place and idempotent (running it
-- again is a no-op because there are no `ticker` / `two_column` blocks
-- left after the first pass).

-- A small helper to walk a JSONB block array and rename block.type values.
DO $$
DECLARE
  rec record;
BEGIN
  -- tenant_site.home_blocks
  FOR rec IN SELECT tenant_id, home_blocks FROM tenant_site WHERE home_blocks IS NOT NULL LOOP
    UPDATE tenant_site
       SET home_blocks = (
         SELECT jsonb_agg(
           CASE
             WHEN b->>'type' = 'ticker'     THEN jsonb_set(b, '{type}', '"scrolling_text"')
             WHEN b->>'type' = 'two_column' THEN
               jsonb_set(
                 jsonb_set(b, '{type}', '"story_with_stamp"'),
                 '{stamp_show}', 'false'
               )
             ELSE b
           END
         )
         FROM jsonb_array_elements(rec.home_blocks) AS b
       )
     WHERE tenant_id = rec.tenant_id;
  END LOOP;

  -- website_config.page_blocks
  FOR rec IN SELECT id, page_blocks FROM website_config WHERE page_blocks IS NOT NULL LOOP
    UPDATE website_config
       SET page_blocks = (
         SELECT jsonb_agg(
           CASE
             WHEN b->>'type' = 'ticker'     THEN jsonb_set(b, '{type}', '"scrolling_text"')
             WHEN b->>'type' = 'two_column' THEN
               jsonb_set(
                 jsonb_set(b, '{type}', '"story_with_stamp"'),
                 '{stamp_show}', 'false'
               )
             ELSE b
           END
         )
         FROM jsonb_array_elements(rec.page_blocks) AS b
       )
     WHERE id = rec.id;
  END LOOP;
END $$;
