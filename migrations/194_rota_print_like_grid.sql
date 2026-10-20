-- 194: the rota printout and image are drawn like the Rota grid, always
-- without the totals (each person's hours and the count under each day),
-- so the Rota setup switch "Hide totals on printouts and images"
-- (migration 114) has nothing left to do.

ALTER TABLE rota_settings DROP COLUMN IF EXISTS hide_totals_on_print;
