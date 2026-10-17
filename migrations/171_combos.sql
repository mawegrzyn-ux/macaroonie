-- 171_combos.sql
-- Combos (shared/combos.js): menu items of kind 'combo' with steps, used by
-- the till, online ordering, the website and printed menus, and menu
-- screens.
--
--   menu_items.combo         { mode: 'manual' | 'auto', steps: [{ id, name,
--                            min, max, repeat, auto, ask, when, options:
--                            [{ id, type: 'item' | 'section' | 'custom',
--                            item_id, section_id, label, kitchen_name,
--                            price_pence }] }] }. Replaces the till-only meal
--                            deal slots ({ slots: [{ item_ids, section_ids,
--                            upcharges }] }): each slot becomes a step, its
--                            dishes and sections its choices (a dish's extra
--                            charge kept; dishes picked through a section
--                            lose theirs)
--   menu_variant_groups      allow_repeat (the same option more than once:
--                            2 x Extra cheese), on_request (an optional group
--                            waits behind a button instead of opening)
--   order_items.parts        a combo line's picks on an online order
--   order_promotions         combo_item_id: an automatic combo found in the
--                            basket (promotion_id NULL)
--
-- Published menu versions get the same combo shape and are re-hashed at
-- API start (content_hash '' = re-hash, backfillFirstReleases()).

BEGIN;

ALTER TABLE menu_variant_groups
  ADD COLUMN IF NOT EXISTS allow_repeat boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS on_request   boolean NOT NULL DEFAULT false;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS parts jsonb;

ALTER TABLE order_promotions
  ADD COLUMN IF NOT EXISTS combo_item_id uuid;

-- A meal deal's slots as combo steps. Choice ids come from the slot and
-- the dish / section, so a menu and its published versions get the same ids
-- (else every combo would read as "changes not published").
CREATE FUNCTION pg_temp.combo_steps(c jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT CASE
    WHEN c IS NULL OR jsonb_typeof(c) <> 'object' THEN NULL
    WHEN c ? 'steps' THEN c
    ELSE jsonb_build_object('mode', 'manual', 'steps', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s->>'id',
               'name', COALESCE(NULLIF(s->>'name', ''), 'Choice ' || ord),
               'min', COALESCE((s->>'min')::int, 1),
               'max', GREATEST(1, COALESCE((s->>'max')::int, 1)),
               'repeat', false, 'auto', true, 'ask', 'always', 'when', NULL,
               'options',
                 COALESCE((SELECT jsonb_agg(jsonb_build_object(
                             'id', md5((s->>'id') || ':item:' || i)::uuid, 'type', 'item', 'item_id', i,
                             'price_pence', COALESCE((s->'upcharges'->>i)::int, 0)) ORDER BY io)
                             FROM jsonb_array_elements_text(COALESCE(s->'item_ids', '[]'::jsonb)) WITH ORDINALITY AS a(i, io)), '[]'::jsonb)
                 || COALESCE((SELECT jsonb_agg(jsonb_build_object(
                             'id', md5((s->>'id') || ':section:' || sid)::uuid, 'type', 'section', 'section_id', sid, 'price_pence', 0) ORDER BY so)
                             FROM jsonb_array_elements_text(COALESCE(s->'section_ids', '[]'::jsonb)) WITH ORDINALITY AS b(sid, so)), '[]'::jsonb))
             ORDER BY ord)
        FROM jsonb_array_elements(COALESCE(c->'slots', '[]'::jsonb)) WITH ORDINALITY AS x(s, ord)), '[]'::jsonb))
  END
$$;

UPDATE menu_items SET combo = pg_temp.combo_steps(combo)
 WHERE combo IS NOT NULL AND NOT (combo ? 'steps');

UPDATE menu_releases r
   SET snapshot = r.snapshot || jsonb_build_object('sections', COALESCE((
         SELECT jsonb_agg(
                  s || jsonb_build_object('items', COALESCE((
                    SELECT jsonb_agg(
                             CASE WHEN jsonb_typeof(i->'combo') = 'object' THEN i || jsonb_build_object('combo', pg_temp.combo_steps(i->'combo')) ELSE i END
                             ORDER BY io)
                      FROM jsonb_array_elements(COALESCE(s->'items', '[]'::jsonb)) WITH ORDINALITY AS y(i, io)), '[]'::jsonb))
                  ORDER BY so)
           FROM jsonb_array_elements(r.snapshot->'sections') WITH ORDINALITY AS x(s, so)), '[]'::jsonb)),
       content_hash = ''
 WHERE jsonb_typeof(r.snapshot->'sections') = 'array'
   AND r.snapshot::text LIKE '%"slots"%';

COMMIT;
