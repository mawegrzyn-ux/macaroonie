-- 078_single_venue_collapse_location_page.sql
--
-- Single-venue tenants no longer get a separate venue "Location page"
-- (website_config.page_blocks) — that content now lives directly on the
-- tenant home page (tenant_site.home_blocks), same place all of a
-- single-venue tenant's other data (hours, gallery, menus, allergens)
-- already gets merged in via mergeLocationConfig(). Multi-venue tenants
-- are untouched — each of their venues keeps its own Location page.
--
-- For any tenant with exactly one active venue, appends that venue's
-- page_blocks onto the tenant's home_blocks (regenerating block ids to
-- avoid collisions) and clears page_blocks so nothing is silently lost.
--
-- Idempotent: page_blocks is NULL/empty after the first pass, so
-- re-runs are no-ops.

DO $$
DECLARE
  rec    record;
  merged jsonb;
BEGIN
  FOR rec IN
    SELECT sv.tenant_id, ts.home_blocks, wc.id AS config_id, wc.page_blocks
      FROM (
        SELECT tenant_id, MIN(id) AS venue_id
          FROM venues
         WHERE is_active = true
         GROUP BY tenant_id
        HAVING COUNT(*) = 1
      ) sv
      JOIN tenant_site    ts ON ts.tenant_id = sv.tenant_id
      JOIN website_config wc ON wc.venue_id  = sv.venue_id
     WHERE wc.page_blocks IS NOT NULL
       AND jsonb_typeof(wc.page_blocks) = 'array'
       AND jsonb_array_length(wc.page_blocks) > 0
  LOOP
    SELECT jsonb_agg(b || jsonb_build_object('id', gen_random_uuid()::text))
      INTO merged
      FROM jsonb_array_elements(rec.page_blocks) AS b;

    UPDATE tenant_site
       SET home_blocks = COALESCE(rec.home_blocks, '[]'::jsonb) || merged,
           updated_at  = now()
     WHERE tenant_id = rec.tenant_id;

    UPDATE website_config
       SET page_blocks = NULL,
           updated_at  = now()
     WHERE id = rec.config_id;
  END LOOP;
END $$;
