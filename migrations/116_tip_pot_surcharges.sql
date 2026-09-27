-- 116_tip_pot_surcharges.sql
--
-- A tip pot can have any number of surcharges (fees, tax), applied in order:
-- each one is a percentage of what is left after the ones before it, so they
-- stack (compound). Replaces the single surcharge_name / surcharge_pct pair
-- from migration 111.
--
--   tip_pots.surcharges  jsonb array of { name, pct }, in the order applied.

BEGIN;

ALTER TABLE tip_pots
  ADD COLUMN IF NOT EXISTS surcharges jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE tip_pots
   SET surcharges = jsonb_build_array(jsonb_build_object('name', surcharge_name, 'pct', surcharge_pct))
 WHERE surcharge_pct > 0 AND surcharges = '[]'::jsonb;

ALTER TABLE tip_pots
  DROP COLUMN IF EXISTS surcharge_name,
  DROP COLUMN IF EXISTS surcharge_pct;

COMMIT;
