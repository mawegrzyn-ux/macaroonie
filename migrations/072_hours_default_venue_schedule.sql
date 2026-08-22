-- ============================================================
-- 072_hours_default_venue_schedule.sql
--
-- Opening hours on the public site defaulted to `manual`
-- (website_opening_hours). Operators already keep hours on the
-- venue Schedule page (venue_schedule_templates + venue_sittings),
-- so the hours block rendered empty / "Closed" unless they also
-- filled a second, unused form.
--
-- Flip the default to `venue` (derive from sittings). Existing
-- configs that never saved an open manual row follow; anyone who
-- actually edited website hours stays on `manual`.
-- ============================================================

BEGIN;

ALTER TABLE website_config
  ALTER COLUMN opening_hours_source SET DEFAULT 'venue';

UPDATE website_config wc
   SET opening_hours_source = 'venue'
 WHERE opening_hours_source = 'manual'
   AND NOT EXISTS (
     SELECT 1
       FROM website_opening_hours h
      WHERE h.website_config_id = wc.id
        AND h.is_closed = false
        AND h.opens_at IS NOT NULL
   );

COMMIT;
