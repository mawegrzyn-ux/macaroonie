-- 163_guestplan_own_button.sql
--
-- The Guestplan block no longer has "Start closed" (data.launcher_mode):
-- our own floating button, which loaded Guestplan on the first tap and
-- tried to tap Guestplan's launcher for the visitor, didn't open the
-- booking form on the live site. The block now always loads Guestplan's
-- script with the page and Guestplan's own button is the only one.
--
-- In "Start closed" the heading was the label of our button, not a page
-- heading, so those blocks lose their heading as well as launcher_mode;
-- otherwise the label would suddenly show as a heading on the page. Other
-- Guestplan blocks just lose the unused key.
--
-- Blocks can sit anywhere in the stored JSON (home page, location pages,
-- extra pages and modals, inside columns or tabs, and in the published
-- snapshot), so a temporary function walks every value.

BEGIN;

CREATE FUNCTION mcrn_tmp_strip_gp_launcher(j jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  out jsonb;
  k   text;
  v   jsonb;
BEGIN
  IF j IS NULL THEN
    RETURN NULL;
  ELSIF jsonb_typeof(j) = 'array' THEN
    SELECT COALESCE(jsonb_agg(mcrn_tmp_strip_gp_launcher(e) ORDER BY i), '[]'::jsonb)
      INTO out
      FROM jsonb_array_elements(j) WITH ORDINALITY AS t(e, i);
    RETURN out;
  ELSIF jsonb_typeof(j) = 'object' THEN
    out := '{}'::jsonb;
    FOR k, v IN SELECT * FROM jsonb_each(j) LOOP
      out := out || jsonb_build_object(k, mcrn_tmp_strip_gp_launcher(v));
    END LOOP;
    IF out->>'type' = 'guestplan_widget'
       AND jsonb_typeof(out->'data') = 'object'
       AND (out->'data') ? 'launcher_mode' THEN
      IF out->'data'->'launcher_mode' = 'true'::jsonb THEN
        out := jsonb_set(out, '{data}', (out->'data') - 'launcher_mode' - 'heading');
      ELSE
        out := jsonb_set(out, '{data}', (out->'data') - 'launcher_mode');
      END IF;
    END IF;
    RETURN out;
  ELSE
    RETURN j;
  END IF;
END $$;

UPDATE tenant_site
   SET home_blocks = mcrn_tmp_strip_gp_launcher(home_blocks)
 WHERE home_blocks::text LIKE '%launcher_mode%';

UPDATE tenant_site
   SET published_snapshot = mcrn_tmp_strip_gp_launcher(published_snapshot)
 WHERE published_snapshot::text LIKE '%launcher_mode%';

UPDATE website_config
   SET page_blocks = mcrn_tmp_strip_gp_launcher(page_blocks)
 WHERE page_blocks::text LIKE '%launcher_mode%';

UPDATE website_pages
   SET blocks = mcrn_tmp_strip_gp_launcher(blocks)
 WHERE blocks::text LIKE '%launcher_mode%';

DROP FUNCTION mcrn_tmp_strip_gp_launcher(jsonb);

COMMIT;
