-- 201_pick_photo_per_group.sql
--
-- How a choice's picture shows on the dish's photo on the kiosk is set on
-- each option group and combo step, not once per kiosk design: one dish can
-- split its photo between the flavours picked and show the dip picked small
-- in the corner.
--
--   menu_variant_groups.kiosk_pick_photo  NULL (not on the photo) | 'split' | 'corner'
--                                         (replaces kiosk_split, migration 185)
--   menu_items.combo steps[].pick_photo   'split' | 'corner', stored only when set
--                                         (replaces steps[].split)
--   kiosk_designs.settings options.pick_photos  dropped
--
-- Groups and steps that had Split photo on keep the look their kiosks
-- showed: 'corner' where every kiosk design of the tenant said corner,
-- else 'split'. Release snapshots are rewritten the same way and re-hashed
-- at API start (content_hash '', rehashReleases()).

ALTER TABLE menu_variant_groups ADD COLUMN IF NOT EXISTS kiosk_pick_photo text
  CHECK (kiosk_pick_photo IN ('split', 'corner'));

CREATE TEMP TABLE mcrn_tmp_pick_mode ON COMMIT DROP AS
SELECT t.id AS tenant_id,
       CASE WHEN EXISTS (SELECT 1 FROM kiosk_designs d WHERE d.tenant_id = t.id)
             AND NOT EXISTS (SELECT 1 FROM kiosk_designs d WHERE d.tenant_id = t.id
                              AND COALESCE(d.settings->'options'->>'pick_photos', 'split') <> 'corner')
            THEN 'corner' ELSE 'split' END AS mode
  FROM tenants t;

UPDATE menu_variant_groups g
   SET kiosk_pick_photo = m.mode
  FROM mcrn_tmp_pick_mode m
 WHERE m.tenant_id = g.tenant_id AND g.kiosk_split;

ALTER TABLE menu_variant_groups DROP COLUMN IF EXISTS kiosk_split;

-- A combo step is an object with options, min and max; split true becomes
-- pick_photo, split false goes.
CREATE FUNCTION mcrn_tmp_pick_photo(j jsonb, mode text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  out jsonb;
  k   text;
  v   jsonb;
BEGIN
  IF j IS NULL THEN
    RETURN NULL;
  ELSIF jsonb_typeof(j) = 'array' THEN
    SELECT COALESCE(jsonb_agg(mcrn_tmp_pick_photo(e, mode) ORDER BY i), '[]'::jsonb)
      INTO out
      FROM jsonb_array_elements(j) WITH ORDINALITY AS t(e, i);
    RETURN out;
  ELSIF jsonb_typeof(j) = 'object' THEN
    out := '{}'::jsonb;
    FOR k, v IN SELECT * FROM jsonb_each(j) LOOP
      out := out || jsonb_build_object(k, mcrn_tmp_pick_photo(v, mode));
    END LOOP;
    IF out ? 'split' AND out ? 'options' AND out ? 'max' AND jsonb_typeof(out->'options') = 'array' THEN
      IF (out->'split') = 'true'::jsonb THEN
        out := (out - 'split') || jsonb_build_object('pick_photo', mode);
      ELSE
        out := out - 'split';
      END IF;
    END IF;
    RETURN out;
  ELSE
    RETURN j;
  END IF;
END $$;

UPDATE menu_items i
   SET combo = mcrn_tmp_pick_photo(i.combo, m.mode)
  FROM mcrn_tmp_pick_mode m
 WHERE m.tenant_id = i.tenant_id AND i.combo IS NOT NULL AND i.combo::text LIKE '%"split"%';

UPDATE menu_releases r
   SET snapshot = mcrn_tmp_pick_photo(r.snapshot, m.mode), content_hash = ''
  FROM mcrn_tmp_pick_mode m
 WHERE m.tenant_id = r.tenant_id AND r.snapshot::text LIKE '%"split"%';

DROP FUNCTION mcrn_tmp_pick_photo(jsonb, text);

UPDATE kiosk_designs
   SET settings = jsonb_set(settings, '{options}', (settings->'options') - 'pick_photos')
 WHERE jsonb_typeof(settings->'options') = 'object' AND (settings->'options') ? 'pick_photos';
