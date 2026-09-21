-- 081_cta_strip_multi_button.sql
--
-- The `cta_strip` block supported a single button (`cta_text`/`cta_link`
-- fields on block.data). It now supports up to 3 via a `ctas[]` array
-- (same shape as the Hero block's ctas: { text, link, style }), so a
-- strip can pair a primary "Book a table" with a secondary "View menu".
--
-- Rewrites existing cta_strip block instances in place: cta_text/cta_link
-- become a single-entry ctas[] (style: primary), or an empty array if
-- cta_text was blank. Idempotent — cta_strip blocks have no cta_text key
-- left after the first pass, so re-running is a no-op.

DO $$
DECLARE rec record;
BEGIN
  -- tenant_site.home_blocks
  FOR rec IN SELECT tenant_id, home_blocks FROM tenant_site WHERE home_blocks IS NOT NULL LOOP
    UPDATE tenant_site
       SET home_blocks = (
         SELECT jsonb_agg(
           CASE WHEN b->>'type' = 'cta_strip' AND (b->'data') ? 'cta_text' THEN
             jsonb_set(
               b, '{data}',
               ((b->'data') - 'cta_text'::text - 'cta_link'::text) || jsonb_build_object(
                 'ctas',
                 CASE WHEN COALESCE(b->'data'->>'cta_text', '') <> ''
                      THEN jsonb_build_array(jsonb_build_object(
                             'text', b->'data'->>'cta_text',
                             'link', COALESCE(b->'data'->>'cta_link', ''),
                             'style', 'primary'
                           ))
                      ELSE '[]'::jsonb
                 END
               )
             )
           ELSE b END
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
           CASE WHEN b->>'type' = 'cta_strip' AND (b->'data') ? 'cta_text' THEN
             jsonb_set(
               b, '{data}',
               ((b->'data') - 'cta_text'::text - 'cta_link'::text) || jsonb_build_object(
                 'ctas',
                 CASE WHEN COALESCE(b->'data'->>'cta_text', '') <> ''
                      THEN jsonb_build_array(jsonb_build_object(
                             'text', b->'data'->>'cta_text',
                             'link', COALESCE(b->'data'->>'cta_link', ''),
                             'style', 'primary'
                           ))
                      ELSE '[]'::jsonb
                 END
               )
             )
           ELSE b END
         )
         FROM jsonb_array_elements(rec.page_blocks) AS b
       )
     WHERE id = rec.id;
  END LOOP;

  -- website_pages.blocks
  FOR rec IN SELECT id, blocks FROM website_pages WHERE blocks IS NOT NULL LOOP
    UPDATE website_pages
       SET blocks = (
         SELECT jsonb_agg(
           CASE WHEN b->>'type' = 'cta_strip' AND (b->'data') ? 'cta_text' THEN
             jsonb_set(
               b, '{data}',
               ((b->'data') - 'cta_text'::text - 'cta_link'::text) || jsonb_build_object(
                 'ctas',
                 CASE WHEN COALESCE(b->'data'->>'cta_text', '') <> ''
                      THEN jsonb_build_array(jsonb_build_object(
                             'text', b->'data'->>'cta_text',
                             'link', COALESCE(b->'data'->>'cta_link', ''),
                             'style', 'primary'
                           ))
                      ELSE '[]'::jsonb
                 END
               )
             )
           ELSE b END
         )
         FROM jsonb_array_elements(rec.blocks) AS b
       )
     WHERE id = rec.id;
  END LOOP;
END $$;
